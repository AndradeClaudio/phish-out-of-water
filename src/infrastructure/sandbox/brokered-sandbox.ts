import { connect } from 'node:net';
import type { Sandbox } from '../../application/ports.js';
import type { Evidence } from '../../domain/evidence.js';
import type { WebAddress } from '../../domain/web-address.js';
import { encodeLine, MAX_RESPONSE_BYTES, type DetonationResponse } from './broker/broker-protocol.js';
import { parseDetonationReport, toEvidence } from './detonation-report.js';

export interface BrokeredSandboxSettings {
  /** Unix socket (or Windows named pipe) the detonation broker listens on. */
  readonly socketPath: string;
  /** How long to wait for the broker, including container start-up and the sandbox time limit. */
  readonly timeoutSeconds: number;
}

const UNAVAILABLE_MESSAGE = 'The sandbox is not available right now. Please try again in a moment.';

/**
 * Production sandbox: asks the detonation broker to open the link. The web app itself has no Docker
 * access, so a compromise of the app cannot start arbitrary containers or reach the host.
 */
export class BrokeredSandbox implements Sandbox {
  constructor(private readonly settings: BrokeredSandboxSettings) {}

  async detonate(link: WebAddress): Promise<Evidence> {
    const response = await this.askBroker(link);
    if ('error' in response) {
      throw new Error(response.error);
    }
    return toEvidence(parseDetonationReport(response.output), link);
  }

  private askBroker(link: WebAddress): Promise<DetonationResponse> {
    return new Promise((resolve, reject) => {
      const connection = connect(this.settings.socketPath);
      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      const fail = (reason: string, cause?: unknown) => {
        console.error(`Detonation broker: ${reason}`, cause ?? '');
        connection.destroy();
        reject(new Error(UNAVAILABLE_MESSAGE));
      };

      connection.setTimeout(this.settings.timeoutSeconds * 1000, () => fail('no answer in time.'));
      connection.on('connect', () => connection.write(encodeLine({ link: link.href })));
      connection.on('error', (error) => fail('connection failed.', error));
      connection.on('data', (chunk: Buffer) => {
        receivedBytes += chunk.length;
        if (receivedBytes > MAX_RESPONSE_BYTES) {
          fail('answer too large.');
          return;
        }
        chunks.push(chunk);
      });
      connection.on('end', () => {
        try {
          resolve(readResponse(Buffer.concat(chunks).toString('utf8')));
        } catch (error) {
          fail('unreadable answer.', error);
        }
      });
    });
  }
}

function readResponse(raw: string): DetonationResponse {
  const response: unknown = JSON.parse(raw);
  if (typeof response === 'object' && response !== null) {
    const { output, error } = response as { output?: unknown; error?: unknown };
    if (typeof output === 'string') return { output };
    if (typeof error === 'string') return { error };
  }
  throw new Error('The broker answered in an unknown format.');
}
