import { describe, expect, it } from 'vitest';
import { ForbiddenInspectionTargetError, Inspection, InspectionId, InspectionStateError } from '../../src/domain/inspection.js';
import { Report } from '../../src/domain/report.js';
import { RiskAssessment } from '../../src/domain/risk-assessment.js';
import { WebAddress } from '../../src/domain/web-address.js';
import { evidenceOf, NOTHING_SEEN } from './builders.js';

const NOW = new Date('2026-11-07T12:00:00Z');

function openInspectionOf(link: string): Inspection {
  return Inspection.open({ id: InspectionId.generate(), suspiciousLink: WebAddress.of(link), now: NOW });
}

const REPORT = new Report({ headline: 'Safe', explanation: 'Nothing found.', advice: [] });

describe('Inspection', () => {
  it('refuses to open links into private networks', () => {
    expect(() => openInspectionOf('http://169.254.169.254/latest/meta-data')).toThrow(ForbiddenInspectionTargetError);
  });

  it('goes from detonating to analyzing to concluded', () => {
    const inspection = openInspectionOf('https://example.com/');
    const evidence = evidenceOf({ path: ['https://example.com/'] });

    expect(inspection.status).toBe('detonating');
    inspection.recordEvidence(evidence, NOW);
    expect(inspection.status).toBe('analyzing');
    inspection.conclude({ visual: NOTHING_SEEN, assessment: RiskAssessment.of(evidence, NOTHING_SEEN), report: REPORT }, NOW);

    expect(inspection.status).toBe('concluded');
    expect(inspection.conclusion?.assessment.verdict).toBe('no-threats-found');
  });

  it('tells the story of the containment in its timeline', () => {
    const inspection = openInspectionOf('https://bit.ly/x');

    inspection.recordEvidence(evidenceOf({ path: ['https://bit.ly/x', 'https://scam.example/'], downloads: ['bank.apk'] }), NOW);

    const messages = inspection.timeline.map((entry) => entry.message).join('\n');
    expect(messages).toContain('Redirected to scam.example');
    expect(messages).toContain('"bank.apk"');
    expect(messages).toContain('Sandbox destroyed');
  });

  it('cannot conclude before evidence was recorded', () => {
    const inspection = openInspectionOf('https://example.com/');
    const evidence = evidenceOf({ path: ['https://example.com/'] });

    expect(() =>
      inspection.conclude({ visual: NOTHING_SEEN, assessment: RiskAssessment.of(evidence, NOTHING_SEEN), report: REPORT }, NOW),
    ).toThrow(InspectionStateError);
  });

  it('cannot fail once concluded', () => {
    const inspection = openInspectionOf('https://example.com/');
    const evidence = evidenceOf({ path: ['https://example.com/'] });
    inspection.recordEvidence(evidence, NOW);
    inspection.conclude({ visual: NOTHING_SEEN, assessment: RiskAssessment.of(evidence, NOTHING_SEEN), report: REPORT }, NOW);

    expect(() => inspection.fail('late error', NOW)).toThrow(InspectionStateError);
  });
});
