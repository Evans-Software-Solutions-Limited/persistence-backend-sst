import { userDevices, type UserDevice } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { and, eq, sql } from "drizzle-orm";

/**
 * Platform identifiers accepted by `POST /devices/register`. Mirrors
 * the legacy `register_device_token` SQL function's whitelist
 * (`supabase/migrations/007_trainer_invitations_and_push_notifications.sql:545`).
 */
export type DevicePlatform = "ios" | "android" | "web";

export interface DeviceInfo {
  deviceName?: string;
  osVersion?: string;
  appVersion?: string;
  modelName?: string;
}

export interface RegisterDeviceInput {
  deviceToken: string;
  platform: DevicePlatform;
  deviceInfo?: DeviceInfo;
}

/**
 * A targetable active device — just the fields the push send path needs.
 * Returned by {@link UserDeviceRepository.listActiveTokens}.
 */
export interface ActiveDeviceToken {
  deviceToken: string;
  platform: string;
}

export class UserDeviceRepository {
  static readonly key = "UserDeviceRepository";

  /**
   * Upsert a device-token row for the user. Mirrors the legacy
   * `register_device_token` SQL function but as an explicit handler
   * path: `userId` is the JWT subject (never from request body).
   *
   * Uniqueness is enforced by the `user_devices_user_token_idx`
   * index on `(user_id, device_token)`. ON CONFLICT collapses
   * repeated registrations into a single row and refreshes
   * `platform` / `device_info` / `last_used_at` / `updated_at`,
   * and flips `is_active` back to true (the legacy unregister path
   * sets it to false; a re-register reactivates).
   *
   * Different users registering the same token (shared device) get
   * their own rows — that's intentional, the unique index is on the
   * (user_id, device_token) pair, not on device_token alone.
   *
   * Spec: specs/09-notifications-social/design.md § Backend endpoints
   *       > POST /devices/register.
   */
  async register(
    userId: string,
    input: RegisterDeviceInput,
  ): Promise<UserDevice> {
    const db = getDb();

    // Drizzle's `userDevices.deviceInfo` column type is
    // `Record<string, unknown>` (jsonb with `$type` cast in schema.ts).
    // The narrower `DeviceInfo` interface doesn't have an index
    // signature, so it doesn't structurally satisfy that column type.
    // Spread into a plain record before passing to .values() / .set().
    const deviceInfoBlob: Record<string, unknown> = {
      ...(input.deviceInfo ?? {}),
    };

    const result = await db
      .insert(userDevices)
      .values({
        userId,
        deviceToken: input.deviceToken,
        platform: input.platform,
        deviceInfo: deviceInfoBlob,
        isActive: true,
        lastUsedAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [userDevices.userId, userDevices.deviceToken],
        set: {
          platform: input.platform,
          deviceInfo: deviceInfoBlob,
          isActive: true,
          lastUsedAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning();

    // .returning() on an UPSERT ALWAYS yields the row that landed on
    // disk — whether INSERT or UPDATE. If we got nothing back it's a
    // driver bug; surface with a clear error rather than `as UserDevice`
    // smuggling `undefined` to the handler.
    const row = result[0];
    if (!row) {
      throw new Error("UserDeviceRepository.register: UPSERT returned no rows");
    }
    return row;
  }

  /**
   * Exposed for diagnostics + test setup. NOT used by the M7 handlers
   * directly — the `register` UPSERT path is the only mutation surface
   * shipped this milestone. Returning the raw row (or null) is fine
   * because callers are internal.
   */
  async findByUserAndToken(
    userId: string,
    deviceToken: string,
  ): Promise<UserDevice | null> {
    const db = getDb();
    const result = await db
      .select()
      .from(userDevices)
      .where(
        sql`${userDevices.userId} = ${userId} AND ${userDevices.deviceToken} = ${deviceToken}`,
      )
      .limit(1);
    return result[0] ?? null;
  }

  /**
   * List the user's active (`is_active = true`) device push tokens — the fan-out
   * targets for a push send. Scoped to `userId` (the trusted emitter's subject);
   * a notification for user A can never read user B's devices.
   *
   * `is_active` is nullable in the schema (column default `true`); the predicate
   * matches only rows explicitly `true`, so a NULL row (legacy / manual insert)
   * is treated as not-targetable rather than silently pushed to.
   *
   * Spec: specs/09-notifications-social/design.md § ADDENDUM 2026-06-29.
   */
  async listActiveTokens(userId: string): Promise<ActiveDeviceToken[]> {
    const db = getDb();
    const rows = await db
      .select({
        deviceToken: userDevices.deviceToken,
        platform: userDevices.platform,
      })
      .from(userDevices)
      .where(
        and(eq(userDevices.userId, userId), eq(userDevices.isActive, true)),
      );
    return rows.map((row) => ({
      deviceToken: row.deviceToken,
      platform: row.platform,
    }));
  }

  /**
   * Mark a device token inactive — called when Expo reports
   * `DeviceNotRegistered` for it (uninstalled app / revoked permission /
   * rotated token) so the dead token stops being retried on every send.
   *
   * Scoped to `(user_id, device_token)` (the unique-index pair), so it only
   * ever touches the caller's own row. Idempotent: deactivating an already-
   * inactive or absent row is a no-op.
   *
   * Spec: specs/09-notifications-social/requirements.md STORY-009.
   */
  async deactivateToken(userId: string, deviceToken: string): Promise<void> {
    const db = getDb();
    await db
      .update(userDevices)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(
          eq(userDevices.userId, userId),
          eq(userDevices.deviceToken, deviceToken),
        ),
      );
  }
}
