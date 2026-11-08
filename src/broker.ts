/**
 * Composition root of the detonation broker: the only process with Docker access.
 * It listens on a local socket and opens public links in disposable sandboxes for the web app.
 */
import { rmSync } from 'node:fs';
import { DetonationBroker } from './infrastructure/sandbox/broker/detonation-broker.js';
import { DockerDetonationRunner } from './infrastructure/sandbox/docker-detonation-runner.js';
import { readBrokerSettings } from './infrastructure/settings.js';

const settings = readBrokerSettings(process.env);
const broker = new DetonationBroker(new DockerDetonationRunner(settings.docker), {
  maxConcurrentDetonations: settings.maxConcurrentDetonations,
});

// A socket file left by a previous run would make listen() fail.
rmSync(settings.socketPath, { force: true });
broker.createServer().listen(settings.socketPath, () => {
  console.log(`Detonation broker listening on ${settings.socketPath}`);
});
