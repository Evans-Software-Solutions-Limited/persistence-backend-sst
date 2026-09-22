import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const migration = (name: string) =>
  readFileSync(
    new URL(`../../../../../../supabase/migrations/${name}`, import.meta.url),
    "utf8",
  );
const initial = migration("001_initial_schema.sql");
const functions = migration("002_functions_and_triggers.sql");
const invitations = migration(
  "007_trainer_invitations_and_push_notifications.sql",
);
const atomicSignup = migration(
  "20260922131447_atomic_signup_profile_creation.sql",
);
function extract(source: string, pattern: RegExp) {
  const found = source.match(pattern)?.[0];
  if (!found) throw new Error(`Migration definition not found: ${pattern}`);
  return found;
}

describe("new account profile creation using the checked-in SQL trigger", () => {
  let pg: PGlite;
  const user = "00000000-0000-4000-8000-000000000091";
  beforeEach(async () => {
    pg = await PGlite.create();
    // Supabase owns auth.users/auth.uid; reproduce only their trigger inputs.
    // The profiles table, username generator and creation trigger are actual
    // migration SQL, not a test reimplementation of their behaviour.
    await pg.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
      CREATE TABLE goal_types (id uuid PRIMARY KEY);
      CREATE TABLE trainer_invitations (id uuid PRIMARY KEY, client_email text, status text);
    `);
    await pg.exec(extract(initial, /CREATE TYPE user_role[^;]+;/));
    await pg.exec(extract(initial, /CREATE TYPE fitness_level[^;]+;/));
    await pg.exec(extract(initial, /CREATE TABLE profiles \([\s\S]*?\n\);/));
    await pg.exec(
      extract(
        functions,
        /CREATE OR REPLACE FUNCTION public\.generate_random_username\(\)[\s\S]*?\$\$;/,
      ),
    );
    await pg.exec(
      extract(
        invitations,
        /CREATE OR REPLACE FUNCTION process_pending_invitations\([\s\S]*?\$\$ LANGUAGE plpgsql SECURITY DEFINER;/,
      ),
    );
    await pg.exec(
      extract(
        invitations,
        /CREATE OR REPLACE FUNCTION public\.handle_new_user\(\)[\s\S]*?\$\$;/,
      ),
    );
    await pg.exec(atomicSignup);
    await pg.exec(
      extract(
        functions,
        /CREATE TRIGGER on_auth_user_created[\s\S]*?EXECUTE FUNCTION public\.handle_new_user\(\);/,
      ),
    );
  });
  afterEach(async () => {
    await pg.close();
  });
  const signup = (email: string, metadata: unknown = {}) =>
    pg.query(
      "INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)",
      [user, email, JSON.stringify(metadata)],
    );

  it.each([
    ["normal Apple email without name", "new@example.test", {}],
    ["Apple relay email without name", "new@privaterelay.appleid.com", {}],
    ["null Apple metadata", "null@example.test", null],
    ["Apple full name", "name@example.test", { full_name: "New Attendee" }],
    [
      "name that normalizes to empty",
      "unicode@example.test",
      { full_name: "🎓" },
    ],
  ])("creates a usable profile for %s", async (_label, email, metadata) => {
    await signup(email, metadata);
    const { rows } = await pg.query(
      "SELECT id, email, username, role, fitness_level FROM profiles WHERE id=$1",
      [user],
    );
    expect(rows).toEqual([
      {
        id: user,
        email,
        username: expect.stringMatching(/^[a-z0-9_]+$/),
        role: "user",
        fitness_level: "beginner",
      },
    ]);
  });

  it("resolves an existing username when a new attendee has the same full name", async () => {
    await pg.query(
      "INSERT INTO auth.users VALUES ($1, 'first@example.test', $2)",
      [
        "00000000-0000-4000-8000-000000000092",
        JSON.stringify({ full_name: "New Attendee" }),
      ],
    );
    await signup("second@example.test", { full_name: "New Attendee" });
    expect(
      (await pg.query("SELECT username FROM profiles WHERE id=$1", [user]))
        .rows,
    ).toEqual([
      { username: expect.stringMatching(/^newattendee_[a-f0-9]{4}$/) },
    ]);
  });

  it("retains a new profile when optional invitation processing fails", async () => {
    await pg.exec("DROP TABLE trainer_invitations");
    await signup("invitation-outage@example.test");
    expect(
      (await pg.query("SELECT id FROM profiles WHERE id=$1", [user])).rows,
    ).toEqual([{ id: user }]);
  });

  it("rolls back signup on a profile email collision without changing the existing owner", async () => {
    await pg.query(
      "INSERT INTO auth.users VALUES ($1, 'duplicate@example.test', '{}')",
      ["00000000-0000-4000-8000-000000000092"],
    );
    await pg.query(
      "UPDATE auth.users SET email='changed@example.test' WHERE email='duplicate@example.test'",
    );
    // Models a stale profile email after an auth email change; provider account
    // linking and any deployed email-sync trigger are not exercised here.
    // Auth emails are distinct, but profile insertion still hits its unique key.
    const existingProfiles = (await pg.query("SELECT * FROM profiles")).rows;
    await expect(signup("duplicate@example.test")).rejects.toMatchObject({
      code: "23505",
    });
    expect(
      (await pg.query("SELECT id FROM auth.users WHERE id=$1", [user])).rows,
    ).toEqual([]);
    expect((await pg.query("SELECT * FROM profiles")).rows).toEqual(
      existingProfiles,
    );
    // Fixture repair models a deliberate email-sync correction, not automatic
    // account merging: the failed signup can now retry with the same auth ID.
    await pg.query(
      "UPDATE profiles SET email='changed@example.test' WHERE email='duplicate@example.test'",
    );
    await signup("duplicate@example.test");
    expect(
      (await pg.query("SELECT id, email FROM profiles WHERE id=$1", [user]))
        .rows,
    ).toEqual([{ id: user, email: "duplicate@example.test" }]);
    expect(
      (await pg.query("SELECT id FROM auth.users WHERE id=$1", [user])).rows,
    ).toEqual([{ id: user }]);
  });
  it("can reapply the migration while preserving trigger security and restricting direct execution", async () => {
    await pg.exec(atomicSignup);
    const { rows } = await pg.query(`
      SELECT prosecdef, proconfig,
        has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE') AS anon_execute,
        has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE') AS authenticated_execute,
        EXISTS (SELECT 1 FROM aclexplode(proacl) WHERE grantee = 0 AND privilege_type = 'EXECUTE') AS public_execute
      FROM pg_proc WHERE oid = 'public.handle_new_user()'::regprocedure
    `);
    expect(rows).toEqual([
      {
        prosecdef: true,
        proconfig: ["search_path=public"],
        anon_execute: false,
        authenticated_execute: false,
        public_execute: false,
      },
    ]);
    await signup("reapplied@example.test");
    expect(
      (await pg.query("SELECT id FROM profiles WHERE id=$1", [user])).rows,
    ).toEqual([{ id: user }]);
  });
});
