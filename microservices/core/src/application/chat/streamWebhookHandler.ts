import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getDb } from "@persistence/db/client";
import {
  deliverCoachEvents,
  recordCoachEvent,
} from "../coaching/events/coachEvents";
import { NotificationDispatcher } from "../notifications/push/notificationDispatcher";
import { channelByStreamId } from "./chatChannels";
import { getStreamConfig, STREAM_CHANNEL_TYPE } from "./streamClient";

/**
 * `POST /chat/stream-webhook` (PER-120, design E §4). Mounted on the raw Hono
 * app in `api.ts` (like the Stripe and RevenueCat webhooks), because the
 * signature covers the exact request bytes.
 *
 * Stream signs every webhook with the app's API SECRET: `X-Signature` is the
 * hex HMAC-SHA256 of the raw body. No separate webhook secret exists or is
 * needed. Unsigned or wrongly signed → 401, before the body is parsed.
 *
 * A new message from the CLIENT in an active coaching channel writes one
 * `message_received` coach event, deduplicated on Stream's message id (Stream
 * retries webhooks). The coach's push then follows design C: their channel
 * for the kind, quiet hours (held) and per-client mute (`recordCoachEvent`).
 * The coach's own messages and every other event type are acknowledged and
 * ignored. Message text is never stored.
 */

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Constant-time check of Stream's `X-Signature` against the raw body. */
export function isValidStreamSignature(
  rawBody: string,
  signature: string | null,
  apiSecret: string,
): boolean {
  if (!signature || !/^[0-9a-f]+$/i.test(signature)) return false;
  const expected = createHmac("sha256", apiSecret).update(rawBody).digest();
  const given = Buffer.from(signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** `coach_events.dedupe_key` is ≤ 200 chars; Stream ids can be 255. */
export function messageDedupeKey(messageId: string): string {
  const id =
    messageId.length <= 150
      ? messageId
      : createHash("sha256").update(messageId).digest("hex");
  return `message_received:${id}`;
}

interface StreamWebhookEvent {
  type?: unknown;
  channel_type?: unknown;
  channel_id?: unknown;
  created_at?: unknown;
  user?: { id?: unknown };
  message?: {
    id?: unknown;
    type?: unknown;
    created_at?: unknown;
    user?: { id?: unknown };
  };
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v !== "" ? v : null;

export async function handleStreamWebhook(
  request: Request,
  dispatcher: NotificationDispatcher = new NotificationDispatcher(),
): Promise<Response> {
  const config = getStreamConfig();
  if (!config) {
    return json(503, {
      code: "chat_not_configured",
      message: "Chat is not configured",
    });
  }
  const raw = await request.text();
  if (
    !isValidStreamSignature(
      raw,
      request.headers.get("x-signature"),
      config.apiSecret,
    )
  ) {
    return json(401, { code: "invalid_signature", message: "Unauthorized" });
  }

  let event: StreamWebhookEvent;
  try {
    event = JSON.parse(raw) as StreamWebhookEvent;
  } catch {
    return json(400, { code: "invalid_body", message: "Invalid JSON" });
  }

  if (event.type !== "message.new") return json(200, { ignored: true });
  const channelId = str(event.channel_id);
  const messageId = str(event.message?.id);
  const senderId = str(event.message?.user?.id) ?? str(event.user?.id);
  if (
    event.channel_type !== STREAM_CHANNEL_TYPE ||
    !channelId ||
    !messageId ||
    !senderId ||
    // System and error messages aren't the client writing.
    (event.message?.type !== undefined &&
      event.message.type !== "regular" &&
      event.message.type !== "reply")
  ) {
    return json(200, { ignored: true });
  }

  const channel = await channelByStreamId(channelId);
  // Only the client's own messages in a live channel tell the coach anything.
  if (!channel || channel.state !== "active" || senderId !== channel.clientId) {
    return json(200, { ignored: true });
  }

  const sentAt = str(event.message?.created_at) ?? str(event.created_at);
  const occurredAt = sentAt ? new Date(sentAt) : new Date();
  const eventId = await recordCoachEvent(getDb(), {
    trainerId: channel.trainerId,
    clientId: channel.clientId,
    relationshipId: channel.relationshipId,
    kind: "message_received",
    entityType: "chat_message",
    entityId: null,
    payload: { messageId, channelId },
    occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
    dedupeKey: messageDedupeKey(messageId),
  });
  if (eventId) await deliverCoachEvents([eventId], dispatcher);
  return json(200, { ok: true });
}
