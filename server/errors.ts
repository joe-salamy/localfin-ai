export type OperationalStatus = 400 | 404 | 409 | 413;

export class OperationalError extends Error {
  readonly isOperational = true;
  readonly statusCode: OperationalStatus;

  constructor(
    message: string,
    statusCode: OperationalStatus,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.statusCode = statusCode;
    this.name = new.target.name;
  }
}

export class BadRequestError extends OperationalError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 400, options);
  }
}

export class NotFoundError extends OperationalError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 404, options);
  }
}

export class ConflictError extends OperationalError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 409, options);
  }
}

export function publicErrorMessage(error: unknown): string {
  return error instanceof OperationalError
    ? error.message
    : "Internal server error";
}
