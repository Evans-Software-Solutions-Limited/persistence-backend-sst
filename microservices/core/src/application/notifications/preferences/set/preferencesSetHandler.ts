import Elysia from "elysia";
import { ProfileService } from "../../../repositories/profileService";
import { reconcileNotificationPreferences } from "../../../repositories/profileRepository";
import {
  NOTIFICATION_TYPES,
  type NotificationType,
} from "../../../repositories/notificationRepository";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

const VALID_KEYS: ReadonlySet<string> = new Set(NOTIFICATION_TYPES);

/**
 * POST /notifications/preferences — merge the caller's partial map
 * into the persisted preferences. Inspector Brad PR #81: a full-
 * replace implementation silently nukes prior keys when a follow-up
 * partial body arrives, because the read path defaults missing keys
 * to `true`. The repository now uses an atomic JSONB `||` merge so
 * partial bodies preserve previously-stored keys, and full bodies
 * still work (every key overwrites).
 *
 * Validation is hand-rolled rather than via Elysia's `t.Object` because
 * the keys are a dynamic union — `t.Object({ workout_assigned: t.Boolean(), ... })`
 * would force us to enumerate every NotificationType here AND keep it
 * in lockstep with the union; the explicit loop reads exactly the
 * stale-key + non-boolean failure modes the spec asks for.
 *
 * The response echoes the merged shape after reconcile (defaults
 * filled, unknown dropped) so the client sees a stable full map.
 * NOTE: the echo reflects the validated body merged with defaults —
 * it does NOT round-trip via a fresh read, so the echoed map for a
 * partial body is "what the caller sent + defaults", not "current
 * stored state". For an authoritative snapshot, mobile re-fetches
 * via GET /notifications/preferences.
 *
 * Implements: specs/09-notifications-social/design.md
 *             § Backend endpoints > POST /notifications/preferences
 * Satisfies: specs/09-notifications-social/requirements.md AC 1.7, 1.8
 */
export const preferencesSetHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(ProfileService)
  .post("/notifications/preferences", async (ctx) => {
    const { sub: userId } = getUser(ctx);

    const body = ctx.body;

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      ctx.set.status = 400;
      return { error: "Body must be an object" };
    }

    const validated = {} as Record<NotificationType, boolean>;
    for (const [key, value] of Object.entries(body)) {
      if (!VALID_KEYS.has(key)) {
        ctx.set.status = 400;
        return { error: `Unknown notification type: ${key}` };
      }
      if (typeof value !== "boolean") {
        ctx.set.status = 400;
        return {
          error: `Value for ${key} must be a boolean, got ${typeof value}`,
        };
      }
      validated[key as NotificationType] = value;
    }

    // Merge the validated subset into the stored map (atomic JSONB ||
    // at the SQL layer). Prior keys not present in the body are
    // preserved; keys present in the body overwrite. Race-safe across
    // concurrent POSTs because the merge happens in a single UPDATE.
    const updated = await ctx.ProfileRepository.mergeNotificationPreferences(
      userId,
      validated,
    );

    if (!updated) {
      ctx.set.status = 404;
      return { error: "Profile not found" };
    }

    // Echo the merged shape so the client sees exactly what the next
    // GET would return. `validated` may be a partial map (the mobile
    // preferences page may only send the changed keys' state); the
    // reconcile fills the rest with defaults.
    return {
      data: reconcileNotificationPreferences(validated),
    };
  });
