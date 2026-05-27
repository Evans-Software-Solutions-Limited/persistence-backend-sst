import Elysia, { t } from "elysia";
import { NotificationService } from "../../repositories/notificationService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * PATCH /notifications/:id — mark a single notification as read.
 *
 * Ownership is folded into the mutation's WHERE clause (M2 learning
 * #14): no TOCTOU window, one round-trip, wrong-user and missing-row
 * both collapse to "no rows updated" → 404.
 *
 * Idempotent: re-marking an already-read row still returns the row
 * (UPDATE matches and sets the same values). The offline sync queue
 * replay path depends on this.
 *
 * For M7 only `{ isRead: true }` is accepted — flipping a row back to
 * unread is out of scope. Validation rejects anything else.
 *
 * Implements: specs/09-notifications-social/design.md
 *             § Backend endpoints > PATCH /notifications/:id
 * Satisfies: specs/09-notifications-social/requirements.md AC 5.3, 5.8
 */
export const notificationsUpdateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(NotificationService)
  .patch(
    "/notifications/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { id } = ctx.params;

      const updated = await ctx.NotificationRepository.markRead(userId, id);

      if (!updated) {
        ctx.set.status = 404;
        return { error: "Notification not found" };
      }

      return { data: updated };
    },
    {
      params: t.Object({
        id: t.String({ minLength: 1 }),
      }),
      body: t.Object({
        isRead: t.Literal(true),
      }),
    },
  );
