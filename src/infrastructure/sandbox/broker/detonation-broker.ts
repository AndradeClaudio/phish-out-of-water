import { createServer, type Server, type Socket } from 'node:net';
import { WebAddress } from '../../../domain/web-address.js';
import type { DetonationRunner } from '../docker-detonation-runner.js';
import { encodeLine, MAX_REQUEST_BYTES, type DetonationResponse } from './broker-protocol.js';

export interface DetonationBrokerSettings {
  readonly maxConcurrentDetonations: number;
}

const BUSY_MESSAGE = 'All sandboxes are busy right now. Please try again in a moment.';
const REFUSED_MESSAGE = 'This link cannot be opened.';

/**
 * The only process allowed to start detonation containers. It accepts exactly one thing, a public
 * web address, and runs it with the fixed sandbox settings. If the web app is ever compromised, this is
 * all an attacker can ask for: the same thing any visitor of the site can already do.
 */
export class DetonationBroker {
  private running = 0;

  constructor(
    private readonly runner: DetonationRunner,
    private readonly settings: DetonationBrokerSettings,
  ) {}

  createServer(): Server {
    return createServer((connection) => this.serve(connection));
  }

  private serve(connection: Socket): void {
    let request = '';
    connection.setEncoding('utf8');
    connection.on('error', () => connection.destroy());
    connection.on('data', (chunk: string) => {
      request += chunk;
      if (Buffer.byteLength(request) > MAX_REQUEST_BYTES) {
        this.reply(connection, { error: REFUSED_MESSAGE });
        return;
      }
      const lineEnd = request.indexOf('\n');
      if (lineEnd !== -1) {
        connection.removeAllListeners('data');
        void this.answer(connection, request.slice(0, lineEnd));
      }
    });
  }

  private async answer(connection: Socket, requestLine: string): Promise<void> {
    const link = readPublicLink(requestLine);
    if (link === null) {
      this.reply(connection, { error: REFUSED_MESSAGE });
      return;
    }
    if (this.running >= this.settings.maxConcurrentDetonations) {
      this.reply(connection, { error: BUSY_MESSAGE });
      return;
    }
    this.running += 1;
    try {
      this.reply(connection, { output: await this.runner.run(link) });
    } catch (error) {
      this.reply(connection, { error: error instanceof Error ? error.message : 'The sandbox stopped unexpectedly.' });
    } finally {
      this.running -= 1;
    }
  }

  private reply(connection: Socket, response: DetonationResponse): void {
    if (!connection.destroyed) {
      connection.end(encodeLine(response));
    }
  }
}

/** Re-checks what the web app already checked: the broker trusts nothing it receives. */
function readPublicLink(requestLine: string): WebAddress | null {
  try {
    const request: unknown = JSON.parse(requestLine);
    const link = typeof request === 'object' && request !== null ? (request as { link?: unknown }).link : undefined;
    if (typeof link !== 'string' || !WebAddress.isWebAddress(link)) {
      return null;
    }
    const address = WebAddress.of(link);
    return address.pointsToPrivateNetwork() ? null : address;
  } catch {
    return null;
  }
}
