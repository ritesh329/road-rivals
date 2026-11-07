/** Throw from any route / service; the error middleware turns it into `{ error, ...extra }` with the status. */
export class HttpError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}
