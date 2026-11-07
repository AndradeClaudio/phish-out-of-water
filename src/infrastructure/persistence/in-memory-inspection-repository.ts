import type { Inspection, InspectionId } from '../../domain/inspection.js';
import type { InspectionRepository } from '../../domain/inspection-repository.js';

/** Inspections are short-lived; keeping only the most recent ones bounds memory use. */
export class InMemoryInspectionRepository implements InspectionRepository {
  private readonly inspections = new Map<string, Inspection>();

  constructor(private readonly capacity: number = 500) {}

  async save(inspection: Inspection): Promise<void> {
    this.inspections.delete(inspection.id.value);
    this.inspections.set(inspection.id.value, inspection);
    this.evictOldest();
  }

  async findById(id: InspectionId): Promise<Inspection | undefined> {
    return this.inspections.get(id.value);
  }

  private evictOldest(): void {
    while (this.inspections.size > this.capacity) {
      const oldestId = this.inspections.keys().next().value;
      if (oldestId === undefined) {
        return;
      }
      this.inspections.delete(oldestId);
    }
  }
}
