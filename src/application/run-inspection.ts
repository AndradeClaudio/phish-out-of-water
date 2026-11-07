import type { Evidence } from '../domain/evidence.js';
import type { Inspection, InspectionId } from '../domain/inspection.js';
import type { InspectionRepository } from '../domain/inspection-repository.js';
import { RiskAssessment } from '../domain/risk-assessment.js';
import { VisualAssessment } from '../domain/visual-assessment.js';
import { InspectionNotFoundError } from './inspection-not-found-error.js';
import type { Clock, ReportWriter, Sandbox, VisualAnalyst } from './ports.js';

export interface RunInspectionDependencies {
  readonly inspections: InspectionRepository;
  readonly sandbox: Sandbox;
  readonly visualAnalyst: VisualAnalyst;
  readonly reportWriter: ReportWriter;
  readonly clock: Clock;
}

/** Use case: detonate the link in the sandbox, look at what happened, judge it and explain it. */
export class RunInspection {
  constructor(private readonly dependencies: RunInspectionDependencies) {}

  async execute(id: InspectionId): Promise<void> {
    const { inspections, clock } = this.dependencies;
    const inspection = await inspections.findById(id);
    if (inspection === undefined) {
      throw new InspectionNotFoundError(id);
    }
    try {
      const evidence = await this.detonate(inspection);
      await this.judge(inspection, evidence);
    } catch (error) {
      inspection.fail(error instanceof Error ? error.message : String(error), clock.now());
      await inspections.save(inspection);
    }
  }

  private async detonate(inspection: Inspection): Promise<Evidence> {
    const { sandbox, inspections, clock } = this.dependencies;
    const evidence = await sandbox.detonate(inspection.suspiciousLink);
    inspection.recordEvidence(evidence, clock.now());
    await inspections.save(inspection);
    return evidence;
  }

  private async judge(inspection: Inspection, evidence: Evidence): Promise<void> {
    const { reportWriter, inspections, clock } = this.dependencies;
    const visual = await this.describeLandingPage(evidence);
    const assessment = RiskAssessment.of(evidence, visual);
    const report = await reportWriter.write({ link: inspection.suspiciousLink, assessment, visual });
    inspection.conclude({ visual, assessment, report }, clock.now());
    await inspections.save(inspection);
  }

  /** The visual opinion enriches the verdict but is not required for it, so its failures are tolerated. */
  private async describeLandingPage(evidence: Evidence): Promise<VisualAssessment> {
    const [screenshot] = evidence.screenshots;
    if (evidence.landingPage === null || screenshot === undefined) {
      return VisualAssessment.unavailable('No page was displayed, so there was nothing to look at.');
    }
    try {
      return await this.dependencies.visualAnalyst.describe(evidence.landingPage, screenshot);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return VisualAssessment.unavailable(`Visual analysis unavailable: ${reason}`);
    }
  }
}
