import { DownloadAttempt, Evidence, PageObservation, type Screenshot } from '../../domain/evidence.js';
import { isSensitiveData } from '../../domain/sensitive-data.js';
import { WebAddress } from '../../domain/web-address.js';

/** The sandbox's own wire format. Translated into domain Evidence at this boundary. */
export interface DetonationReport {
  navigationPath: string[];
  landingPage: {
    url: string;
    title: string;
    requestedData: string[];
    formDestinations: string[];
    visibleText: string;
  } | null;
  downloads: { fileName: string; sourceUrl: string; sha256: string | null; sizeInBytes: number | null }[];
  screenshots: { caption: string; mediaType: 'image/jpeg' | 'image/png'; base64Content: string }[];
  unreachableReason: string | null;
}

const REPORT_PREFIX = 'DETONATION_REPORT ';
const MAX_LIST_ENTRIES = 50;
const MAX_SCREENSHOTS = 3;
const MAX_TEXT_CHARACTERS = 4_000;
const MAX_SCREENSHOT_BASE64_CHARACTERS = 6 * 1024 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const IMAGE_SIGNATURES: Record<'image/jpeg' | 'image/png', number[]> = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
};

export class InvalidDetonationReportError extends Error {
  override readonly name = 'InvalidDetonationReportError';
}

/**
 * The report comes out of a container that just ran a hostile page, so it is untrusted input:
 * every field is type-checked and size-capped here, and a "screenshot" is only kept if its bytes
 * really are a JPEG or PNG (otherwise a compromised sandbox could make us serve its HTML).
 */
export function parseDetonationReport(sandboxOutput: string): DetonationReport {
  const reportLine = sandboxOutput.split('\n').find((line) => line.startsWith(REPORT_PREFIX));
  if (reportLine === undefined) {
    throw new Error('The sandbox finished without producing a report.');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(reportLine.slice(REPORT_PREFIX.length));
  } catch {
    throw new InvalidDetonationReportError('The sandbox report is not valid JSON.');
  }
  const report = asRecord(raw, 'report');
  return {
    navigationPath: asList(report.navigationPath, 'navigationPath').map((entry) => asText(entry, 'navigationPath entry')),
    landingPage: report.landingPage === null ? null : readLandingPage(report.landingPage),
    downloads: asList(report.downloads, 'downloads').map(readDownload),
    screenshots: asList(report.screenshots, 'screenshots').slice(0, MAX_SCREENSHOTS).flatMap(readScreenshot),
    unreachableReason: report.unreachableReason === null ? null : asText(report.unreachableReason, 'unreachableReason'),
  };
}

function readLandingPage(value: unknown): DetonationReport['landingPage'] {
  const page = asRecord(value, 'landingPage');
  return {
    url: asText(page.url, 'landingPage.url'),
    title: asText(page.title, 'landingPage.title'),
    requestedData: asList(page.requestedData, 'requestedData').map((entry) => asText(entry, 'requestedData entry')),
    formDestinations: asList(page.formDestinations, 'formDestinations').map((entry) => asText(entry, 'formDestinations entry')),
    visibleText: asText(page.visibleText, 'landingPage.visibleText'),
  };
}

function readDownload(value: unknown): DetonationReport['downloads'][number] {
  const download = asRecord(value, 'download');
  const sha256 = download.sha256 === null ? null : asText(download.sha256, 'download.sha256');
  if (sha256 !== null && !SHA256_PATTERN.test(sha256)) {
    throw new InvalidDetonationReportError('A download fingerprint is not a SHA-256 hash.');
  }
  const sizeInBytes = download.sizeInBytes;
  if (sizeInBytes !== null && !(Number.isInteger(sizeInBytes) && (sizeInBytes as number) >= 0)) {
    throw new InvalidDetonationReportError('A download size is not a non-negative integer.');
  }
  return {
    fileName: asText(download.fileName, 'download.fileName'),
    sourceUrl: asText(download.sourceUrl, 'download.sourceUrl'),
    sha256,
    sizeInBytes: sizeInBytes as number | null,
  };
}

function readScreenshot(value: unknown): DetonationReport['screenshots'] {
  const screenshot = asRecord(value, 'screenshot');
  const mediaType = screenshot.mediaType;
  const base64Content = screenshot.base64Content;
  if ((mediaType !== 'image/jpeg' && mediaType !== 'image/png') || typeof base64Content !== 'string') {
    return [];
  }
  if (base64Content.length > MAX_SCREENSHOT_BASE64_CHARACTERS) {
    return [];
  }
  const signature = IMAGE_SIGNATURES[mediaType];
  const header = Buffer.from(base64Content.slice(0, 16), 'base64');
  if (!signature.every((byte, index) => header[index] === byte)) {
    return [];
  }
  return [{ caption: asText(screenshot.caption, 'screenshot.caption'), mediaType, base64Content }];
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidDetonationReportError(`The sandbox report field "${field}" is not an object.`);
  }
  return value as Record<string, unknown>;
}

function asList(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new InvalidDetonationReportError(`The sandbox report field "${field}" is not a list.`);
  }
  return value.slice(0, MAX_LIST_ENTRIES);
}

function asText(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new InvalidDetonationReportError(`The sandbox report field "${field}" is not text.`);
  }
  return value.slice(0, MAX_TEXT_CHARACTERS);
}

export function toEvidence(report: DetonationReport, submittedLink: WebAddress): Evidence {
  const visitedAddresses = report.navigationPath.filter(WebAddress.isWebAddress).map(WebAddress.of);
  const navigationPath = visitedAddresses[0]?.equals(submittedLink) ? visitedAddresses : [submittedLink, ...visitedAddresses];

  return new Evidence({
    navigationPath,
    landingPage: toPageObservation(report.landingPage),
    downloadAttempts: report.downloads.map(
      (download) =>
        new DownloadAttempt({
          fileName: download.fileName,
          source: WebAddress.isWebAddress(download.sourceUrl) ? WebAddress.of(download.sourceUrl) : submittedLink,
          sha256: download.sha256,
          sizeInBytes: download.sizeInBytes,
        }),
    ),
    screenshots: report.screenshots.map((screenshot): Screenshot => ({ ...screenshot })),
    unreachableReason: report.unreachableReason,
  });
}

function toPageObservation(landingPage: DetonationReport['landingPage']): PageObservation | null {
  if (landingPage === null || !WebAddress.isWebAddress(landingPage.url)) {
    return null;
  }
  return new PageObservation({
    address: WebAddress.of(landingPage.url),
    title: landingPage.title,
    requestedData: landingPage.requestedData.filter(isSensitiveData),
    formDestinations: landingPage.formDestinations.filter(WebAddress.isWebAddress).map(WebAddress.of),
    visibleText: landingPage.visibleText,
  });
}
