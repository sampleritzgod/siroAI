/**
 * Typed application errors — replace regex/string matching for HTTP mapping.
 */

export const ErrorCodes = {
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION: "VALIDATION",
  CONFLICT: "CONFLICT",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  UNSUPPORTED_MEDIA: "UNSUPPORTED_MEDIA",
  UNPROCESSABLE: "UNPROCESSABLE",
  RATE_LIMITED: "RATE_LIMITED",
  STORAGE: "STORAGE",
  DATABASE: "DATABASE",
  PROVIDER: "PROVIDER",
  RETRIEVAL: "RETRIEVAL",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA: 415,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  STORAGE: 502,
  DATABASE: 500,
  PROVIDER: 503,
  RETRIEVAL: 500,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    options?: { status?: number; details?: unknown; cause?: unknown }
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.status = options?.status ?? STATUS_BY_CODE[code];
    this.details = options?.details;
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      ...(this.details !== undefined ? { details: this.details } : {}),
    };
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Map any thrown value to a safe client Response. */
export function toErrorResponse(
  error: unknown,
  headers?: HeadersInit
): Response {
  if (isAppError(error)) {
    return Response.json(error.toJSON(), {
      status: error.status,
      headers,
    });
  }

  const message =
    error instanceof Error ? error.message : "Internal server error";

  // Legacy string throws still used in a few services — map known safe cases.
  if (/unauthorized/i.test(message)) {
    return Response.json(
      { error: "Unauthorized", code: ErrorCodes.UNAUTHORIZED },
      { status: 401, headers }
    );
  }
  if (/not found/i.test(message)) {
    return Response.json(
      { error: "Not found", code: ErrorCodes.NOT_FOUND },
      { status: 404, headers }
    );
  }

  return Response.json(
    {
      error: "Something went wrong. Please try again.",
      code: ErrorCodes.INTERNAL,
    },
    { status: 500, headers }
  );
}

export function unauthorized(message = "Unauthorized") {
  return new AppError(ErrorCodes.UNAUTHORIZED, message);
}

export function notFound(message = "Not found") {
  return new AppError(ErrorCodes.NOT_FOUND, message);
}

export function validation(message: string, details?: unknown) {
  return new AppError(ErrorCodes.VALIDATION, message, { details });
}

export function conflict(message: string) {
  return new AppError(ErrorCodes.CONFLICT, message);
}

export function unprocessable(message: string) {
  return new AppError(ErrorCodes.UNPROCESSABLE, message);
}

export function payloadTooLarge(message: string) {
  return new AppError(ErrorCodes.PAYLOAD_TOO_LARGE, message);
}

export function unsupportedMedia(message: string) {
  return new AppError(ErrorCodes.UNSUPPORTED_MEDIA, message);
}

export function rateLimited(message = "Too many requests. Try again shortly.") {
  return new AppError(ErrorCodes.RATE_LIMITED, message);
}

export function storageError(message = "Storage error") {
  return new AppError(ErrorCodes.STORAGE, message);
}

export function databaseError(message = "Database error") {
  return new AppError(ErrorCodes.DATABASE, message);
}

export function providerError(message: string) {
  return new AppError(ErrorCodes.PROVIDER, message);
}

export function retrievalError(message = "Retrieval failed") {
  return new AppError(ErrorCodes.RETRIEVAL, message);
}

export function forbidden(message = "Forbidden") {
  return new AppError(ErrorCodes.FORBIDDEN, message);
}
