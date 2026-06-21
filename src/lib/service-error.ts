/**
 * Cross-cutting application error carrying an HTTP status. Lives in lib/ so any
 * layer (core/, modules/, services/, app/) can import it without violating the
 * downward-only dependency rule (CLAUDE.md §1).
 */
export class ServiceError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'ServiceError';
    this.status = status;
  }
}
