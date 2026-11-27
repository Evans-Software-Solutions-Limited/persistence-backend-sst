import Elysia from "elysia";
import {
  getAuthUser,
  getUser,
  requireAuth,
} from "@persistence/api-utils/auth/supabaseAuth";
import { eq } from "drizzle-orm";
import { profiles } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import {
  ensureCoachingChannelType,
  getStreamClient,
  listChannelsFor,
  streamUserFor,
} from "./chatChannels";

/**
 * Coach–client chat routes (PER-120, design E). Both coaches and athletes
 * call these, so they are NOT under `/trainers/me/*` (PER-146's coach
 * subscription guard does not apply). Authorization is explicit: the caller
 * only ever gets a token for their own Stream user, and only their own
 * relationships' channels.
 *
 *   POST /chat/token     → { apiKey, userId, token, expiresAt }
 *   GET  /chat/channels  → [{ relationshipId, channelId, otherParty, state }]
 *
 * Error codes: 503 `chat_not_configured` (no Stream keys on this stage),
 * 403 `chat_not_available` (no active or frozen channel of the caller's),
 * 503 `chat_unavailable` (the channel types couldn't be locked down: no
 * token is issued until they are), 502 `chat_unavailable` (Stream refused the
 * user upsert).
 */

export const CHAT_NOT_CONFIGURED = {
  code: "chat_not_configured",
  message: "Messages aren't available yet.",
} as const;

const authed = () =>
  new Elysia()
    .derive(async ({ headers }) => ({
      user: await getAuthUser(headers.authorization),
    }))
    .onBeforeHandle(requireAuth);

export const chatRoutes = new Elysia()
  .use(
    authed().post("/chat/token", async (ctx) => {
      const client = getStreamClient();
      if (!client) {
        ctx.set.status = 503;
        return CHAT_NOT_CONFIGURED;
      }
      // The caller's own Stream user, always: the id comes from the
      // validated JWT and nothing in the request can change it.
      const userId = getUser(ctx).sub;
      const channels = await listChannelsFor(userId);
      if (channels.length === 0) {
        ctx.set.status = 403;
        return {
          code: "chat_not_available",
          message: "You have no coaching conversations.",
        };
      }
      const rows = await getDb()
        .select({
          id: profiles.id,
          fullName: profiles.fullName,
          avatarUrl: profiles.avatarUrl,
        })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1);
      try {
        // Fail closed: no token until the channel types are locked down (a
        // token on an unlocked type could open a chat with anyone).
        await ensureCoachingChannelType(client);
      } catch (err) {
        console.error("[chat] channel type ensure failed", err);
        ctx.set.status = 503;
        return {
          code: "chat_unavailable",
          message: "Messages are unavailable right now. Try again shortly.",
        };
      }
      try {
        // Design E: upsert the Stream user when a token is requested, so a
        // changed name or avatar reaches Stream by the next token.
        await client.upsertUsers([
          streamUserFor(
            rows[0] ?? { id: userId, fullName: null, avatarUrl: null },
          ),
        ]);
      } catch (err) {
        console.error("[chat] user upsert failed", err);
        ctx.set.status = 502;
        return {
          code: "chat_unavailable",
          message: "Messages are unavailable right now. Try again shortly.",
        };
      }
      const { token, expiresAt } = await client.createUserToken(userId);
      return {
        data: {
          apiKey: client.apiKey,
          userId,
          token,
          expiresAt: expiresAt.toISOString(),
        },
      };
    }),
  )
  .use(
    authed().get("/chat/channels", async (ctx) => ({
      data: await listChannelsFor(getUser(ctx).sub),
    })),
  );
