import { connect, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { WebAddress as Address, type WebAddress } from '../../src/domain/web-address.js';
import { DetonationBroker } from '../../src/infrastructure/sandbox/broker/detonation-broker.js';
import { BrokeredSandbox } from '../../src/infrastructure/sandbox/brokered-sandbox.js';
import type { DetonationRunner } from '../../src/infrastructure/sandbox/docker-detonation-runner.js';

const JPEG_BASE64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString('base64');

function reportFor(link: string): string {
  const report = {
    navigationPath: [link],
    landingPage: { url: link, title: 'Pay the fee', requestedData: ['payment-card'], formDestinations: [], visibleText: 'Pay now' },
    downloads: [],
    screenshots: [{ caption: 'Landing page', mediaType: 'image/jpeg', base64Content: JPEG_BASE64 }],
    unreachableReason: null,
  };
  return `DETONATION_REPORT ${JSON.stringify(report)}\n`;
}

class RecordingRunner implements DetonationRunner {
  readonly openedLinks: string[] = [];
  async run(link: WebAddress): Promise<string> {
    this.openedLinks.push(link.href);
    return reportFor(link.href);
  }
}

let server: Server | undefined;

function socketPath(): string {
  const name = `pootw-broker-test-${process.pid}-${Math.random().toString(36).slice(2)}`;
  return process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : join(tmpdir(), `${name}.sock`);
}

async function startBroker(runner: DetonationRunner, maxConcurrentDetonations = 2): Promise<string> {
  const path = socketPath();
  server = new DetonationBroker(runner, { maxConcurrentDetonations }).createServer();
  await new Promise<void>((resolve) => server!.listen(path, resolve));
  return path;
}

function rawRequest(path: string, line: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const connection = connect(path, () => connection.write(line));
    let answer = '';
    connection.setEncoding('utf8');
    connection.on('data', (chunk: string) => (answer += chunk));
    connection.on('end', () => resolve(answer));
    connection.on('error', reject);
  });
}

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

describe('DetonationBroker with BrokeredSandbox', () => {
  it('opens a public link through the broker and turns the report into evidence', async () => {
    const runner = new RecordingRunner();
    const sandbox = new BrokeredSandbox({ socketPath: await startBroker(runner), timeoutSeconds: 5 });

    const evidence = await sandbox.detonate(Address.of('https://scam.example/track'));

    expect(runner.openedLinks).toEqual(['https://scam.example/track']);
    expect(evidence.landingPage?.title).toBe('Pay the fee');
  });

  it('refuses links to private networks even if the web app was tricked into sending one', async () => {
    const runner = new RecordingRunner();
    const path = await startBroker(runner);

    const answer = await rawRequest(path, '{"link":"http://169.254.169.254/latest/meta-data"}\n');

    expect(JSON.parse(answer)).toEqual({ error: 'This link cannot be opened.' });
    expect(runner.openedLinks).toEqual([]);
  });

  it('refuses anything that is not a web address', async () => {
    const runner = new RecordingRunner();
    const path = await startBroker(runner);

    expect(JSON.parse(await rawRequest(path, '{"link":"file:///etc/passwd"}\n'))).toHaveProperty('error');
    expect(JSON.parse(await rawRequest(path, 'not json at all\n'))).toHaveProperty('error');
    expect(JSON.parse(await rawRequest(path, `${'x'.repeat(10_000)}\n`))).toHaveProperty('error');
    expect(runner.openedLinks).toEqual([]);
  });

  it('turns broker errors into a sandbox failure', async () => {
    const failingRunner: DetonationRunner = { run: async () => Promise.reject(new Error('The sandbox stopped unexpectedly.')) };
    const sandbox = new BrokeredSandbox({ socketPath: await startBroker(failingRunner), timeoutSeconds: 5 });

    await expect(sandbox.detonate(Address.of('https://scam.example/'))).rejects.toThrow('The sandbox stopped unexpectedly.');
  });

  it('reports the sandbox as unavailable when the broker is not running', async () => {
    const sandbox = new BrokeredSandbox({ socketPath: socketPath(), timeoutSeconds: 5 });

    await expect(sandbox.detonate(Address.of('https://scam.example/'))).rejects.toThrow('not available right now');
  });
});
