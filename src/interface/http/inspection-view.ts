import type { Inspection } from '../../domain/inspection.js';

/** The JSON shape the browser UI reads. Screenshots are served separately to keep polling light. */
export function toInspectionView(inspection: Inspection) {
  const evidence = inspection.evidence;
  const conclusion = inspection.conclusion;
  return {
    id: inspection.id.value,
    link: inspection.suspiciousLink.href,
    status: inspection.status,
    openedAt: inspection.openedAt.toISOString(),
    timeline: inspection.timeline.map((entry) => ({ at: entry.at.toISOString(), message: entry.message })),
    failureReason: inspection.failureReason,
    evidence:
      evidence === null
        ? null
        : {
            navigationPath: evidence.navigationPath.map((address) => address.href),
            landingPage:
              evidence.landingPage === null
                ? null
                : {
                    address: evidence.landingPage.address.href,
                    title: evidence.landingPage.title,
                    requestedData: evidence.landingPage.requestedData,
                  },
            blockedDownloads: evidence.downloadAttempts.map((download) => ({
              fileName: download.fileName,
              source: download.source.href,
              sha256: download.sha256,
              sizeInBytes: download.sizeInBytes,
              installsSoftware: download.installsSoftware(),
            })),
            screenshots: evidence.screenshots.map((screenshot, index) => ({
              caption: screenshot.caption,
              url: `/api/inspections/${inspection.id.value}/screenshots/${index}`,
            })),
            unreachableReason: evidence.unreachableReason,
          },
    conclusion:
      conclusion === null
        ? null
        : {
            verdict: conclusion.assessment.verdict,
            signals: conclusion.assessment.signals.map((signal) => ({
              kind: signal.kind,
              severity: signal.severity,
              explanation: signal.explanation,
            })),
            displayedBrand: conclusion.visual.displayedBrand?.name ?? null,
            pageDescription: conclusion.visual.pageDescription,
            report: {
              headline: conclusion.report.headline,
              explanation: conclusion.report.explanation,
              advice: conclusion.report.advice,
            },
          },
  };
}
