import Elysia, { t } from "elysia";
import { NotificationService } from "../../repositories/notificationService";
import { InvalidCursorError } from "../../repositories/notificationRepository";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MIN_LIMIT = 1;

/**
 * GET /notifications — list the caller's notifications + unread count.
 *
 * Keyset (cursor) pagination via `cursor`/`limit`, ordered
 * `created_at DESC, id DESC`. Omitting `cursor` returns the first
 * (newest) page; `nextCursor` is echoed back to fetch the next (older)
 * page, or `null` at the end. A malformed `cursor` is rejected with a
 * 400 — restarting pagination silently would loop the client forever.
 *
 * `limit` is clamped (not rejected) to [1, 100] (default 50) to match
 * the legacy mobile app's tolerant pagination — `limit=500` returns
 * the first 100 rather than a 400.
 *
 * `unreadCount` covers ALL the user's unread notifications, not just
 * the current page — drives the bell-icon badge without a second
 * round-trip.
 *
 * Implements: specs/09-notifications-social/design.md
 *             § Backend endpoints > GET /notifications
 * Satisfies: specs/09-notifications-social/requirements.md AC 5.1, 5.2, 5.8
 */
export const notificationsListHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(NotificationService)
  .get(
    "/notifications",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { limit, cursor, unreadOnly } = ctx.query;

      const clampedLimit = Math.min(
        Math.max(limit ?? DEFAULT_LIMIT, MIN_LIMIT),
        MAX_LIMIT,
      );

      let page;
      try {
        page = await ctx.NotificationRepository.list(userId, {
          limit: clampedLimit,
          cursor,
          unreadOnly: unreadOnly === true,
        });
      } catch (err) {
        if (err instanceof InvalidCursorError) {
          ctx.set.status = 400;
          return { error: "Invalid cursor" };
        }
        throw err;
      }

      const unreadCount = await ctx.NotificationRepository.countUnread(userId);

      return {
        rows: page.rows,
        nextCursor: page.nextCursor,
        unreadCount,
      };
    },
    {
      query: t.Object({
        limit: t.Optional(t.Numeric({ minimum: 1 })),
        cursor: t.Optional(t.String()),
        unreadOnly: t.Optional(t.BooleanString()),
      }),
    },
  );
