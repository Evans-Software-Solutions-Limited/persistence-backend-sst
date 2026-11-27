import { profiles, userDevices, type UserDevice } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { and, eq, isNull, ne, sql } from "drizzle-orm";

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
   * A push token identifies ONE physical install, and only the account
   * currently signed in on it may receive its pushes. So before the upsert,
   * every OTHER user's active row for this token is deactivated: whoever
   * registers a token last owns it. Without this, signing out of account A
   * and into account B (or a sign-out whose unregister call never reached
   * us — offline, app killed) left A's row active, and A's notifications
   * kept arriving on a phone A was no longer signed into.
   *
   * This is the one write in this repository that touches rows outside
   * `userId`. It is deliberately narrow: it can only flip `is_active` to
   * false, only for the token in the request, and never reads or returns
   * another user's data.
   *
   * Known, accepted risk: the server can't prove the caller's device minted
   * the token. It is just a string in the body. Someone who learns a
   * victim's Expo push token (a screenshot, logs, a debug build) can
   * register it, which switches off the victim's row and sends the caller's
   * own pushes to the victim's phone. That only lasts until the victim's
   * next app launch, which re-registers the token and takes it back. Before
   * this take-over, a forged registration could still send the caller's
   * pushes to the victim's phone; it just couldn't silence the victim's.
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

    await db
      .update(userDevices)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(
          eq(userDevices.deviceToken, input.deviceToken),
          ne(userDevices.userId, userId),
          eq(userDevices.isActive, true),
        ),
      );

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
   * A soft-deleted account (`profiles.deleted_at` set, inside its 30-day
   * window) gets no devices at all. `softDelete` switches its rows off, but
   * any phone still signed in to it re-registers on its next launch. Gating
   * here, the push send path's only device lookup, keeps a deleted account
   * silent however its rows got switched back on. Restoring the account
   * clears `deleted_at`, and pushes resume.
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
      .innerJoin(profiles, eq(profiles.id, userDevices.userId))
      .where(
        and(
          eq(userDevices.userId, userId),
          eq(userDevices.isActive, true),
          isNull(profiles.deletedAt),
        ),
      );
    return rows.map((row) => ({
      deviceToken: row.deviceToken,
      platform: row.platform,
    }));
  }

  /**
   * Mark a device token inactive. Called from `POST /devices/unregister`
   * when the user signs out on that device (legacy
   * `unregister_device_token`), and when Expo reports `DeviceNotRegistered`
   * for it (uninstalled app / revoked permission / rotated token) so the
   * dead token stops being retried on every send.
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

  /**
   * Delete the caller's row for one token. Used by `POST /devices/register`
   * when a 1.2.0 phone sends a raw APNs/FCM token (PER-149): the token is
   * never stored, and any row for it that already exists for this user is
   * removed. That covers rows written by the old Lambda in the deploy window
   * after the clean-up migration ran (`supabase db push` runs before
   * `sst deploy`), so they go away the next time that phone registers.
   *
   * Scoped to `(user_id, device_token)`, so it never touches another user's
   * row. Idempotent: an absent row is a no-op.
   */
  async deleteForUserAndToken(
    userId: string,
    deviceToken: string,
  ): Promise<void> {
    const db = getDb();
    await db
      .delete(userDevices)
      .where(
        and(
          eq(userDevices.userId, userId),
          eq(userDevices.deviceToken, deviceToken),
        ),
      );
  }
}
