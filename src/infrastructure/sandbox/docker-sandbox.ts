import type { Sandbox } from '../../application/ports.js';
import type { Evidence } from '../../domain/evidence.js';
import type { WebAddress } from '../../domain/web-address.js';
import { parseDetonationReport, toEvidence } from './detonation-report.js';
import type { DetonationRunner } from './docker-detonation-runner.js';

/**
 * Sandbox that starts detonation containers from this very process. Convenient for local development;
 * in production the app talks to the broker instead (BrokeredSandbox) and has no Docker access at all.
 */
export class DockerSandbox implements Sandbox {
  constructor(private readonly runner: DetonationRunner) {}

  async detonate(link: WebAddress): Promise<Evidence> {
    const output = await this.runner.run(link);
    return toEvidence(parseDetonationReport(output), link);
  }
}
