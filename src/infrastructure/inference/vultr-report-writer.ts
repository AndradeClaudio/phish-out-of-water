import type { ReportBrief, ReportWriter } from '../../application/ports.js';
import { Report } from '../../domain/report.js';
import type { VultrInferenceClient } from './vultr-inference-client.js';

const INSTRUCTIONS = `You explain online scam checks to people who are not technical, such as elderly relatives.
You receive a verdict and the reasons behind it. The verdict is final: never contradict, soften or upgrade it.
Write in clear, warm, plain English. No jargon, no technical terms.

Answer with JSON only, in this exact shape:
{ "headline": string (max 12 words), "explanation": string (2-3 short sentences), "advice": string[] (2-4 short, concrete actions) }`;

interface ReportAnswer {
  headline?: unknown;
  explanation?: unknown;
  advice?: unknown;
}

export class VultrReportWriter implements ReportWriter {
  constructor(
    private readonly inference: VultrInferenceClient,
    private readonly model: string,
  ) {}

  async write(brief: ReportBrief): Promise<Report> {
    const reasons = brief.assessment.signals.map((signal) => `- (${signal.severity}) ${signal.explanation}`).join('\n');
    const answer = (await this.inference.askForJson(this.model, [
      { role: 'system', content: INSTRUCTIONS },
      {
        role: 'user',
        content: `Link checked: ${brief.link.hostname}
Verdict: ${brief.assessment.verdict}
What the page showed: ${brief.visual.pageDescription || 'unknown'}
Reasons:
${reasons || '- none found'}`,
      },
    ])) as ReportAnswer;

    return new Report({
      headline: String(answer.headline ?? ''),
      explanation: String(answer.explanation ?? ''),
      advice: Array.isArray(answer.advice) ? answer.advice.map(String) : [],
    });
  }
}
