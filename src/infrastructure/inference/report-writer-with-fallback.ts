import type { ReportBrief, ReportWriter } from '../../application/ports.js';
import type { Report } from '../../domain/report.js';

/** The person always gets a report: if the preferred writer fails, the fallback writes it. */
export class ReportWriterWithFallback implements ReportWriter {
  constructor(
    private readonly preferred: ReportWriter,
    private readonly fallback: ReportWriter,
    private readonly onPreferredFailure: (error: unknown) => void,
  ) {}

  async write(brief: ReportBrief): Promise<Report> {
    try {
      return await this.preferred.write(brief);
    } catch (error) {
      this.onPreferredFailure(error);
      return this.fallback.write(brief);
    }
  }
}
