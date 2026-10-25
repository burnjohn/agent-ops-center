/** Raised when the database cannot be reached (connection refused/terminated). Mapped to 503 db_unavailable. */
export class DbUnavailableError extends Error {
  override readonly name = 'DbUnavailableError';

  constructor(message = 'Database is unavailable', options?: { cause?: unknown }) {
    super(message, options);
  }
}
