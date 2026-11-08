import { describe, expect, it } from 'vitest';
import { InvalidDetonationReportError, parseDetonationReport } from '../../src/infrastructure/sandbox/detonation-report.js';

const REAL_JPEG_BASE64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]).toString('base64');
const HTML_BASE64 = Buffer.from('<script>alert(document.cookie)</script>').toString('base64');

function sandboxOutput(overrides: Record<string, unknown> = {}): string {
  const report = {
    navigationPath: ['https://scam.example/'],
    landingPage: {
      url: 'https://scam.example/',
      title: 'Pay the fee',
      requestedData: ['payment-card'],
      formDestinations: ['https://collector.example/submit'],
      visibleText: 'Your parcel is on hold.',
    },
    downloads: [{ fileName: 'tracker.apk', sourceUrl: 'https://scam.example/tracker.apk', sha256: 'a'.repeat(64), sizeInBytes: 193 }],
    screenshots: [{ caption: 'Landing page', mediaType: 'image/jpeg', base64Content: REAL_JPEG_BASE64 }],
    unreachableReason: null,
    ...overrides,
  };
  return `browser noise\nDETONATION_REPORT ${JSON.stringify(report)}\n`;
}

describe('parseDetonationReport', () => {
  it('reads a well-formed report', () => {
    const report = parseDetonationReport(sandboxOutput());

    expect(report.landingPage?.title).toBe('Pay the fee');
    expect(report.downloads[0]?.sha256).toBe('a'.repeat(64));
    expect(report.screenshots).toHaveLength(1);
  });

  it('drops a "screenshot" whose bytes are HTML, so it can never be served as a page', () => {
    const report = parseDetonationReport(
      sandboxOutput({ screenshots: [{ caption: 'x', mediaType: 'image/jpeg', base64Content: HTML_BASE64 }] }),
    );

    expect(report.screenshots).toEqual([]);
  });

  it('drops a screenshot that claims a media type other than JPEG or PNG', () => {
    const report = parseDetonationReport(
      sandboxOutput({ screenshots: [{ caption: 'x', mediaType: 'text/html', base64Content: REAL_JPEG_BASE64 }] }),
    );

    expect(report.screenshots).toEqual([]);
  });

  it('rejects a download fingerprint that is not a SHA-256 hash', () => {
    const output = sandboxOutput({
      downloads: [{ fileName: 'x.apk', sourceUrl: 'https://scam.example/x.apk', sha256: 'not-a-hash', sizeInBytes: 1 }],
    });

    expect(() => parseDetonationReport(output)).toThrow(InvalidDetonationReportError);
  });

  it('rejects fields with the wrong type', () => {
    expect(() => parseDetonationReport(sandboxOutput({ navigationPath: 'https://scam.example/' }))).toThrow(InvalidDetonationReportError);
  });

  it('rejects a report that is not valid JSON', () => {
    expect(() => parseDetonationReport('DETONATION_REPORT {not json')).toThrow(InvalidDetonationReportError);
  });

  it('caps oversized text and lists', () => {
    const report = parseDetonationReport(
      sandboxOutput({ navigationPath: Array.from({ length: 500 }, (_, index) => `https://hop${index}.example/`) }),
    );

    expect(report.navigationPath.length).toBeLessThanOrEqual(50);
  });
});
