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
  /**
   * The page the conversion happened on. Meta's parameter table calls this
   * optional and then states that it IS required for website events sent
   * through the Conversions API, and that it must match the verified domain —
   * so an `action_source: "website"` event without it is accepted by the HTTP
   * call and can still fail to register as a server-side event.
   */
  event_source_url?: string;
  user_data: MetaUserData;
  custom_data?: Record<string, unknown>;
}

/**
 * What Meta said about a batch.
 *
 * ⚠ `events_received` is what its name says — the count Meta ACCEPTED AND
 * PARSED, which in practice equals the number of events posted. It is NOT a
 * retention count: data-quality drops happen downstream of it and show up, if
 * anywhere, in `messages`. So `eventsReceived === metaEvents` is not proof Meta
 * kept anything, and must never be read as exoneration when a conversion goes
 * missing — that is the same mistake, one layer up, that this whole change
 * exists to correct. `messages` is the signal worth alarming on.
 */
export interface MetaSendResult {
  /** False when unconfigured or the batch was empty — nothing was POSTed. */
  sent: boolean;
  /** Meta's own count, or null when the body did not parse. */
  eventsReceived: number | null;
  /** Meta's warnings, redacted. Usually empty. */
  messages: string[];
}

/**
 * Meta echoes submitted field values back in some diagnostics, and `user_data`
 * carries SHA-256 identifiers. Strip anything that looks like one before a
 * message reaches a log line: 32+ hex runs (our `em`/`external_id` hashes),
 * Meta's own `fb.1.…` click tokens, and bare email addresses.
 *
 * The reason the body was discarded outright before was precisely this risk.
 * Discarding it also discarded the only explanation of a failed batch, so it is
 * redacted rather than dropped — and truncated, because a Graph error can be
 * long and a log line is not a place to put an unbounded remote string.
 */
export function redactMetaDiagnostic(text: string): string {
  return (
    text
      // Bound the input BEFORE any regex touches it. The email pattern
      // backtracks a character per start position across a long run of class
      // characters that never reaches an `@`, so it is quadratic — and this
      // string is a remote body that need not be the small JSON we expect (a
      // proxy's HTML error page, say). Trimming last measured 17.6s on 200KB,
      // inside a 120s Lambda, on the throw path: the batch would then never be
      // stamped and would burn the whole timeout again every 5 minutes until
      // the rows aged out. That is the head-of-line stall this drainer is
      // built to avoid, so the slice comes first.
      .slice(0, 4000)
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>")
      // No `\b` anchors: a hash glued to a word character (`external_id_<hash>`,
      // or a stray trailing letter) has no boundary to match against and would
      // survive verbatim. The 32-char minimum on the class already prevents
      // over-matching, so the anchors only ever cost coverage.
      .replace(/[0-9a-f]{32,}/gi, "<hash>")
      .replace(/fb\.\d+\.\d+\.[\w-]+/gi, "<clickid>")
      // A click id is free-form for 255 chars at the checkout body schema, so an
      // echoed one can carry newlines and split a log line in two.
      .replace(/\p{Cc}+/gu, " ")
      .slice(0, 400)
  );
}

/**
 * POST a batch of built events to the Graph API. Returns `sent: false` (no send)
 * when unconfigured or the batch is empty (HC-3). Throws on a non-2xx response so
 * the caller can leave the outbox rows unforwarded for the next drain — the
 * caller (the cron) wraps this, so nothing here can reach a user-facing path.
 *
 * The access token goes in the request BODY, not the URL, so it never lands in
 * an access log. The response body IS read now — on success for Meta's own
 * receipt, on failure for the reason it refused — but every string that leaves
 * here goes through `redactMetaDiagnostic` first, because Meta echoes submitted
 * values back and `user_data` holds hashed identifiers.
 */
export async function sendConversionEvents(
  events: MetaServerEvent[],
): Promise<MetaSendResult> {
  const notSent: MetaSendResult = {
    sent: false,
    eventsReceived: null,
    messages: [],
  };
  if (events.length === 0) return notSent;
  if (!isMetaCapiConfigured()) return notSent;

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

  const raw = await res.text().catch(() => "");

  if (!res.ok) {
    // The reason, not just the status. One rejected event fails the whole POST,
    // and without the code/subcode there is no way to tell a bad token from a
    // stale `event_time` from a malformed field.
    throw new Error(
      `Meta CAPI send failed: ${res.status} ${res.statusText} ${redactMetaDiagnostic(raw)}`,
    );
  }

  return {
    sent: true,
    ...parseSendReceipt(raw),
  };
}

/** Pull `events_received` + `messages` out of a 2xx body; tolerate any shape. */
function parseSendReceipt(raw: string): {
  eventsReceived: number | null;
  messages: string[];
} {
  try {
    const body = JSON.parse(raw) as {
      events_received?: unknown;
      messages?: unknown;
    };
    return {
      eventsReceived:
        typeof body.events_received === "number" ? body.events_received : null,
      messages: Array.isArray(body.messages)
        ? body.messages.map((m) => redactMetaDiagnostic(String(m)))
        : [],
    };
  } catch {
    return { eventsReceived: null, messages: [] };
  }
}
