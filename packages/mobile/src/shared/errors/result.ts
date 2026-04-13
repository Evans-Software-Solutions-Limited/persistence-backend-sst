/**
 * Result type for domain operations.
 * Avoids throw/catch for expected failure paths.
 */
type Success<T> = { readonly ok: true; readonly value: T };
type Failure<E> = { readonly ok: false; readonly error: E };

export type Result<T, E = AppError> = Success<T> | Failure<E>;

export function ok<T>(value: T): Success<T> {
  return { ok: true, value };
}

export function fail<E>(error: E): Failure<E> {
  return { ok: false, error };
}

/**
 * Unwrap a Result, throwing if it's a Failure.
 * Use sparingly — prefer pattern matching.
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw result.error;
}

// -- Base error types --

export type AppError = ApiError | StorageError | AuthError | ValidationError;

export type ApiError = {
  readonly kind: "api";
  readonly code:
    | "network"
    | "unauthorized"
    | "not_found"
    | "server"
    | "unknown";
  readonly message: string;
  readonly status?: number;
};

export type StorageError = {
  readonly kind: "storage";
  readonly code: "read_failed" | "write_failed" | "not_found" | "corrupted";
  readonly message: string;
};

export type AuthError = {
  readonly kind: "auth";
  readonly code:
    | "invalid_credentials"
    | "email_taken"
    | "token_expired"
    | "network_error"
    | "unknown";
  readonly message: string;
};

export type ValidationError = {
  readonly kind: "validation";
  readonly fields: Record<string, string>;
};
