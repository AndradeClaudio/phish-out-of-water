import { describe, expect, it } from 'vitest';
import { OpenInspection } from '../../src/application/open-inspection.js';
import type { InspectionScheduler, ReportWriter, Sandbox, VisualAnalyst } from '../../src/application/ports.js';
import { RunInspection } from '../../src/application/run-inspection.js';
import type { Evidence } from '../../src/domain/evidence.js';
import type { InspectionId } from '../../src/domain/inspection.js';
import { Report } from '../../src/domain/report.js';
import { InMemoryInspectionRepository } from '../../src/infrastructure/persistence/in-memory-inspection-repository.js';
import { evidenceOf, landingPageAt, pageShowing } from '../domain/builders.js';

const clock = { now: () => new Date('2026-11-07T12:00:00Z') };

function sandboxReturning(evidence: Evidence): Sandbox {
  return { detonate: async () => evidence };
}

const failingAnalyst: VisualAnalyst = {
  describe: async () => {
    throw new Error('model offline');
  },
};

const echoingReportWriter: ReportWriter = {
  write: async (brief) => new Report({ headline: brief.assessment.verdict, explanation: 'Because.', advice: [] }),
};

async function openedInspection(repository: InMemoryInspectionRepository, link: string): Promise<InspectionId> {
  const scheduled: InspectionId[] = [];
  const scheduler: InspectionScheduler = { schedule: (id) => scheduled.push(id) };
  const id = await new OpenInspection(repository, scheduler, clock).execute(link);
  expect(scheduled).toEqual([id]);
  return id;
}

describe('RunInspection', () => {
  it('detonates, judges and concludes', async () => {
    const repository = new InMemoryInspectionRepository();
    const id = await openedInspection(repository, 'paypal-check.example/login');
    const evidence = evidenceOf({
      path: ['http://paypal-check.example/login'],
      landingPage: landingPageAt('http://paypal-check.example/login', { requestedData: ['password'] }),
    });
    const analyst: VisualAnalyst = { describe: async () => pageShowing({ name: 'PayPal', domains: ['paypal.com'] }) };

    await new RunInspection({ inspections: repository, sandbox: sandboxReturning(evidence), visualAnalyst: analyst, reportWriter: echoingReportWriter, clock }).execute(id);

    const inspection = await repository.findById(id);
    expect(inspection?.status).toBe('concluded');
    expect(inspection?.conclusion?.report.headline).toBe('dangerous');
  });

  it('still reaches a verdict when the vision model is down', async () => {
    const repository = new InMemoryInspectionRepository();
    const id = await openedInspection(repository, 'https://parcel.example/');
    const evidence = evidenceOf({ path: ['https://parcel.example/'], downloads: ['Tracker.apk'] });

    await new RunInspection({ inspections: repository, sandbox: sandboxReturning(evidence), visualAnalyst: failingAnalyst, reportWriter: echoingReportWriter, clock }).execute(id);

    expect((await repository.findById(id))?.conclusion?.assessment.verdict).toBe('dangerous');
  });

  it('records a failure when the sandbox breaks', async () => {
    const repository = new InMemoryInspectionRepository();
    const id = await openedInspection(repository, 'https://example.com/');
    const brokenSandbox: Sandbox = {
      detonate: async () => {
        throw new Error('The sandbox exceeded its 75s time limit and was destroyed.');
      },
    };

    await new RunInspection({ inspections: repository, sandbox: brokenSandbox, visualAnalyst: failingAnalyst, reportWriter: echoingReportWriter, clock }).execute(id);

    const inspection = await repository.findById(id);
    expect(inspection?.status).toBe('failed');
    expect(inspection?.failureReason).toContain('time limit');
  });
});
