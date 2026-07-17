/**
 * Shared "system user" bootstrap for seed scripts. Several catalogue tables
 * (exercises, workouts) are owned by a sentinel system user so the backend
 * can treat them as shared/stock content (see exerciseRepository's
 * created_by = SYSTEM_USER_ID predicate). Every seed script that inserts
 * system-owned rows needs this row to exist first, so it's extracted here
 * rather than duplicated per script.
 */

import { sql } from "drizzle-orm";
import type { getDb } from "@persistence/db";

/**
 * Sentinel UUID for system-authored catalogue rows — must match
 * SYSTEM_USER_ID in microservices/core/src/application/repositories/exerciseRepository.ts.
 * That predicate is load-bearing: the backend treats rows with this created_by
 * as the stock catalogue every user can see. DO NOT change it.
 */
export const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

export async function ensureSystemUser(
  db: ReturnType<typeof getDb>,
): Promise<void> {
  // auth.users first (profiles.id FKs to it). Best-effort: on prod this row
  // already exists so the insert is a no-op; on a fresh local stack it creates
  // the minimal system user. Wrapped because some managed setups restrict DML
  // on the auth schema — if so, the profiles insert below will surface the gap.
  try {
    await db.execute(sql`
      insert into auth.users
        (instance_id, id, aud, role, email, encrypted_password,
         email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
      values
        ('00000000-0000-0000-0000-000000000000', ${SYSTEM_USER_ID},
         'authenticated', 'authenticated', 'system@persistence.local', '',
         now(), now(), now(), '{}'::jsonb, '{}'::jsonb)
      on conflict (id) do nothing
    `);
  } catch (err) {
    console.warn(
      "[seed] could not write auth.users system row (may be fine if it already exists):",
      (err as Error).message,
    );
  }
  await db.execute(sql`
    insert into profiles (id, email, full_name, username, role)
    values (${SYSTEM_USER_ID}, 'system@persistence.local', 'System', '__system__', 'admin')
    on conflict (id) do nothing
  `);
}
