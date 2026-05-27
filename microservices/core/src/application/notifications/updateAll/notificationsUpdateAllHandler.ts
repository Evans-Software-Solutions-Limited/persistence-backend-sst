import Elysia, { t } from "elysia";
import { NotificationService } from "../../repositories/notificationService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * PATCH /notifications/all — mark every unread notification for the
 * caller as read in one UPDATE.
 *
 * Idempotent: a second call returns `{ updated: 0 }`. Already-read
 * rows are not touched (the WHERE filters them out).
 *
 * **Routing note:** this handler MUST be registered BEFORE
 * `notificationsUpdateHandler` in `api.ts`. Elysia routes top-down,
 * so the literal `all` would otherwise match `:id` in the single-row
 * handler. There's a regression test for this in
 * `__tests__/notificationsUpdateAllHandler.test.ts` that hits the
 * exact route and asserts the bulk repository method is invoked.
 *
 * Implements: specs/09-notifications-social/design.md
 *             § Backend endpoints > PATCH /notifications/all
 * Satisfies: specs/09-notifications-social/requirements.md AC 5.4, 5.5, 5.8
 */
export const notificationsUpdateAllHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(NotificationService)
  .patch(
    "/notifications/all",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);

      const updated = await ctx.NotificationRepository.markAllRead(userId);

      return { data: { updated } };
    },
    {
      // Empty body — accept but ignore. Mobile clients use `{}` per
      // the wire contract; rejecting an unexpected payload here would
      // create an unnecessary failure mode for stricter HTTP clients.
      body: t.Optional(t.Object({}, { additionalProperties: true })),
    },
  );
