import Elysia, { t } from "elysia";
import { UserDeviceService } from "../../repositories/userDeviceService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * POST /devices/unregister — stop pushing to this device for the caller.
 *
 * Called by the mobile app on sign-out, BEFORE the session is revoked (the
 * request needs the JWT). Ports the legacy `unregister_device_token` SQL
 * function: marks the caller's `(user_id, device_token)` row inactive.
 * `userId` is the JWT subject, so a caller can only ever deactivate their
 * own row. Idempotent — an unknown or already-inactive token still
 * returns `unregistered: true`, so a retried sign-out never errors.
 */
export const devicesUnregisterHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(UserDeviceService)
  .post(
    "/devices/unregister",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      // Same trim as /devices/register so the stored value matches.
      const deviceToken = ctx.body.deviceToken.trim();
      if (deviceToken.length === 0) {
        ctx.set.status = 400;
        return { error: "deviceToken must not be empty" };
      }

      await ctx.UserDeviceRepository.deactivateToken(userId, deviceToken);

      return { data: { unregistered: true as const } };
    },
    {
      body: t.Object({
        deviceToken: t.String({ minLength: 1 }),
      }),
    },
  );
