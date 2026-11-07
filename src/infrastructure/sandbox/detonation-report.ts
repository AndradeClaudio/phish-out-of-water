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

export function parseDetonationReport(sandboxOutput: string): DetonationReport {
  const reportLine = sandboxOutput.split('\n').find((line) => line.startsWith(REPORT_PREFIX));
  if (reportLine === undefined) {
    throw new Error('The sandbox finished without producing a report.');
  }
  return JSON.parse(reportLine.slice(REPORT_PREFIX.length)) as DetonationReport;
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
