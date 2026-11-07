import { type Inspection, InspectionId } from '../domain/inspection.js';
import type { InspectionRepository } from '../domain/inspection-repository.js';
import { InspectionNotFoundError } from './inspection-not-found-error.js';

/** Use case: the person checks how their inspection is going and reads the result. */
export class FollowInspection {
  constructor(private readonly inspections: InspectionRepository) {}

  async execute(rawId: string): Promise<Inspection> {
    const id = InspectionId.of(rawId);
    const inspection = await this.inspections.findById(id);
    if (inspection === undefined) {
      throw new InspectionNotFoundError(id);
    }
    return inspection;
  }
}
