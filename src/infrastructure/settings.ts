import type { ChromiumSandboxMode, DockerSandboxSettings } from './sandbox/docker-detonation-runner.js';

/** Extra time the app waits for the broker on top of the sandbox limit (container start-up and clean-up). */
const BROKER_GRACE_SECONDS = 30;

/**
 * How the web app reaches a sandbox: through the detonation broker's socket (production, the app has no
 * Docker access) or by starting containers itself (local development).
 */
export type SandboxAccess =
  | { readonly kind: 'broker'; readonly socketPath: string; readonly timeoutSeconds: number }
  | { readonly kind: 'direct'; readonly docker: DockerSandboxSettings };

export interface Settings {
  readonly host: string;
  readonly port: number;
  readonly inference: { readonly apiKey: string; readonly baseUrl: string; readonly visionModel: string; readonly reportModel: string };
  readonly sandbox: SandboxAccess;
  readonly maxConcurrentInspections: number;
}

export interface BrokerSettings {
  readonly socketPath: string;
  readonly docker: DockerSandboxSettings;
  readonly maxConcurrentDetonations: number;
}

export function readSettings(environment: NodeJS.ProcessEnv): Settings {
  const docker = readDockerSandboxSettings(environment);
  const brokerSocket = environment.SANDBOX_BROKER_SOCKET || null;
  return {
    host: environment.HOST || '0.0.0.0',
    port: positiveInteger(environment, 'PORT', 8080),
    inference: {
      apiKey: required(environment, 'VULTR_INFERENCE_API_KEY'),
      baseUrl: environment.VULTR_INFERENCE_BASE_URL || 'https://api.vultrinference.com/v1',
      visionModel: environment.VULTR_VISION_MODEL || 'qwen3.8-flash-next',
      reportModel: environment.VULTR_REPORT_MODEL || 'qwen3.8-flash-next',
    },
    sandbox:
      brokerSocket === null
        ? { kind: 'direct', docker }
        : { kind: 'broker', socketPath: brokerSocket, timeoutSeconds: docker.timeoutSeconds + BROKER_GRACE_SECONDS },
    maxConcurrentInspections: positiveInteger(environment, 'MAX_CONCURRENT_INSPECTIONS', 2),
  };
}

export function readBrokerSettings(environment: NodeJS.ProcessEnv): BrokerSettings {
  return {
    socketPath: required(environment, 'SANDBOX_BROKER_SOCKET'),
    docker: readDockerSandboxSettings(environment),
    maxConcurrentDetonations: positiveInteger(environment, 'MAX_CONCURRENT_INSPECTIONS', 2),
  };
}

function readDockerSandboxSettings(environment: NodeJS.ProcessEnv): DockerSandboxSettings {
  return {
    image: environment.SANDBOX_IMAGE || 'phish-out-of-water/detonator:latest',
    network: environment.SANDBOX_NETWORK || 'pootw-sandbox',
    runtime: environment.SANDBOX_RUNTIME || null,
    resolverConfig: environment.SANDBOX_RESOLV_CONF || null,
    chromiumSandbox: chromiumSandboxMode(environment, 'SANDBOX_CHROMIUM_SANDBOX'),
    timeoutSeconds: positiveInteger(environment, 'SANDBOX_TIMEOUT_SECONDS', 75),
  };
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required environment variable ${name}.`);
  }
  return value;
}

function chromiumSandboxMode(environment: NodeJS.ProcessEnv, name: string): ChromiumSandboxMode {
  const raw = environment[name] || 'enabled';
  if (raw !== 'enabled' && raw !== 'disabled') {
    throw new Error(`${name} must be "enabled" or "disabled", got "${raw}".`);
  }
  return raw;
}

function positiveInteger(environment: NodeJS.ProcessEnv, name: string, defaultValue: number): number {
  const raw = environment[name];
  if (raw === undefined || raw === '') {
    return defaultValue;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got "${raw}".`);
  }
  return value;
}
