import type { SensitiveData } from './sensitive-data.js';
import type { WebAddress } from './web-address.js';

const EXECUTABLE_EXTENSIONS = new Set([
  'apk', 'xapk', 'apks', 'aab', 'exe', 'msi', 'msix', 'appx', 'bat', 'cmd', 'com', 'scr', 'pif', 'cpl',
  'js', 'jse', 'vbs', 'vbe', 'wsf', 'hta', 'ps1', 'jar', 'lnk', 'iso', 'img', 'dmg', 'pkg', 'app', 'deb', 'rpm', 'sh',
]);

/** A file the page tried to push onto the visitor. It was caught and discarded inside the sandbox. */
export class DownloadAttempt {
  readonly fileName: string;
  readonly source: WebAddress;
  readonly sha256: string | null;
  readonly sizeInBytes: number | null;

  constructor(details: { fileName: string; source: WebAddress; sha256: string | null; sizeInBytes: number | null }) {
    if (details.fileName.trim().length === 0) {
      throw new Error('A download attempt needs a file name.');
    }
    this.fileName = details.fileName.trim();
    this.source = details.source;
    this.sha256 = details.sha256;
    this.sizeInBytes = details.sizeInBytes;
  }

  installsSoftware(): boolean {
    const extension = this.fileName.split('.').at(-1)?.toLowerCase() ?? '';
    return EXECUTABLE_EXTENSIONS.has(extension);
  }
}

export interface Screenshot {
  readonly caption: string;
  readonly mediaType: 'image/jpeg' | 'image/png';
  readonly base64Content: string;
}

/** What the page the link finally landed on looks like and asks for. */
export class PageObservation {
  readonly address: WebAddress;
  readonly title: string;
  readonly requestedData: readonly SensitiveData[];
  readonly formDestinations: readonly WebAddress[];
  readonly visibleText: string;

  constructor(details: {
    address: WebAddress;
    title: string;
    requestedData: readonly SensitiveData[];
    formDestinations: readonly WebAddress[];
    visibleText: string;
  }) {
    this.address = details.address;
    this.title = details.title.trim();
    this.requestedData = [...new Set(details.requestedData)];
    this.formDestinations = [...details.formDestinations];
    this.visibleText = details.visibleText;
  }

  asksForSensitiveData(): boolean {
    return this.requestedData.length > 0;
  }

  formsSubmittingToOtherSites(): WebAddress[] {
    return this.formDestinations.filter((destination) => !destination.isSameSiteAs(this.address));
  }
}

/** Everything observed while the link was opened inside the disposable sandbox. */
export class Evidence {
  readonly navigationPath: readonly WebAddress[];
  readonly landingPage: PageObservation | null;
  readonly downloadAttempts: readonly DownloadAttempt[];
  readonly screenshots: readonly Screenshot[];
  readonly unreachableReason: string | null;

  constructor(details: {
    navigationPath: readonly WebAddress[];
    landingPage: PageObservation | null;
    downloadAttempts: readonly DownloadAttempt[];
    screenshots: readonly Screenshot[];
    unreachableReason: string | null;
  }) {
    if (details.navigationPath.length === 0) {
      throw new Error('Evidence must include at least the address that was opened.');
    }
    this.navigationPath = [...details.navigationPath];
    this.landingPage = details.landingPage;
    this.downloadAttempts = [...details.downloadAttempts];
    this.screenshots = [...details.screenshots];
    this.unreachableReason = details.unreachableReason;
  }

  landedOnAPage(): boolean {
    return this.landingPage !== null;
  }

  redirectCount(): number {
    return this.navigationPath.length - 1;
  }

  /** How many times the visitor was bounced to a different site before landing. */
  crossSiteHopCount(): number {
    return this.navigationPath.slice(1).filter((address, index) => {
      const previous = this.navigationPath[index];
      return previous !== undefined && !address.isSameSiteAs(previous);
    }).length;
  }
}
