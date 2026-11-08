/**
 * Runs inside a disposable container. Opens one link in a headless mobile browser,
 * records where it goes, what it asks for and what it tries to download,
 * and prints a single DetonationReport line to stdout. The container is destroyed afterwards.
 */
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { chromium, devices, type Download, type Page } from 'playwright-core';

const REPORT_PREFIX = 'DETONATION_REPORT ';
const NAVIGATION_TIMEOUT_MS = 25_000;
const SETTLE_TIMEOUT_MS = 8_000;
const LATE_REDIRECT_GRACE_MS = 3_000;
const DOWNLOAD_CAPTURE_TIMEOUT_MS = 15_000;
const VISIBLE_TEXT_LIMIT = 2_000;

/**
 * Chromium's own sandbox (namespaces + seccomp-BPF per renderer) is an extra layer inside the container.
 * It works under gVisor but not under Docker's default runtime, so it is required unless explicitly
 * disabled for local development: we never silently fall back to a weaker sandbox.
 */
function chromiumSandboxIsRequired(): boolean {
  const setting = process.env.CHROMIUM_SANDBOX ?? 'enabled';
  if (setting !== 'enabled' && setting !== 'disabled') {
    throw new Error(`CHROMIUM_SANDBOX must be "enabled" or "disabled", got "${setting}".`);
  }
  return setting === 'enabled';
}

interface CapturedDownload {
  fileName: string;
  sourceUrl: string;
  sha256: string | null;
  sizeInBytes: number | null;
}

interface ObservedPage {
  url: string;
  title: string;
  requestedData: string[];
  formDestinations: string[];
  visibleText: string;
}

interface DetonationReport {
  navigationPath: string[];
  landingPage: ObservedPage | null;
  downloads: CapturedDownload[];
  screenshots: { caption: string; mediaType: 'image/jpeg'; base64Content: string }[];
  unreachableReason: string | null;
}

async function detonate(link: string): Promise<DetonationReport> {
  const browser = await chromium.launch({ headless: true, chromiumSandbox: chromiumSandboxIsRequired() });
  try {
    const context = await browser.newContext({ ...devices['Pixel 7'], acceptDownloads: true, locale: 'en-US' });
    const page = await context.newPage();
    const navigationPath = trackMainFrameNavigation(page);
    const pendingDownloads: Promise<CapturedDownload>[] = [];
    page.on('download', (download) => pendingDownloads.push(captureDownload(download)));

    const unreachableReason = await openAndSettle(page, link);
    const downloads = await Promise.all(pendingDownloads);
    const landingPage = await observeLandingPage(page);
    const screenshots = landingPage === null ? [] : [await takeScreenshot(page)];

    return { navigationPath: withSubmittedLinkFirst(link, navigationPath), landingPage, downloads, screenshots, unreachableReason };
  } finally {
    await browser.close();
  }
}

function trackMainFrameNavigation(page: Page): string[] {
  const path: string[] = [];
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame() && path.at(-1) !== request.url()) {
      path.push(request.url());
    }
  });
  return path;
}

async function openAndSettle(page: Page, link: string): Promise<string | null> {
  let unreachableReason: string | null = null;
  try {
    await page.goto(link, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT_MS });
  } catch (error) {
    unreachableReason = describeNavigationFailure(error);
  }
  await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => undefined);
  await page.waitForTimeout(LATE_REDIRECT_GRACE_MS);
  await page.waitForLoadState('load', { timeout: SETTLE_TIMEOUT_MS }).catch(() => undefined);
  return unreachableReason;
}

function describeNavigationFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('Download is starting')) {
    return 'the link went straight to a file download instead of a page';
  }
  const networkError = /net::(ERR_[A-Z_]+)/.exec(message)?.[1];
  if (networkError !== undefined) {
    return `the site did not respond (${networkError})`;
  }
  if (message.includes('Timeout')) {
    return 'the page took too long to load';
  }
  return message.split('\n')[0] ?? 'unknown navigation error';
}

/** The file is fingerprinted and then discarded together with the container; it never leaves the sandbox. */
async function captureDownload(download: Download): Promise<CapturedDownload> {
  const fileName = download.suggestedFilename();
  const sourceUrl = download.url();
  try {
    const filePath = await withTimeout(download.path(), DOWNLOAD_CAPTURE_TIMEOUT_MS);
    const [content, info] = await Promise.all([readFile(filePath), stat(filePath)]);
    return { fileName, sourceUrl, sha256: createHash('sha256').update(content).digest('hex'), sizeInBytes: info.size };
  } catch {
    return { fileName, sourceUrl, sha256: null, sizeInBytes: null };
  }
}

async function observeLandingPage(page: Page): Promise<ObservedPage | null> {
  const url = page.url();
  if (!url.startsWith('http')) {
    return null;
  }
  const frameFindings = await Promise.all(page.frames().map((frame) => frame.evaluate(inspectDocument).catch(() => null)));
  const findings = frameFindings.filter((finding) => finding !== null);
  const mainFinding = findings[0];
  return {
    url,
    title: mainFinding?.title ?? '',
    requestedData: [...new Set(findings.flatMap((finding) => finding.requestedData))],
    formDestinations: [...new Set(findings.flatMap((finding) => finding.formDestinations))],
    visibleText: mainFinding?.visibleText ?? '',
  };
}

/** Executed inside the inspected page, so it must be self-contained. */
function inspectDocument(): { title: string; requestedData: string[]; formDestinations: string[]; visibleText: string } {
  const requestedData = new Set<string>();
  const hintsFor = (field: HTMLInputElement | HTMLSelectElement): string =>
    [field.name, field.id, field.getAttribute('placeholder'), field.getAttribute('aria-label'), field.autocomplete, field.labels?.[0]?.textContent]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

  for (const field of Array.from(document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'))) {
    if (field instanceof HTMLInputElement && ['hidden', 'submit', 'button', 'checkbox', 'radio'].includes(field.type)) {
      continue;
    }
    const hints = hintsFor(field);
    if ((field instanceof HTMLInputElement && field.type === 'password') || /password|passcode|senha|\bpin\b/.test(hints)) {
      requestedData.add('password');
    }
    if (/cc-|card|cart[aã]o|cvv|cvc|security code|expir|validade/.test(hints)) {
      requestedData.add('payment-card');
    }
    if (/one-time-code|\botp\b|verification code|sms code|c[oó]digo/.test(hints)) {
      requestedData.add('one-time-code');
    }
    if (/\bcpf\b|\bssn\b|social security|national id|passport|\brg\b/.test(hints)) {
      requestedData.add('national-id');
    }
  }

  const formDestinations = Array.from(document.forms)
    .map((form) => form.action)
    .filter((action) => action.startsWith('http'));
  const visibleText = (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 2_000);
  return { title: document.title, requestedData: [...requestedData], formDestinations, visibleText };
}

async function takeScreenshot(page: Page): Promise<DetonationReport['screenshots'][number]> {
  const image = await page.screenshot({ type: 'jpeg', quality: 70 });
  return { caption: 'What the link showed inside the sandbox', mediaType: 'image/jpeg', base64Content: image.toString('base64') };
}

function withSubmittedLinkFirst(link: string, navigationPath: string[]): string[] {
  return navigationPath[0] === link ? navigationPath : [link, ...navigationPath];
}

function withTimeout<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), milliseconds)),
  ]);
}

const link = process.argv[2];
if (link === undefined) {
  console.error('Usage: detonate <link>');
  process.exit(2);
}
const report = await detonate(link);
process.stdout.write(`${REPORT_PREFIX}${JSON.stringify(report)}\n`);
