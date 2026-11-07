import type { Evidence } from './evidence.js';
import type { Report } from './report.js';
import type { RiskAssessment } from './risk-assessment.js';
import type { VisualAssessment } from './visual-assessment.js';
import type { WebAddress } from './web-address.js';

export class ForbiddenInspectionTargetError extends Error {
  override readonly name = 'ForbiddenInspectionTargetError';
}

export class InspectionStateError extends Error {
  override readonly name = 'InspectionStateError';
}

export class InspectionId {
  private constructor(readonly value: string) {}

  static generate(): InspectionId {
    return new InspectionId(crypto.randomUUID());
  }

  static of(value: string): InspectionId {
    if (!/^[0-9a-f-]{36}$/i.test(value)) {
      throw new Error(`"${value}" is not a valid inspection id.`);
    }
    return new InspectionId(value.toLowerCase());
  }

  toString(): string {
    return this.value;
  }
}

export type InspectionStatus = 'detonating' | 'analyzing' | 'concluded' | 'failed';

export interface TimelineEntry {
  readonly at: Date;
  readonly message: string;
}

export interface Conclusion {
  readonly visual: VisualAssessment;
  readonly assessment: RiskAssessment;
  readonly report: Report;
}

/**
 * Aggregate root: one suspicious link being opened in a disposable sandbox, analysed and judged.
 * Lifecycle: detonating → analyzing → concluded, or → failed at any point before concluding.
 */
export class Inspection {
  private currentStatus: InspectionStatus = 'detonating';
  private readonly entries: TimelineEntry[] = [];
  private collectedEvidence: Evidence | null = null;
  private reachedConclusion: Conclusion | null = null;
  private failure: string | null = null;

  private constructor(
    readonly id: InspectionId,
    readonly suspiciousLink: WebAddress,
    readonly openedAt: Date,
  ) {}

  static open(details: { id: InspectionId; suspiciousLink: WebAddress; now: Date }): Inspection {
    if (details.suspiciousLink.pointsToPrivateNetwork()) {
      throw new ForbiddenInspectionTargetError('Only public internet links can be inspected.');
    }
    const inspection = new Inspection(details.id, details.suspiciousLink, details.now);
    inspection.note(details.now, `Opening ${details.suspiciousLink.hostname} inside a disposable, isolated sandbox.`);
    return inspection;
  }

  recordEvidence(evidence: Evidence, now: Date): void {
    this.ensureStatus('detonating', 'record evidence');
    this.collectedEvidence = evidence;
    this.narrateEvidence(evidence, now);
    this.note(now, 'Sandbox destroyed. Nothing the page ran or downloaded survived.');
    this.currentStatus = 'analyzing';
    this.note(now, 'Analysing what the page showed and asked for.');
  }

  conclude(conclusion: Conclusion, now: Date): void {
    this.ensureStatus('analyzing', 'conclude');
    this.reachedConclusion = conclusion;
    this.currentStatus = 'concluded';
    this.note(now, `Verdict: ${conclusion.assessment.verdict.replaceAll('-', ' ')}.`);
  }

  fail(reason: string, now: Date): void {
    if (this.isFinished()) {
      throw new InspectionStateError(`Cannot fail an inspection that is already ${this.currentStatus}.`);
    }
    this.failure = reason;
    this.currentStatus = 'failed';
    this.note(now, `The inspection could not be completed: ${reason}`);
  }

  isFinished(): boolean {
    return this.currentStatus === 'concluded' || this.currentStatus === 'failed';
  }

  get status(): InspectionStatus {
    return this.currentStatus;
  }

  get timeline(): readonly TimelineEntry[] {
    return [...this.entries];
  }

  get evidence(): Evidence | null {
    return this.collectedEvidence;
  }

  get conclusion(): Conclusion | null {
    return this.reachedConclusion;
  }

  get failureReason(): string | null {
    return this.failure;
  }

  private narrateEvidence(evidence: Evidence, now: Date): void {
    evidence.navigationPath.slice(1).forEach((address) => this.note(now, `Redirected to ${address.hostname}.`));
    evidence.downloadAttempts.forEach((download) =>
      this.note(now, `Caught a download of "${download.fileName}". It was kept inside the sandbox and never reached you.`),
    );
    if (evidence.landingPage !== null) {
      this.note(now, `Landed on ${evidence.landingPage.address.hostname} and took a screenshot.`);
    }
    if (evidence.unreachableReason !== null) {
      this.note(now, `The page could not be fully loaded: ${evidence.unreachableReason}`);
    }
  }

  private ensureStatus(expected: InspectionStatus, action: string): void {
    if (this.currentStatus !== expected) {
      throw new InspectionStateError(`Cannot ${action} while the inspection is ${this.currentStatus}.`);
    }
  }

  private note(at: Date, message: string): void {
    this.entries.push({ at, message });
  }
}
