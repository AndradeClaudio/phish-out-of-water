import type { Evidence, PageObservation, Screenshot } from '../domain/evidence.js';
import type { InspectionId } from '../domain/inspection.js';
import type { Report } from '../domain/report.js';
import type { RiskAssessment } from '../domain/risk-assessment.js';
import type { VisualAssessment } from '../domain/visual-assessment.js';
import type { WebAddress } from '../domain/web-address.js';

/**
 * Opens a link inside a disposable, isolated environment.
 * Contract: the environment is destroyed before the promise settles, whatever the outcome.
 */
export interface Sandbox {
  detonate(link: WebAddress): Promise<Evidence>;
}

export interface VisualAnalyst {
  describe(page: PageObservation, screenshot: Screenshot): Promise<VisualAssessment>;
}

export interface ReportBrief {
  readonly link: WebAddress;
  readonly assessment: RiskAssessment;
  readonly visual: VisualAssessment;
}

export interface ReportWriter {
  write(brief: ReportBrief): Promise<Report>;
}

/** Runs inspections in the background so the person gets an answer to poll right away. */
export interface InspectionScheduler {
  schedule(id: InspectionId): void;
}

export interface Clock {
  now(): Date;
}
