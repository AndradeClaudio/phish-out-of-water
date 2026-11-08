import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { Sandbox } from '../../application/ports.js';
import type { Evidence } from '../../domain/evidence.js';
import type { WebAddress } from '../../domain/web-address.js';
import { parseDetonationReport, toEvidence } from './detonation-report.js';

const runCommand = promisify(execFile);
/** A real report (evidence plus one JPEG screenshot) is well under 1 MB. */
const MAX_REPORT_BYTES = 8 * 1024 * 1024;
const MAX_DIAGNOSTICS_CHARACTERS = 4_000;

export interface DockerSandboxSettings {
  readonly image: string;
  readonly network: string;
  /** e.g. "runsc" for gVisor; null uses Docker's default runtime. */
  readonly runtime: string | null;
  /**
   * Host file mounted as the sandbox's /etc/resolv.conf; null keeps Docker's embedded DNS.
   * Needed under gVisor, which cannot reach Docker's embedded DNS server (127.0.0.11).
   */
  readonly resolverConfig: string | null;
  /** Chromium's own sandbox inside the container. Only works under gVisor; disable it for local runc. */
  readonly chromiumSandbox: ChromiumSandboxMode;
  readonly timeoutSeconds: number;
}

export type ChromiumSandboxMode = 'enabled' | 'disabled';

/**
 * One throwaway container per link: read-only filesystem, no Linux capabilities,
 * capped memory/CPU/processes, its own network, removed as soon as it finishes or times out.
 */
export class DockerSandbox implements Sandbox {
  constructor(private readonly settings: DockerSandboxSettings) {}

  async detonate(link: WebAddress): Promise<Evidence> {
    const containerName = `pootw-detonation-${crypto.randomUUID()}`;
    try {
      const output = await this.runContainer(containerName, link);
      return toEvidence(parseDetonationReport(output), link);
    } finally {
      await this.destroy(containerName);
    }
  }

  private runContainer(containerName: string, link: WebAddress): Promise<string> {
    return new Promise((resolve, reject) => {
      const container = spawn('docker', this.runArguments(containerName, link), { stdio: ['ignore', 'pipe', 'pipe'] });
      const outputChunks: Buffer[] = [];
      let outputBytes = 0;
      let diagnostics = '';
      const timer = setTimeout(() => {
        void this.destroy(containerName);
        reject(new Error(`The sandbox exceeded its ${this.settings.timeoutSeconds}s time limit and was destroyed.`));
      }, this.settings.timeoutSeconds * 1000);

      // The container's output is hostile input: a compromised sandbox must not be able to exhaust our memory.
      container.stdout.on('data', (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > MAX_REPORT_BYTES) {
          clearTimeout(timer);
          void this.destroy(containerName);
          console.error(`Sandbox ${containerName} produced more than ${MAX_REPORT_BYTES} bytes and was destroyed.`);
          reject(new Error('The sandbox stopped unexpectedly. Please try again in a moment.'));
          return;
        }
        outputChunks.push(chunk);
      });
      container.stderr.on('data', (chunk: Buffer) => (diagnostics = (diagnostics + chunk.toString()).slice(-MAX_DIAGNOSTICS_CHARACTERS)));
      container.on('error', (error) => {
        clearTimeout(timer);
        console.error(`Sandbox ${containerName} could not start.`, error);
        reject(new Error('The sandbox is not available right now. Please try again in a moment.'));
      });
      container.on('close', (exitCode) => {
        clearTimeout(timer);
        if (exitCode === 0) {
          resolve(Buffer.concat(outputChunks).toString('utf8'));
          return;
        }
        console.error(`Sandbox ${containerName} exited with code ${exitCode}.`, diagnostics.trim().slice(-2000));
        reject(new Error('The sandbox stopped unexpectedly. Please try again in a moment.'));
      });
    });
  }

  private runArguments(containerName: string, link: WebAddress): string[] {
    const runtime = this.settings.runtime === null ? [] : ['--runtime', this.settings.runtime];
    const resolver = this.settings.resolverConfig === null ? [] : ['--volume', `${this.settings.resolverConfig}:/etc/resolv.conf:ro`];
    return [
      'run', '--rm', '--name', containerName,
      ...runtime,
      '--network', this.settings.network,
      ...resolver,
      '--env', `CHROMIUM_SANDBOX=${this.settings.chromiumSandbox}`,
      '--read-only',
      '--tmpfs', '/tmp:rw,nosuid,nodev,size=256m',
      '--tmpfs', '/home/pwuser:rw,nosuid,nodev,size=128m',
      '--shm-size', '256m',
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges',
      '--pids-limit', '512',
      '--memory', '1g',
      '--cpus', '1',
      '--user', 'pwuser',
      this.settings.image,
      link.href,
    ];
  }

  private async destroy(containerName: string): Promise<void> {
    await runCommand('docker', ['rm', '--force', containerName]).catch(() => undefined);
  }
}
