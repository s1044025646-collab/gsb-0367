export type ErrorCode =
  | 'EMPTY_NAME'
  | 'NAME_TOO_LONG'
  | 'UNKNOWN_SYMBOL'
  | 'DUPLICATE_SYMBOL'
  | 'TOO_MANY_SYMBOLS'
  | 'TOO_MANY_RELATIONS'
  | 'INVALID_INTEGER'
  | 'INTEGER_TOO_LARGE'
  | 'UNKNOWN_EXPERIMENT'
  | 'EMPTY_BATCH'
  | 'BATCH_VALIDATION_FAILED'
  | 'BAD_REQUEST';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}
