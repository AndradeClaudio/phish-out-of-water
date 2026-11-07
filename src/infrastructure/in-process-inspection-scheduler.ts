import type { InspectionScheduler } from '../application/ports.js';
import type { InspectionId } from '../domain/inspection.js';

export interface InProcessSchedulerSettings {
  readonly maxConcurrent: number;
  readonly runInspection: (id: InspectionId) => Promise<void>;
  readonly onUnexpectedError: (error: unknown) => void;
}

/** Queues inspections in memory and runs at most `maxConcurrent` sandboxes at a time. */
export class InProcessInspectionScheduler implements InspectionScheduler {
  private readonly queue: InspectionId[] = [];
  private running = 0;

  constructor(private readonly settings: InProcessSchedulerSettings) {}

  schedule(id: InspectionId): void {
    this.queue.push(id);
    this.startNext();
  }

  private startNext(): void {
    while (this.running < this.settings.maxConcurrent) {
      const id = this.queue.shift();
      if (id === undefined) {
        return;
      }
      this.running += 1;
      this.settings
        .runInspection(id)
        .catch(this.settings.onUnexpectedError)
        .finally(() => {
          this.running -= 1;
          this.startNext();
        });
    }
  }
}
