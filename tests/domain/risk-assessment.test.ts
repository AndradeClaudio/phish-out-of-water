import { describe, expect, it } from 'vitest';
import { RiskAssessment } from '../../src/domain/risk-assessment.js';
import { evidenceOf, landingPageAt, NOTHING_SEEN, pageShowing } from './builders.js';

const PAYPAL = { name: 'PayPal', domains: ['paypal.com'] };

function kindsOf(assessment: RiskAssessment): string[] {
  return assessment.signals.map((signal) => signal.kind);
}

describe('RiskAssessment', () => {
  it('finds no threats on an ordinary page', () => {
    const assessment = RiskAssessment.of(evidenceOf({ path: ['https://example.com/'] }), NOTHING_SEEN);

    expect(assessment.verdict).toBe('no-threats-found');
    expect(assessment.signals).toEqual([]);
  });

  it('calls a page that pushes an app installer dangerous', () => {
    const evidence = evidenceOf({ path: ['https://track-parcel.example/'], downloads: ['DeliveryTracker.apk'] });

    const assessment = RiskAssessment.of(evidence, NOTHING_SEEN);

    expect(assessment.verdict).toBe('dangerous');
    expect(kindsOf(assessment)).toContain('software-download');
  });

  it('treats a non-executable surprise download as a warning only', () => {
    const assessment = RiskAssessment.of(evidenceOf({ path: ['https://example.com/'], downloads: ['invoice.pdf'] }), NOTHING_SEEN);

    expect(kindsOf(assessment)).toEqual(['file-download']);
    expect(assessment.verdict).toBe('no-threats-found');
  });

  it('calls a fake brand page asking for a password dangerous', () => {
    const evidence = evidenceOf({
      path: ['https://paypal-security-check.example/login'],
      landingPage: landingPageAt('https://paypal-security-check.example/login', { requestedData: ['password'] }),
    });

    const assessment = RiskAssessment.of(evidence, pageShowing(PAYPAL));

    expect(assessment.verdict).toBe('dangerous');
    expect(kindsOf(assessment)).toEqual(expect.arrayContaining(['credential-harvesting', 'brand-impersonation']));
  });

  it('trusts the real brand on its own domain, even when it asks for a password', () => {
    const evidence = evidenceOf({
      path: ['https://www.paypal.com/signin'],
      landingPage: landingPageAt('https://www.paypal.com/signin', { requestedData: ['password'] }),
    });

    const assessment = RiskAssessment.of(evidence, pageShowing(PAYPAL, ['password']));

    expect(assessment.verdict).toBe('no-threats-found');
    expect(kindsOf(assessment)).toEqual(['sensitive-data-request']);
  });

  it('is suspicious of an impersonating page even when it asks nothing yet', () => {
    const assessment = RiskAssessment.of(evidenceOf({ path: ['https://paypal-refund.example/'] }), pageShowing(PAYPAL));

    expect(assessment.verdict).toBe('suspicious');
  });

  it('relies on the vision model when the form fields are hidden from the page code', () => {
    const assessment = RiskAssessment.of(
      evidenceOf({ path: ['https://paypal-refund.example/'] }),
      pageShowing(PAYPAL, ['payment-card']),
    );

    expect(assessment.verdict).toBe('dangerous');
  });

  it('is suspicious when typed data is sent to another site', () => {
    const evidence = evidenceOf({
      path: ['https://newsletter.example/'],
      landingPage: landingPageAt('https://newsletter.example/', {
        requestedData: ['national-id'],
        formDestinations: ['https://collector.example/submit'],
      }),
    });

    expect(RiskAssessment.of(evidence, NOTHING_SEEN).verdict).toBe('suspicious');
  });

  it('is suspicious of a long cross-site redirect chain through a bare IP address', () => {
    const evidence = evidenceOf({ path: ['https://bit.ly/x', 'http://203.0.113.9/r', 'https://landing.example/'] });

    const assessment = RiskAssessment.of(evidence, NOTHING_SEEN);

    expect(kindsOf(assessment)).toEqual(expect.arrayContaining(['redirect-chain', 'raw-ip-address']));
    expect(assessment.verdict).toBe('suspicious');
  });

  it('is inconclusive when nothing could be loaded and nothing bad was seen', () => {
    const evidence = evidenceOf({ path: ['https://gone.example/'], landingPage: null });

    expect(RiskAssessment.of(evidence, NOTHING_SEEN).verdict).toBe('inconclusive');
  });

  it('is still dangerous when the link goes straight to an installer without any page', () => {
    const evidence = evidenceOf({ path: ['https://cdn.example/update.exe'], landingPage: null, downloads: ['update.exe'] });

    expect(RiskAssessment.of(evidence, NOTHING_SEEN).verdict).toBe('dangerous');
  });
});
