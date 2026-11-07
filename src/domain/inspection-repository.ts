import type { Inspection, InspectionId } from './inspection.js';

export interface InspectionRepository {
  save(inspection: Inspection): Promise<void>;
  findById(id: InspectionId): Promise<Inspection | undefined>;
}
