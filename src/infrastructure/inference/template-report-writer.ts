import type { ReportBrief, ReportWriter } from '../../application/ports.js';
import { Report } from '../../domain/report.js';
import type { Verdict } from '../../domain/risk-assessment.js';

const WORDING: Record<Verdict, { headline: string; summary: string; advice: string[] }> = {
  dangerous: {
    headline: 'Do not open this link. It is a scam.',
    summary: 'We opened it safely for you and caught it trying to harm you.',
    advice: [
      'Delete the message that contained the link.',
      'Do not type any password, card number or code it asks for.',
      'If you already did, call your bank using the number on the back of your card.',
    ],
  },
  suspicious: {
    headline: 'Be careful: this link looks suspicious.',
    summary: 'We opened it safely for you and found warning signs.',
    advice: [
      'Do not enter personal or payment details on this page.',
      'If it claims to be a company, contact that company through its official app or website.',
    ],
  },
  'no-threats-found': {
    headline: 'We found no signs of a scam.',
    summary: 'We opened it safely for you and nothing dangerous happened.',
    advice: ['Still, only share personal details if you trust who sent you the link.'],
  },
  inconclusive: {
    headline: 'We could not check this link.',
    summary: 'The page did not open, so we could not see what it does.',
    advice: ['Treat it with caution, especially if the message was unexpected or urgent.'],
  },
};

/** Deterministic report used when the language model is unavailable. */
export class TemplateReportWriter implements ReportWriter {
  async write(brief: ReportBrief): Promise<Report> {
    const wording = WORDING[brief.assessment.verdict];
    const reasons = brief.assessment.signals.map((signal) => signal.explanation).join(' ');
    return new Report({
      headline: wording.headline,
      explanation: [wording.summary, reasons].filter(Boolean).join(' '),
      advice: wording.advice,
    });
  }
}
