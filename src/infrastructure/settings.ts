import type { ChromiumSandboxMode, DockerSandboxSettings } from './sandbox/docker-sandbox.js';

export interface Settings {
  readonly port: number;
  readonly inference: { readonly apiKey: string; readonly baseUrl: string; readonly visionModel: string; readonly reportModel: string };
  readonly sandbox: DockerSandboxSettings;
  readonly maxConcurrentInspections: number;
}

export function readSettings(environment: NodeJS.ProcessEnv): Settings {
  return {
    port: positiveInteger(environment, 'PORT', 8080),
    inference: {
      apiKey: required(environment, 'VULTR_INFERENCE_API_KEY'),
      baseUrl: environment.VULTR_INFERENCE_BASE_URL || 'https://api.vultrinference.com/v1',
      visionModel: environment.VULTR_VISION_MODEL || 'qwen3.8-flash-next',
      reportModel: environment.VULTR_REPORT_MODEL || 'qwen3.8-flash-next',
    },
    sandbox: {
      image: environment.SANDBOX_IMAGE || 'phish-out-of-water/detonator:latest',
      network: environment.SANDBOX_NETWORK || 'pootw-sandbox',
      runtime: environment.SANDBOX_RUNTIME || null,
      resolverConfig: environment.SANDBOX_RESOLV_CONF || null,
      chromiumSandbox: chromiumSandboxMode(environment, 'SANDBOX_CHROMIUM_SANDBOX'),
      timeoutSeconds: positiveInteger(environment, 'SANDBOX_TIMEOUT_SECONDS', 75),
    },
    maxConcurrentInspections: positiveInteger(environment, 'MAX_CONCURRENT_INSPECTIONS', 2),
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
