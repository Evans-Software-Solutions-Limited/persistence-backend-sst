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

/**
 * Structured entitlement payload stamped on an `ApiError` by the
 * `SSTApiAdapter`'s 402 path. Present iff `code === "entitlement_denied"`.
 *
 * Field names are camelCase here even though the wire body is
 * snake_case — the adapter converts at the boundary so the rest of the
 * mobile code (containers, presenters, hooks) only ever touches camelCase.
 *
 * Spec: specs/11-payments-subscriptions/design.md § Mobile feature-gate model
 *       · § Entitlement enforcement (M10.5) > 402 response shape
 * Satisfies: requirements.md AC 10.4
 */
export type ApiErrorEntitlementPayload = {
  readonly feature: string;
  readonly currentTier: string;
  readonly upgradeTo: string | null;
  readonly upgradePriceMonthly: number | null;
};

export type ApiError = {
  readonly kind: "api";
  readonly code:
    | "network"
    | "unauthorized"
    | "not_found"
    | "server"
    | "timeout"
    | "entitlement_denied"
    | "unknown";
  readonly message: string;
  readonly status?: number;
  /**
   * M10.5: structured entitlement-denied payload. Only populated when
   * `code === "entitlement_denied"` (HTTP 402 + structured body).
   * Containers can consume this directly to render a paywall without a
   * second round-trip to the server.
   */
  readonly entitlement?: ApiErrorEntitlementPayload;
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
    | "email_confirmation_required"
    | "token_expired"
    | "network_error"
    // User dismissed a native/OAuth sign-in sheet. Not a real failure —
    // callers should treat it as a silent no-op (no error banner).
    | "cancelled"
    | "unknown";
  readonly message: string;
};

export type ValidationError = {
  readonly kind: "validation";
  readonly fields: Record<string, string>;
};
