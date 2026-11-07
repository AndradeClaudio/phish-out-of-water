/** The plain-language answer given to the person who submitted the link. */
export class Report {
  readonly headline: string;
  readonly explanation: string;
  readonly advice: readonly string[];

  constructor(details: { headline: string; explanation: string; advice: readonly string[] }) {
    if (details.headline.trim().length === 0) {
      throw new Error('A report needs a headline.');
    }
    if (details.explanation.trim().length === 0) {
      throw new Error('A report needs an explanation.');
    }
    this.headline = details.headline.trim();
    this.explanation = details.explanation.trim();
    this.advice = details.advice.map((tip) => tip.trim()).filter(Boolean);
  }
}
