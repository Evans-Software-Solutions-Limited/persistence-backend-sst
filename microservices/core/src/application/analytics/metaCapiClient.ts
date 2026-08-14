import { createHash } from "node:crypto";
import { getEnvOrDefault } from "@persistence/api-utils/env";

/**
 * Meta Conversions API client (spec-30 WS2). Server-only, native `fetch`, NO
 * SDK — mirrors `leads/resendClient.ts` conventions: OPTIONAL + fail-safe
 * config (empty secret → silent no-op, never a 5xx — HC-3), and it never logs
 * raw or hashed identifiers.
 *
 * Sends already-built server events to `POST /v{ver}/{dataset_id}/events`. The
 * event mapping (analytics → Meta standard event) lives in `metaEventMap.ts`;
 * this module owns config, hashing, and the HTTP call.
 */

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";

export function getMetaDatasetId(): string {
  return getEnvOrDefault("META_DATASET_ID", "");
}

export function getMetaCapiAccessToken(): string {
  return getEnvOrDefault("META_CAPI_ACCESS_TOKEN", "");
}

/** OPTIONAL — when set, events land under Events Manager → Test Events. */
export function getMetaTestEventCode(): string {
  return getEnvOrDefault("META_TEST_EVENT_CODE", "");
}

/** Configured == a dataset id AND an access token are both present. */
export function isMetaCapiConfigured(): boolean {
  return getMetaDatasetId().length > 0 && getMetaCapiAccessToken().length > 0;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** SHA-256 of the normalized (trim+lowercase) email — Meta's `em` format. */
export function hashEmail(email: string): string {
  return sha256Hex(email.trim().toLowerCase());
}

/** SHA-256 of the user id — Meta's hashed `external_id` format. */
export function hashExternalId(id: string): string {
  return sha256Hex(id.trim().toLowerCase());
}

export interface MetaUserData {
  em?: string[];
  external_id?: string[];
  fbc?: string;
  fbp?: string;
}

/**
 * Build `user_data` from the (transient) identifiers. Email + external_id are
 * SHA-256 hashed here and NEVER logged or persisted; `fbc`/`fbp` are Meta's own
 * click tokens and are passed through un-hashed, as Meta expects.
 */
export function buildUserData(input: {
  email?: string | null;
  userId?: string | null;
  fbc?: string | null;
  fbp?: string | null;
}): MetaUserData {
  const userData: MetaUserData = {};
  if (input.email) userData.em = [hashEmail(input.email)];
  if (input.userId) userData.external_id = [hashExternalId(input.userId)];
  if (input.fbc) userData.fbc = input.fbc;
  if (input.fbp) userData.fbp = input.fbp;
  return userData;
}

export interface MetaServerEvent {
  event_name: string;
  /** Unix seconds. */
  event_time: number;
  /** Dedup key shared with the browser pixel (spec-30 R2.4). */
  event_id?: string;
  action_source: "website" | "app";
  user_data: MetaUserData;
  custom_data?: Record<string, unknown>;
}

/**
 * POST a batch of built events to the Graph API. Returns `false` (no send) when
 * unconfigured or the batch is empty (HC-3). Throws on a non-2xx response so the
 * caller can leave the outbox rows unforwarded for the next drain — the caller
 * (the cron) wraps this, so nothing here can reach a user-facing path.
 *
 * The access token goes in the request BODY, not the URL, so it never lands in
 * an access log; the error message deliberately omits the response body, which
 * can echo the submitted (hashed) identifiers.
 */
export async function sendConversionEvents(
  events: MetaServerEvent[],
): Promise<boolean> {
  if (events.length === 0) return false;
  if (!isMetaCapiConfigured()) return false;

  const datasetId = getMetaDatasetId();
  const accessToken = getMetaCapiAccessToken();
  const testEventCode = getMetaTestEventCode();

  const body: Record<string, unknown> = {
    data: events,
    access_token: accessToken,
  };
  if (testEventCode.length > 0) body.test_event_code = testEventCode;

  const res = await fetch(
    `${GRAPH_API_BASE}/${encodeURIComponent(datasetId)}/events`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    throw new Error(`Meta CAPI send failed: ${res.status} ${res.statusText}`);
  }
  return true;
}
