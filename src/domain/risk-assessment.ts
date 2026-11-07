import type { Evidence } from './evidence.js';
import { RiskSignal } from './risk-signal.js';
import { describeSensitiveData, type SensitiveData } from './sensitive-data.js';
import type { Brand, VisualAssessment } from './visual-assessment.js';

export type Verdict = 'dangerous' | 'suspicious' | 'no-threats-found' | 'inconclusive';

const SUSPICIOUS_REDIRECT_HOPS = 2;
const MEDIUM_SIGNALS_THAT_ADD_UP_TO_SUSPICIOUS = 2;

/**
 * Domain service: turns the evidence gathered in the sandbox into risk signals and a verdict.
 * The verdict follows fixed rules so it is explainable and cannot be talked into by the page or the model.
 */
export class RiskAssessment {
  private constructor(
    readonly verdict: Verdict,
    readonly signals: readonly RiskSignal[],
  ) {}

  static of(evidence: Evidence, visual: VisualAssessment): RiskAssessment {
    const situation = new Situation(evidence, visual);
    const signals = SIGNAL_DETECTORS.flatMap((detect) => detect(situation));
    return new RiskAssessment(decideVerdict(signals, evidence), signals);
  }
}

function decideVerdict(signals: readonly RiskSignal[], evidence: Evidence): Verdict {
  if (signals.some((signal) => signal.isCritical())) {
    return 'dangerous';
  }
  const mediumSignalCount = signals.filter((signal) => signal.isMedium()).length;
  if (signals.some((signal) => signal.isHigh()) || mediumSignalCount >= MEDIUM_SIGNALS_THAT_ADD_UP_TO_SUSPICIOUS) {
    return 'suspicious';
  }
  return evidence.landedOnAPage() ? 'no-threats-found' : 'inconclusive';
}

/** The facts every detector reasons about, derived once. */
class Situation {
  readonly impersonatedBrand: Brand | null;
  readonly requestedData: readonly SensitiveData[];

  constructor(
    readonly evidence: Evidence,
    readonly visual: VisualAssessment,
  ) {
    this.impersonatedBrand = findImpersonatedBrand(evidence, visual);
    this.requestedData = [...new Set([...(evidence.landingPage?.requestedData ?? []), ...visual.requestedData])];
  }
}

function findImpersonatedBrand(evidence: Evidence, visual: VisualAssessment): Brand | null {
  const brand = visual.displayedBrand;
  const landingPage = evidence.landingPage;
  if (brand === null || landingPage === null || brand.officialDomains.length === 0) {
    return null;
  }
  return brand.owns(landingPage.address) ? null : brand;
}

type SignalDetector = (situation: Situation) => RiskSignal[];

const detectDownloads: SignalDetector = ({ evidence }) =>
  evidence.downloadAttempts.map((download) =>
    download.installsSoftware()
      ? new RiskSignal(
          'software-download',
          'critical',
          `The page tried to make you download "${download.fileName}", a file that installs software. Scams use this to take over phones and computers.`,
        )
      : new RiskSignal('file-download', 'medium', `The page started downloading "${download.fileName}" without being asked.`),
  );

const detectBrandImpersonation: SignalDetector = ({ evidence, impersonatedBrand }) => {
  if (impersonatedBrand === null || evidence.landingPage === null) {
    return [];
  }
  return [
    new RiskSignal(
      'brand-impersonation',
      'high',
      `The page looks like ${impersonatedBrand.name}, but ${evidence.landingPage.address.hostname} is not an official ${impersonatedBrand.name} address.`,
    ),
  ];
};

const detectCredentialHarvesting: SignalDetector = ({ impersonatedBrand, requestedData }) => {
  if (impersonatedBrand === null || requestedData.length === 0) {
    return [];
  }
  return [
    new RiskSignal(
      'credential-harvesting',
      'critical',
      `It pretends to be ${impersonatedBrand.name} and asks for ${describeSensitiveData(requestedData)}. This is how account and card theft happens.`,
    ),
  ];
};

const detectSensitiveDataRequest: SignalDetector = ({ impersonatedBrand, requestedData }) => {
  if (impersonatedBrand !== null || requestedData.length === 0) {
    return [];
  }
  return [new RiskSignal('sensitive-data-request', 'low', `The page asks for ${describeSensitiveData(requestedData)}.`)];
};

const detectDataSentToAnotherSite: SignalDetector = ({ evidence, requestedData }) => {
  const landingPage = evidence.landingPage;
  if (landingPage === null || requestedData.length === 0) {
    return [];
  }
  const [foreignDestination] = landingPage.formsSubmittingToOtherSites();
  if (foreignDestination === undefined) {
    return [];
  }
  return [
    new RiskSignal(
      'data-sent-to-another-site',
      'high',
      `Whatever you type is sent to a different site (${foreignDestination.hostname}), not to the page you are looking at.`,
    ),
  ];
};

const detectUnencryptedSensitiveForm: SignalDetector = ({ evidence, requestedData }) => {
  const landingPage = evidence.landingPage;
  if (landingPage === null || requestedData.length === 0 || landingPage.address.isEncrypted()) {
    return [];
  }
  return [
    new RiskSignal(
      'unencrypted-sensitive-form',
      'high',
      'It asks for private information over an unencrypted connection, something no real bank or store does.',
    ),
  ];
};

const detectRedirectChain: SignalDetector = ({ evidence }) => {
  const hops = evidence.crossSiteHopCount();
  if (hops < SUSPICIOUS_REDIRECT_HOPS) {
    return [];
  }
  return [
    new RiskSignal('redirect-chain', 'medium', `The link bounced you through ${hops} different sites before showing anything, a trick used to hide where it really goes.`),
  ];
};

const detectRawIpAddress: SignalDetector = ({ evidence }) => {
  const ipAddress = evidence.navigationPath.find((address) => address.usesRawIpAddress());
  if (ipAddress === undefined) {
    return [];
  }
  return [new RiskSignal('raw-ip-address', 'medium', `It goes to a bare server number (${ipAddress.hostname}) instead of a named website.`)];
};

const detectDeceptiveAddress: SignalDetector = ({ evidence }) =>
  evidence.navigationPath.flatMap((address) => {
    if (address.hidesRealHostBehindCredentials()) {
      return [new RiskSignal('deceptive-address', 'high', `The link is written to look like another site, but it really goes to ${address.hostname}.`)];
    }
    if (address.usesPunycode()) {
      return [new RiskSignal('deceptive-address', 'high', `The address ${address.hostname} uses look-alike characters to imitate a familiar name.`)];
    }
    return [];
  });

const SIGNAL_DETECTORS: readonly SignalDetector[] = [
  detectDownloads,
  detectCredentialHarvesting,
  detectBrandImpersonation,
  detectDataSentToAnotherSite,
  detectUnencryptedSensitiveForm,
  detectDeceptiveAddress,
  detectRedirectChain,
  detectRawIpAddress,
  detectSensitiveDataRequest,
];
