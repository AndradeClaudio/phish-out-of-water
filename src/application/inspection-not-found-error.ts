import type { InspectionId } from '../domain/inspection.js';

export class InspectionNotFoundError extends Error {
  override readonly name = 'InspectionNotFoundError';

  constructor(id: InspectionId) {
    super(`No inspection found with id ${id.value}.`);
  }
}
