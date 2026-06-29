import { getEnvRaw } from "@persistence/api-utils/env";

/**
 * Expo Push API client (09.9 / A3). Server-only — sends notifications to the
 * Expo Push service, which fans out to APNs / FCM. Native `fetch` (Lambda Node
 * runtime), no SDK dependency, matching the codebase's outbound-HTTP convention
 * (see `revenuecat/revenueCatClient.ts`).
 *
 * Ports the legacy Edge Function at
 * `../persistence-backend/supabase/functions/send-push-notification/index.ts`
 * (same endpoint, same message shape) and adds in-order batching + a typed
 * ticket response so the dispatcher can retire dead tokens.
 *
 * Spec: specs/09-notifications-social/design.md § ADDENDUM 2026-06-29
 *       > expoPushClient.ts. Satisfies requirements STORY-008 AC 8.2, 8.6.
 */

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/**
 * Expo's documented per-request message cap. Larger payloads must be split
 * across multiple requests. https://docs.expo.dev/push-notifications/sending-notifications/
 */
export const EXPO_PUSH_BATCH_SIZE = 100;

/** A single outbound push message (subset of Expo's schema we use). */
export interface ExpoPushMessage {
  /** The recipient device's Expo push token: `ExponentPushToken[…]`. */
  to: string;
  title: string;
  body: string;
  sound?: "default";
  data?: Record<string, unknown>;
  priority?: "default" | "normal" | "high";
  /** Android channel id; ignored on iOS. */
  channelId?: string;
}

/**
 * One entry of the Expo `/push/send` response `data` array — a "push ticket".
 * `status: "ok"` carries an `id` for later receipt lookup; `status: "error"`
 * carries `details.error` (e.g. `"DeviceNotRegistered"`, `"MessageTooBig"`).
 *
 * Parsed defensively — Expo can add fields, and a malformed entry must not
 * crash the send path.
 */
export interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface ExpoPushSendResponse {
  data?: unknown;
}

/**
 * The Expo access token, or `undefined` when unset. Optional: the Expo Push
 * API accepts unauthenticated sends unless "Enhanced Security for Push" is
 * enabled on the Expo account, in which case the token is sent as a Bearer.
 * Empty string is treated as unset (CI may set the secret to "").
 */
export function getExpoAccessToken(): string | undefined {
  const raw = getEnvRaw("EXPO_ACCESS_TOKEN");
  return raw !== undefined && raw.length > 0 ? raw : undefined;
}

/** Split `items` into consecutive chunks of at most `size`. */
function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Coerce one raw response entry into an `ExpoPushTicket`. Unknown / malformed
 * entries collapse to an `error` ticket so the ticket array stays positionally
 * aligned with the messages array (the dispatcher zips them by index).
 */
function toTicket(raw: unknown): ExpoPushTicket {
  if (typeof raw !== "object" || raw === null) {
    return { status: "error", message: "Malformed Expo ticket" };
  }
  const obj = raw as Record<string, unknown>;
  const status = obj.status === "ok" ? "ok" : "error";
  const ticket: ExpoPushTicket = { status };
  if (typeof obj.id === "string") ticket.id = obj.id;
  if (typeof obj.message === "string") ticket.message = obj.message;
  if (typeof obj.details === "object" && obj.details !== null) {
    const detailsError = (obj.details as Record<string, unknown>).error;
    if (typeof detailsError === "string") {
      ticket.details = { error: detailsError };
    }
  }
  return ticket;
}

/**
 * Send push messages via the Expo Push API. Batches at
 * {@link EXPO_PUSH_BATCH_SIZE} and concatenates the per-chunk tickets **in
 * request order**, so the caller can map `tickets[i]` back to `messages[i]`
 * (the contract the dispatcher relies on to retire a `DeviceNotRegistered`
 * token).
 *
 * Throws on a non-2xx response so the caller (the dispatcher) catches + logs;
 * the in-app notification row is already persisted before this runs, so a
 * throw never loses it.
 *
 * An empty `messages` array is a no-op (returns `[]` without a network call).
 */
export async function sendExpoPushMessages(
  messages: ExpoPushMessage[],
): Promise<ExpoPushTicket[]> {
  if (messages.length === 0) return [];

  const accessToken = getExpoAccessToken();
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
    "Content-Type": "application/json",
  };
  if (accessToken !== undefined) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const tickets: ExpoPushTicket[] = [];
  for (const batch of chunk(messages, EXPO_PUSH_BATCH_SIZE)) {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(batch),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `Expo Push send failed: ${res.status} ${res.statusText} ${detail}`.trim(),
      );
    }

    const json = (await res.json()) as ExpoPushSendResponse;
    const data = Array.isArray(json.data) ? json.data : [];
    for (const entry of data) {
      tickets.push(toTicket(entry));
    }
  }

  return tickets;
}
