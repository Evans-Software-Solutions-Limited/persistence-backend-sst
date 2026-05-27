import Elysia, { t } from "elysia";
import { NotificationService } from "../../repositories/notificationService";
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
 * Pagination via `limit`/`offset`. Limits are clamped (not rejected)
 * to match the legacy mobile app's tolerant pagination — sending
 * `limit=500` returns the first 100 rather than a 400.
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
      const { limit, offset, unreadOnly } = ctx.query;

      const clampedLimit = Math.min(
        Math.max(limit ?? DEFAULT_LIMIT, MIN_LIMIT),
        MAX_LIMIT,
      );
      const safeOffset = Math.max(offset ?? 0, 0);

      const [data, unreadCount] = await Promise.all([
        ctx.NotificationRepository.list(userId, {
          limit: clampedLimit,
          offset: safeOffset,
          unreadOnly: unreadOnly === true,
        }),
        ctx.NotificationRepository.countUnread(userId),
      ]);

      return { data, unreadCount };
    },
    {
      query: t.Object({
        limit: t.Optional(t.Numeric({ minimum: 1 })),
        offset: t.Optional(t.Numeric({ minimum: 0 })),
        unreadOnly: t.Optional(t.BooleanString()),
      }),
    },
  );
