/** Composition root: wires the adapters to the use cases and starts the web server. */
import { fileURLToPath } from 'node:url';
import { FollowInspection } from './application/follow-inspection.js';
import { OpenInspection } from './application/open-inspection.js';
import type { Clock } from './application/ports.js';
import { RunInspection } from './application/run-inspection.js';
import { InProcessInspectionScheduler } from './infrastructure/in-process-inspection-scheduler.js';
import { ReportWriterWithFallback } from './infrastructure/inference/report-writer-with-fallback.js';
import { TemplateReportWriter } from './infrastructure/inference/template-report-writer.js';
import { VultrInferenceClient } from './infrastructure/inference/vultr-inference-client.js';
import { VultrReportWriter } from './infrastructure/inference/vultr-report-writer.js';
import { VultrVisualAnalyst } from './infrastructure/inference/vultr-visual-analyst.js';
import { InMemoryInspectionRepository } from './infrastructure/persistence/in-memory-inspection-repository.js';
import { DockerSandbox } from './infrastructure/sandbox/docker-sandbox.js';
import { readSettings } from './infrastructure/settings.js';
import { buildHttpServer } from './interface/http/http-server.js';

const settings = readSettings(process.env);
const clock: Clock = { now: () => new Date() };
const inspections = new InMemoryInspectionRepository();
const inference = new VultrInferenceClient(settings.inference);

const runInspection = new RunInspection({
  inspections,
  clock,
  sandbox: new DockerSandbox(settings.sandbox),
  visualAnalyst: new VultrVisualAnalyst(inference, settings.inference.visionModel),
  reportWriter: new ReportWriterWithFallback(
    new VultrReportWriter(inference, settings.inference.reportModel),
    new TemplateReportWriter(),
    (error) => console.warn('Report model unavailable, using the template report.', error),
  ),
});

const scheduler = new InProcessInspectionScheduler({
  maxConcurrent: settings.maxConcurrentInspections,
  runInspection: (id) => runInspection.execute(id),
  onUnexpectedError: (error) => console.error('Inspection run crashed.', error),
});

const server = buildHttpServer({
  openInspection: new OpenInspection(inspections, scheduler, clock),
  followInspection: new FollowInspection(inspections),
  publicDirectory: fileURLToPath(new URL('../public', import.meta.url)),
});

await server.listen({ port: settings.port, host: '0.0.0.0' });
