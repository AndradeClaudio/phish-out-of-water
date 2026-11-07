import { Inspection, InspectionId } from '../domain/inspection.js';
import type { InspectionRepository } from '../domain/inspection-repository.js';
import { WebAddress } from '../domain/web-address.js';
import type { Clock, InspectionScheduler } from './ports.js';

/** Use case: a person submits a suspicious link and gets an inspection to follow. */
export class OpenInspection {
  constructor(
    private readonly inspections: InspectionRepository,
    private readonly scheduler: InspectionScheduler,
    private readonly clock: Clock,
  ) {}

  async execute(submittedLink: string): Promise<InspectionId> {
    const inspection = Inspection.open({
      id: InspectionId.generate(),
      suspiciousLink: WebAddress.fromUserInput(submittedLink),
      now: this.clock.now(),
    });
    await this.inspections.save(inspection);
    this.scheduler.schedule(inspection.id);
    return inspection.id;
  }
}
