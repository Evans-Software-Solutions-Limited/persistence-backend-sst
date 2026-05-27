import Elysia, { t } from "elysia";
import { UserDeviceService } from "../../repositories/userDeviceService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * POST /devices/register — upsert the caller's device push token.
 *
 * Mirrors the legacy `register_device_token` SQL function but as an
 * explicit SST handler: `userId` is the JWT subject; the request body
 * carries device-side fields only. Idempotent via the unique
 * `(user_id, device_token)` index — re-registering the same token
 * returns the same `id`.
 *
 * Implements: specs/09-notifications-social/design.md
 *             § Backend endpoints > POST /devices/register
 * Satisfies: specs/09-notifications-social/requirements.md AC 1.1, 1.2
 */
export const devicesRegisterHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(UserDeviceService)
  .post(
    "/devices/register",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { deviceToken, platform, deviceInfo } = ctx.body;

      // Defensive trim — Expo tokens can carry trailing newlines in
      // some shells / dev clients. Stored value drives the unique
      // index; whitespace difference would otherwise spawn duplicate
      // device rows.
      const trimmedToken = deviceToken.trim();
      if (trimmedToken.length === 0) {
        ctx.set.status = 400;
        return { error: "deviceToken must not be empty" };
      }

      const device = await ctx.UserDeviceRepository.register(userId, {
        deviceToken: trimmedToken,
        platform,
        deviceInfo,
      });

      return { data: { id: device.id, registered: true as const } };
    },
    {
      body: t.Object({
        deviceToken: t.String({ minLength: 1 }),
        platform: t.Union([
          t.Literal("ios"),
          t.Literal("android"),
          t.Literal("web"),
        ]),
        deviceInfo: t.Optional(
          t.Object({
            deviceName: t.Optional(t.String()),
            osVersion: t.Optional(t.String()),
            appVersion: t.Optional(t.String()),
            modelName: t.Optional(t.String()),
          }),
        ),
      }),
    },
  );
