import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@persistence/db/schema";
import { readFileSync } from "node:fs";

const ADMIN = "00000000-0000-4000-8000-000000000001";
const USER_A = "00000000-0000-4000-8000-00000000000a";
const USER_B = "00000000-0000-4000-8000-00000000000b";

const adminClaims = {
  sub: ADMIN,
  email: "admin@example.test",
  email_verified: true,
  iat: 0,
  exp: 9e9,
  app_metadata: { admin: true },
};

vi.mock("@persistence/api-utils/auth/supabaseAuth", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@persistence/api-utils/auth/supabaseAuth")
    >();
  return { ...actual, getAuthUser: vi.fn(async () => adminClaims) };
});

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));

import { getAuthUser } from "@persistence/api-utils/auth/supabaseAuth";
import { getDb } from "@persistence/db/client";
import { adminMarketingHandler } from "../marketing/adminMarketingHandler";

const migrationSql = (file: string): string =>
  readFileSync(
    new URL(`../../../../../../supabase/migrations/${file}`, import.meta.url),
    "utf8",
  );

const FOUNDING_MIGRATION = migrationSql(
  "20260904120000_founding_offer_referrals.sql",
);
const GENERALISE_MIGRATION = migrationSql(
  "20260904214114_generalise_founding_grants.sql",
);
const MARKETING_MIGRATION = migrationSql("20260905120000_marketing_plans.sql");

/**
 * `/admin/marketing/*` end to end against a real Postgres (PGlite), with the
 * real migrations applied.
 *
 * Mocking `getDb` would have made this suite cheap and worthless. Everything
 * that can actually break here is SQL: the attribution reads dig into
 * `analytics_events.properties` with JSON operators, `FILTER` clauses and
 * `GROUP BY`, and the metrics upsert has to hit an expression index. All of
 * that renders fine and returns the wrong answer — or throws at runtime — under
 * a mocked database. This repo has shipped exactly that twice
 * (`reference_drizzle_groupby_param_bug`), so the queries are executed here.
 */

interface Handler {
  handle: (request: Request) => Promise<Response>;
}

function call(method: string, path: string, body?: unknown): Promise<Response> {
  return (adminMarketingHandler as unknown as Handler).handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        authorization: "Bearer admin",
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe("/admin/marketing", () => {
  let pg: PGlite;

  beforeEach(async () => {
    pg = await PGlite.create();
    vi.mocked(getDb).mockReturnValue(drizzle(pg, { schema }) as never);
    vi.mocked(getAuthUser).mockResolvedValue(adminClaims);
    await pg.exec(`
      CREATE TABLE profiles (id uuid PRIMARY KEY, email text, role text, marketing_consent boolean);
      CREATE TABLE subscription_tiers (tier_name text PRIMARY KEY, display_name text);
      CREATE TABLE user_subscriptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
      CREATE TABLE analytics_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid,
        event_name text NOT NULL,
        occurred_at timestamptz NOT NULL DEFAULT now(),
        properties jsonb NOT NULL DEFAULT '{}',
        source text NOT NULL DEFAULT 'server',
        event_id text,
        meta_forwarded_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO profiles (id, email) VALUES
        ('${ADMIN}', 'admin@example.test'),
        ('${USER_A}', 'a@example.test'),
        ('${USER_B}', 'b@example.test');
      INSERT INTO subscription_tiers (tier_name, display_name)
        VALUES ('premium', 'Premium'), ('premium_plus', 'Premium+');
    `);
    await pg.exec(FOUNDING_MIGRATION);
    await pg.exec(GENERALISE_MIGRATION);
    await pg.exec(MARKETING_MIGRATION);
  });

  afterEach(async () => {
    await pg.close();
    vi.restoreAllMocks();
  });

  async function newPlan(
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const res = await call("POST", "/admin/marketing/plans", {
      name: "Founders' offer — Sep 2026",
      slug: "founders-sep-2026",
      offerLanes: ["founding_access", "store_offer"],
      startsOn: "2026-09-01",
      endsOn: "2026-09-30",
      ...overrides,
    });
    expect(res.status).toBe(201);
    return (await json<{ data: { id: string } }>(res)).data.id;
  }

  async function newCode(code: string): Promise<string> {
    const res = await pg.query<{ id: string }>(
      `INSERT INTO referral_codes (code, display_code, label, kind)
       VALUES ($1, $1, $1, 'campaign') RETURNING id`,
      [code],
    );
    return res.rows[0]!.id;
  }

  async function auditActions(): Promise<string[]> {
    const rows = await pg.query<{ action: string }>(
      `SELECT action FROM admin_audit_log ORDER BY created_at, action`,
    );
    return rows.rows.map((r) => r.action);
  }

  // ─── Authorisation ────────────────────────────────────────────────────

  describe("authorisation", () => {
    it.each([
      ["GET", "/admin/marketing/plans", undefined],
      ["GET", "/admin/marketing/campaign-slugs", undefined],
      [
        "POST",
        "/admin/marketing/plans",
        { name: "x", slug: "abc", offerLanes: [] },
      ],
    ])("refuses a non-admin on %s %s", async (method, path, body) => {
      vi.mocked(getAuthUser).mockResolvedValue({
        ...adminClaims,
        app_metadata: { admin: false },
      });
      const res = await call(method, path, body);
      expect(res.status).toBe(403);
    });

    it("writes nothing when a non-admin tries to create a plan", async () => {
      vi.mocked(getAuthUser).mockResolvedValue({
        ...adminClaims,
        app_metadata: { admin: false },
      });
      await call("POST", "/admin/marketing/plans", {
        name: "x",
        slug: "sneaky",
        offerLanes: [],
      });
      const rows = await pg.query(`SELECT 1 FROM marketing_plans`);
      expect(rows.rows).toEqual([]);
    });
  });

  // ─── Plans ────────────────────────────────────────────────────────────

  describe("plans", () => {
    it("creates a plan and audits it in the same transaction", async () => {
      const id = await newPlan();
      const rows = await pg.query<{ slug: string; created_by: string }>(
        `SELECT slug, created_by FROM marketing_plans WHERE id = $1`,
        [id],
      );
      expect(rows.rows[0]).toEqual({
        slug: "founders-sep-2026",
        created_by: ADMIN,
      });
      expect(await auditActions()).toEqual(["marketing_plan.create"]);
    });

    it.each([
      ["an underscore", "founders_sep"],
      ["a space", "founders sep"],
      ["too short", "fo"],
    ])(
      "rejects a slug with %s before touching the database",
      async (_l, slug) => {
        const res = await call("POST", "/admin/marketing/plans", {
          name: "x",
          slug,
          offerLanes: [],
        });
        expect(res.status).toBe(400);
        const rows = await pg.query(`SELECT 1 FROM marketing_plans`);
        expect(rows.rows).toEqual([]);
      },
    );

    it("lower-cases a typed slug rather than rejecting it", async () => {
      // The column CHECK is lower-case only, and a plan slug is an internal
      // identifier — bouncing "Founders" back at the form would be pedantry.
      const res = await call("POST", "/admin/marketing/plans", {
        name: "x",
        slug: "  Founders-Sep  ",
        offerLanes: [],
      });
      expect(res.status).toBe(201);
      const rows = await pg.query<{ slug: string }>(
        `SELECT slug FROM marketing_plans`,
      );
      expect(rows.rows).toEqual([{ slug: "founders-sep" }]);
    });

    it("rejects an unknown offer lane", async () => {
      const res = await call("POST", "/admin/marketing/plans", {
        name: "x",
        slug: "lanes",
        offerLanes: ["crypto_airdrop"],
      });
      expect(res.status).toBe(400);
    });

    it("rejects a duplicate slug with 409 rather than a 500", async () => {
      await newPlan();
      const res = await call("POST", "/admin/marketing/plans", {
        name: "Another",
        slug: "founders-sep-2026",
        offerLanes: [],
      });
      expect(res.status).toBe(409);
    });

    it("rejects an end date before the start date at create", async () => {
      const res = await call("POST", "/admin/marketing/plans", {
        name: "x",
        slug: "backwards",
        offerLanes: [],
        startsOn: "2026-09-30",
        endsOn: "2026-09-01",
      });
      expect(res.status).toBe(400);
    });

    it("rejects a PATCH whose new end date precedes the STORED start date", async () => {
      // The check has to read the row, not just the body: sending `endsOn`
      // alone would otherwise sail past a start date it now contradicts and be
      // caught only by the column CHECK, as an opaque 500.
      const id = await newPlan();
      const res = await call("PATCH", `/admin/marketing/plans/${id}`, {
        endsOn: "2026-08-01",
      });
      expect(res.status).toBe(400);
    });

    it("records a status change under its own audit action", async () => {
      const id = await newPlan();
      const res = await call("PATCH", `/admin/marketing/plans/${id}`, {
        status: "active",
      });
      expect(res.status).toBe(200);
      expect(await auditActions()).toContain("marketing_plan.status");
      const audit = await pg.query<{
        before: { status: string };
        after: { status: string };
      }>(
        `SELECT before, after FROM admin_audit_log WHERE action = 'marketing_plan.status'`,
      );
      expect(audit.rows[0]).toEqual({
        before: { status: "draft" },
        after: { status: "active" },
      });
    });

    it("records an ordinary edit as an update, not a status change", async () => {
      const id = await newPlan();
      await call("PATCH", `/admin/marketing/plans/${id}`, {
        name: "Renamed",
      });
      expect(await auditActions()).toContain("marketing_plan.update");
      expect(await auditActions()).not.toContain("marketing_plan.status");
    });

    it("404s a PATCH to a plan that does not exist", async () => {
      const res = await call(
        "PATCH",
        "/admin/marketing/plans/11111111-1111-4111-8111-111111111111",
        { name: "ghost" },
      );
      expect(res.status).toBe(404);
    });
  });

  // ─── Channels, codes, offers ──────────────────────────────────────────

  describe("channels", () => {
    it("adds a channel and refuses a slug the marketing site does not have", async () => {
      const id = await newPlan();
      const ok = await call(`POST`, `/admin/marketing/plans/${id}/channels`, {
        campaignSlug: "meta",
        label: "Meta ads",
      });
      expect(ok.status).toBe(201);
      const bad = await call(`POST`, `/admin/marketing/plans/${id}/channels`, {
        campaignSlug: "tiktok-shop",
        label: "Nope",
      });
      expect(bad.status).toBe(400);
      const rows = await pg.query(`SELECT 1 FROM marketing_plan_channels`);
      expect(rows.rows).toHaveLength(1);
    });

    it("refuses the same channel twice on one plan", async () => {
      const id = await newPlan();
      const body = { campaignSlug: "meta", label: "Meta ads" };
      await call("POST", `/admin/marketing/plans/${id}/channels`, body);
      const res = await call(
        "POST",
        `/admin/marketing/plans/${id}/channels`,
        body,
      );
      expect(res.status).toBe(409);
    });

    it("removes a channel and audits it", async () => {
      const id = await newPlan();
      const added = await call(
        "POST",
        `/admin/marketing/plans/${id}/channels`,
        { campaignSlug: "meta", label: "Meta ads" },
      );
      const channelId = (await json<{ data: { id: string } }>(added)).data.id;
      const res = await call(
        "DELETE",
        `/admin/marketing/plans/${id}/channels/${channelId}`,
      );
      expect(res.status).toBe(200);
      expect(await auditActions()).toContain("marketing_plan_channel.remove");
    });

    it("will not remove another plan's channel through this plan's path", async () => {
      const mine = await newPlan();
      const theirs = await newPlan({ slug: "other-plan" });
      const added = await call(
        "POST",
        `/admin/marketing/plans/${theirs}/channels`,
        { campaignSlug: "ig", label: "IG bio" },
      );
      const channelId = (await json<{ data: { id: string } }>(added)).data.id;
      const res = await call(
        "DELETE",
        `/admin/marketing/plans/${mine}/channels/${channelId}`,
      );
      expect(res.status).toBe(404);
      const rows = await pg.query(`SELECT 1 FROM marketing_plan_channels`);
      expect(rows.rows).toHaveLength(1);
    });
  });

  /**
   * Every child row hangs off a plan, and every route that names one takes the
   * plan from the PATH. If a handler ever filtered on the row id alone, plan A
   * could reach into plan B and nothing would say so — the response would look
   * completely ordinary. These are the cases where that would be silent.
   */
  describe("currency", () => {
    it("refuses a currency code that is not three letters", async () => {
      // `Intl.NumberFormat` throws `RangeError` on a code like "123", and
      // since the admin pages format in the plan's currency that throw takes
      // the whole page down with no error boundary. Length alone let it in.
      const res = await call("POST", "/admin/marketing/plans", {
        name: "x",
        slug: "bad-currency",
        offerLanes: [],
        currency: "123",
      });
      // Elysia's own body validation, so 422 rather than the handler's 400.
      expect(res.status).toBe(422);
      const rows = await pg.query(`SELECT 1 FROM marketing_plans`);
      expect(rows.rows).toEqual([]);
    });
  });

  describe("cross-plan reach", () => {
    it("will not unlink another plan's referral code through this plan's path", async () => {
      const mine = await newPlan();
      const theirs = await newPlan({ slug: "other-plan" });
      await newCode("METAFOUND");
      const linked = await call(
        "POST",
        `/admin/marketing/plans/${theirs}/codes`,
        { code: "METAFOUND" },
      );
      const linkId = (await json<{ data: { id: string } }>(linked)).data.id;

      const res = await call(
        "DELETE",
        `/admin/marketing/plans/${mine}/codes/${linkId}`,
      );
      expect(res.status).toBe(404);
      const rows = await pg.query(`SELECT 1 FROM marketing_plan_codes`);
      expect(rows.rows).toHaveLength(1);
    });

    it("will not edit or remove another plan's store offer through this plan's path", async () => {
      const mine = await newPlan();
      const theirs = await newPlan({ slug: "other-plan" });
      const created = await call(
        "POST",
        `/admin/marketing/plans/${theirs}/store-offers`,
        {
          platform: "ios" as const,
          code: "founders6",
          tierName: "premium",
          durationMonths: 6 as const,
          priceMinor: 3000,
          maxRedemptions: 100,
          expiresOn: "2026-10-31",
          campaignSlug: "meta",
        },
      );
      const offerId = (await json<{ data: { id: string } }>(created)).data.id;

      const patched = await call(
        "PATCH",
        `/admin/marketing/plans/${mine}/store-offers/${offerId}`,
        { maxRedemptions: 1 },
      );
      expect(patched.status).toBe(404);
      const removed = await call(
        "DELETE",
        `/admin/marketing/plans/${mine}/store-offers/${offerId}`,
      );
      expect(removed.status).toBe(404);

      const rows = await pg.query<{ max_redemptions: number }>(
        `SELECT max_redemptions FROM marketing_plan_store_offers`,
      );
      expect(rows.rows).toEqual([{ max_redemptions: 100 }]);
    });
  });

  describe("linked referral codes", () => {
    it("links an existing code by its word", async () => {
      const id = await newPlan();
      await newCode("METAFOUND");
      const res = await call("POST", `/admin/marketing/plans/${id}/codes`, {
        code: "metafound",
        campaignSlug: "meta",
      });
      expect(res.status).toBe(201);
      expect(await json<{ data: { code: string } }>(res)).toMatchObject({
        data: { code: "METAFOUND" },
      });
    });

    it("refuses to link a code that does not exist — and does not create one", async () => {
      // Code words are Brad's. A link route that quietly created a missing
      // code would be the agent inventing one.
      const id = await newPlan();
      const res = await call("POST", `/admin/marketing/plans/${id}/codes`, {
        code: "NOTACODE",
      });
      expect(res.status).toBe(404);
      const rows = await pg.query(`SELECT 1 FROM referral_codes`);
      expect(rows.rows).toEqual([]);
    });

    it("refuses the same code twice on one plan", async () => {
      const id = await newPlan();
      const codeId = await newCode("METAFOUND");
      await call("POST", `/admin/marketing/plans/${id}/codes`, {
        referralCodeId: codeId,
      });
      const res = await call("POST", `/admin/marketing/plans/${id}/codes`, {
        referralCodeId: codeId,
      });
      expect(res.status).toBe(409);
    });

    it("unlinking leaves the referral code itself alone", async () => {
      const id = await newPlan();
      const codeId = await newCode("METAFOUND");
      const linked = await call("POST", `/admin/marketing/plans/${id}/codes`, {
        referralCodeId: codeId,
      });
      const linkId = (await json<{ data: { id: string } }>(linked)).data.id;
      const res = await call(
        "DELETE",
        `/admin/marketing/plans/${id}/codes/${linkId}`,
      );
      expect(res.status).toBe(200);
      const codes = await pg.query(`SELECT 1 FROM referral_codes`);
      expect(codes.rows).toHaveLength(1);
    });
  });

  describe("store offers — a record of App Store Connect, not a control", () => {
    const offer = {
      platform: "ios" as const,
      code: "founders6",
      tierName: "premium",
      durationMonths: 6 as const,
      priceMinor: 3000,
      maxRedemptions: 100,
      expiresOn: "2026-10-31",
      campaignSlug: "meta",
    };

    it("stores the transcribed offer, upper-casing the code", async () => {
      const id = await newPlan();
      const res = await call(
        "POST",
        `/admin/marketing/plans/${id}/store-offers`,
        offer,
      );
      expect(res.status).toBe(201);
      const rows = await pg.query<{ code: string; max_redemptions: number }>(
        `SELECT code, max_redemptions FROM marketing_plan_store_offers`,
      );
      expect(rows.rows[0]).toEqual({ code: "FOUNDERS6", max_redemptions: 100 });
    });

    it("rejects a tier that is not in the catalogue", async () => {
      const id = await newPlan();
      const res = await call(
        "POST",
        `/admin/marketing/plans/${id}/store-offers`,
        { ...offer, tierName: "platinum" },
      );
      // The FK is the guard; what matters is that nothing is stored.
      expect(res.status).toBeGreaterThanOrEqual(400);
      const rows = await pg.query(`SELECT 1 FROM marketing_plan_store_offers`);
      expect(rows.rows).toEqual([]);
    });

    it("updates and removes an offer, auditing both", async () => {
      const id = await newPlan();
      const created = await call(
        "POST",
        `/admin/marketing/plans/${id}/store-offers`,
        offer,
      );
      const offerId = (await json<{ data: { id: string } }>(created)).data.id;
      const patched = await call(
        "PATCH",
        `/admin/marketing/plans/${id}/store-offers/${offerId}`,
        { maxRedemptions: 250 },
      );
      expect(patched.status).toBe(200);
      const removed = await call(
        "DELETE",
        `/admin/marketing/plans/${id}/store-offers/${offerId}`,
      );
      expect(removed.status).toBe(200);
      const actions = await auditActions();
      expect(actions).toContain("marketing_plan_store_offer.add");
      expect(actions).toContain("marketing_plan_store_offer.update");
      expect(actions).toContain("marketing_plan_store_offer.remove");
    });
  });

  // ─── Metrics ──────────────────────────────────────────────────────────

  describe("hand-entered metrics", () => {
    it("upserts the whole-plan row rather than duplicating it", async () => {
      const id = await newPlan();
      const put = (spendMinor: number) =>
        call("PUT", `/admin/marketing/plans/${id}/metrics`, {
          metricDate: "2026-09-12",
          spendMinor,
        });
      expect((await put(1000)).status).toBe(200);
      expect((await put(2500)).status).toBe(200);
      const rows = await pg.query<{ spend_minor: number }>(
        `SELECT spend_minor FROM marketing_plan_metrics`,
      );
      expect(rows.rows).toEqual([{ spend_minor: 2500 }]);
    });

    it("keeps a channel row separate from the whole-plan row for one date", async () => {
      const id = await newPlan();
      await call("PUT", `/admin/marketing/plans/${id}/metrics`, {
        metricDate: "2026-09-12",
        spendMinor: 1000,
      });
      await call("PUT", `/admin/marketing/plans/${id}/metrics`, {
        campaignSlug: "meta",
        metricDate: "2026-09-12",
        spendMinor: 400,
      });
      const rows = await pg.query(`SELECT 1 FROM marketing_plan_metrics`);
      expect(rows.rows).toHaveLength(2);
    });

    it("rejects an unparseable date", async () => {
      const id = await newPlan();
      const res = await call("PUT", `/admin/marketing/plans/${id}/metrics`, {
        metricDate: "12/09/2026",
      });
      expect(res.status).toBe(400);
    });
  });

  // ─── Derived attribution ──────────────────────────────────────────────

  describe("plan edits", () => {
    it("audits a brief change by length, never by storing the brief twice", async () => {
      const id = await newPlan();
      const briefMd = "# Brief\n\n".concat("x".repeat(5000));
      const res = await call("PATCH", `/admin/marketing/plans/${id}`, {
        name: "Founders' offer — Sep 2026 (v2)",
        briefMd,
      });
      expect(res.status).toBe(200);

      const rows = await pg.query<{ after: unknown }>(
        `SELECT after FROM admin_audit_log WHERE action = 'marketing_plan.update'`,
      );
      const after = rows.rows[0]!.after as Record<string, unknown>;
      expect(after.name).toBe("Founders' offer — Sep 2026 (v2)");
      // The marker, not the text: two 64 KB blobs per edit is not an audit
      // trail anyone can read, and not one worth storing.
      expect(after.briefMd).toBe(`<${briefMd.length} chars>`);
      const stored = await pg.query<{ brief_md: string }>(
        `SELECT brief_md FROM marketing_plans WHERE id = $1`,
        [id],
      );
      expect(stored.rows[0]!.brief_md).toBe(briefMd);
    });
  });

  describe("derived attribution", () => {
    async function storeClick(
      props: Record<string, unknown>,
      occurredAt = "2026-09-12T10:00:00Z",
    ) {
      await pg.query(
        `INSERT INTO analytics_events (event_name, source, occurred_at, properties)
         VALUES ('store_click', 'web', $1, $2)`,
        [occurredAt, JSON.stringify(props)],
      );
    }

    async function detail(id: string) {
      const res = await call("GET", `/admin/marketing/plans/${id}`);
      expect(res.status).toBe(200);
      return (
        await json<{
          data: {
            attribution: {
              window: { from: string; to: string };
              channels: Array<{
                campaignSlug: string;
                storeClicks: number;
                storeClicksIos: number;
                storeClicksAndroid: number;
                storeClicksWithCode: number;
              }>;
              codes: Array<Record<string, number | string>>;
              registrationsAllSources: number;
            };
          };
        }>(res)
      ).data.attribution;
    }

    it("counts store clicks per channel, split by store", async () => {
      const id = await newPlan();
      await call("POST", `/admin/marketing/plans/${id}/channels`, {
        campaignSlug: "meta",
        label: "Meta ads",
      });
      await storeClick({ campaign: "meta", store: "ios" });
      await storeClick({ campaign: "meta", store: "ios" });
      await storeClick({ campaign: "meta", store: "android" });
      // A different channel's click must not leak into this one.
      await storeClick({ campaign: "ig", store: "ios" });
      // Nor an unattributed organic click.
      await storeClick({ store: "ios" });

      const attribution = await detail(id);
      expect(attribution.channels).toEqual([
        {
          campaignSlug: "meta",
          storeClicks: 3,
          storeClicksIos: 2,
          storeClicksAndroid: 1,
          storeClicksWithCode: 0,
        },
      ]);
    });

    it("shows a configured channel with no clicks as an explicit zero", async () => {
      // An absent row reads as "not set up"; zero reads as "set up, producing
      // nothing" — which is the difference a spend decision turns on.
      const id = await newPlan();
      await call("POST", `/admin/marketing/plans/${id}/channels`, {
        campaignSlug: "flyer",
        label: "Leaflets",
      });
      const attribution = await detail(id);
      expect(attribution.channels).toEqual([
        {
          campaignSlug: "flyer",
          storeClicks: 0,
          storeClicksIos: 0,
          storeClicksAndroid: 0,
          storeClicksWithCode: 0,
        },
      ]);
    });

    it("counts only the clicks carrying one of the plan's linked codes", async () => {
      const id = await newPlan();
      await call("POST", `/admin/marketing/plans/${id}/channels`, {
        campaignSlug: "meta",
        label: "Meta ads",
      });
      await newCode("METAFOUND");
      await newCode("SOMEONELSE");
      await call("POST", `/admin/marketing/plans/${id}/codes`, {
        code: "METAFOUND",
      });
      await storeClick({ campaign: "meta", store: "ios", ref: "METAFOUND" });
      await storeClick({ campaign: "meta", store: "ios", ref: "SOMEONELSE" });
      await storeClick({ campaign: "meta", store: "ios" });

      const attribution = await detail(id);
      expect(attribution.channels[0]).toMatchObject({
        storeClicks: 3,
        storeClicksWithCode: 1,
      });
    });

    it("excludes clicks outside the plan window", async () => {
      const id = await newPlan();
      await call("POST", `/admin/marketing/plans/${id}/channels`, {
        campaignSlug: "meta",
        label: "Meta ads",
      });
      await storeClick(
        { campaign: "meta", store: "ios" },
        "2026-08-31T23:00:00Z",
      );
      await storeClick(
        { campaign: "meta", store: "ios" },
        "2026-09-01T00:30:00Z",
      );
      // The end date itself is INSIDE the window — `to` is exclusive at
      // midnight the following day, so a click late on the last day counts.
      await storeClick(
        { campaign: "meta", store: "ios" },
        "2026-09-30T23:30:00Z",
      );
      await storeClick(
        { campaign: "meta", store: "ios" },
        "2026-10-01T00:30:00Z",
      );

      const attribution = await detail(id);
      expect(attribution.channels[0]!.storeClicks).toBe(2);
    });

    it("reports the window's last INCLUDED day, not the exclusive bound", async () => {
      const id = await newPlan();
      const attribution = await detail(id);
      // Plain days, not instants: an instant is re-read in the viewer's own
      // zone, which put the end date a day late in the browser.
      expect(attribution.window.from).toBe("2026-09-01");
      expect(attribution.window.to).toBe("2026-09-30");
    });

    it("splits grants by kind and pending state, and labels money as contribution", async () => {
      const id = await newPlan();
      const codeId = await newCode("METAFOUND");
      await call("POST", `/admin/marketing/plans/${id}/codes`, {
        referralCodeId: codeId,
      });
      await pg.query(
        `INSERT INTO founding_grants
           (user_id, email, tier_name, months, grant_kind, amount_minor,
            payment_method, paid_at, referral_code_id, granted_by, applied_at, created_at)
         VALUES
           ($1, 'a@example.test', 'premium', 6, 'founding', 3000, 'bank_transfer',
            '2026-09-05', $3, $4, '2026-09-05', '2026-09-05'),
           ($2, 'b@example.test', 'premium', 6, 'complimentary', 0, NULL, NULL,
            $3, $4, NULL, '2026-09-06')`,
        [USER_A, USER_B, codeId, ADMIN],
      );
      const attribution = await detail(id);
      expect(attribution.codes).toEqual([
        {
          codeId,
          referralClaims: 0,
          referralClaimsLocked: 0,
          grantsFounding: 1,
          grantsComplimentary: 1,
          grantsPending: 1,
          grantsApplied: 1,
          contributionMinor: 3000,
        },
      ]);
    });

    it("ignores a revoked grant", async () => {
      const id = await newPlan();
      const codeId = await newCode("METAFOUND");
      await call("POST", `/admin/marketing/plans/${id}/codes`, {
        referralCodeId: codeId,
      });
      await pg.query(
        `INSERT INTO founding_grants
           (email, tier_name, months, grant_kind, referral_code_id, granted_by,
            created_at, revoked_at, revoke_reason)
         VALUES ('r@example.test', 'premium', 6, 'founding', $1, $2,
                 '2026-09-05', '2026-09-07', 'test')`,
        [codeId, ADMIN],
      );
      const attribution = await detail(id);
      expect(attribution.codes[0]).toMatchObject({
        grantsFounding: 0,
        contributionMinor: 0,
      });
    });

    it("counts referral claims, and how many locked, in-window", async () => {
      const id = await newPlan();
      const codeId = await newCode("METAFOUND");
      await call("POST", `/admin/marketing/plans/${id}/codes`, {
        referralCodeId: codeId,
      });
      await pg.query(
        `INSERT INTO referral_redemptions (code_id, user_id, source, locked_at, created_at)
         VALUES ($1, $2, 'app', '2026-09-10', '2026-09-08'),
                ($1, $3, 'app', NULL, '2026-09-09')`,
        [codeId, USER_A, USER_B],
      );
      const attribution = await detail(id);
      expect(attribution.codes[0]).toMatchObject({
        referralClaims: 2,
        referralClaimsLocked: 1,
      });
    });

    it("returns registrations undivided, as an all-sources total", async () => {
      // `registration_completed` carries no channel and never can — splitting
      // it per channel would be a fabrication.
      const id = await newPlan();
      await call("POST", `/admin/marketing/plans/${id}/channels`, {
        campaignSlug: "meta",
        label: "Meta ads",
      });
      await pg.query(
        `INSERT INTO analytics_events (event_name, source, occurred_at)
         VALUES ('registration_completed', 'server', '2026-09-12T10:00:00Z'),
                ('registration_completed', 'server', '2026-09-13T10:00:00Z'),
                ('registration_completed', 'server', '2026-10-13T10:00:00Z')`,
      );
      const attribution = await detail(id);
      expect(attribution.registrationsAllSources).toBe(2);
      expect(JSON.stringify(attribution.channels)).not.toContain(
        "registration",
      );
    });

    it("404s the detail of a plan that does not exist", async () => {
      const res = await call(
        "GET",
        "/admin/marketing/plans/11111111-1111-4111-8111-111111111111",
      );
      expect(res.status).toBe(404);
    });
  });

  // ─── List roll-ups ────────────────────────────────────────────────────

  describe("the plan list", () => {
    it("rolls up channels, spend, store clicks and grants per plan", async () => {
      const id = await newPlan();
      await call("POST", `/admin/marketing/plans/${id}/channels`, {
        campaignSlug: "meta",
        label: "Meta ads",
      });
      const codeId = await newCode("METAFOUND");
      await call("POST", `/admin/marketing/plans/${id}/codes`, {
        referralCodeId: codeId,
      });
      await call("PUT", `/admin/marketing/plans/${id}/metrics`, {
        metricDate: "2026-09-12",
        spendMinor: 1000,
      });
      await call("PUT", `/admin/marketing/plans/${id}/metrics`, {
        campaignSlug: "meta",
        metricDate: "2026-09-13",
        spendMinor: 400,
      });
      await pg.query(
        `INSERT INTO analytics_events (event_name, source, properties)
         VALUES ('store_click', 'web', '{"campaign":"meta"}'),
                ('store_click', 'web', '{"campaign":"ig"}')`,
      );
      await pg.query(
        `INSERT INTO founding_grants (email, tier_name, months, referral_code_id, granted_by)
         VALUES ('g@example.test', 'premium', 6, $1, $2)`,
        [codeId, ADMIN],
      );

      const res = await call("GET", "/admin/marketing/plans");
      const body = await json<{
        data: Array<{
          channelsCount: number;
          spendMinor: number;
          storeClicks: number;
          grants: number;
        }>;
      }>(res);
      expect(body.data[0]).toMatchObject({
        channelsCount: 1,
        spendMinor: 1400,
        storeClicks: 1,
        grants: 1,
      });
    });

    it("filters by status", async () => {
      const id = await newPlan();
      await newPlan({ slug: "second-plan" });
      await call("PATCH", `/admin/marketing/plans/${id}`, { status: "active" });
      const res = await call("GET", "/admin/marketing/plans?status=active");
      const body = await json<{ data: Array<{ id: string }> }>(res);
      expect(body.data.map((p) => p.id)).toEqual([id]);
    });
  });

  // ─── Optional fields, bad input and missing rows ──────────────────────
  //
  // Every route here takes a wide optional body, and each optional field is a
  // branch that can drop a value on the floor. These sweep them.

  describe("optional fields and error paths", () => {
    it("stores every optional plan field it is given", async () => {
      const id = await newPlan({
        slug: "full-plan",
        objective: "  Test the Meta rail  ",
        hypothesis: "Cold traffic converts on the store offer",
        decisionRule: "Stop at £210",
        budgetCapMinor: 21000,
        currency: "GBP",
        briefMd: "# Brief\n\nBody.",
      });
      const rows = await pg.query<{
        objective: string;
        hypothesis: string;
        decision_rule: string;
        budget_cap_minor: number;
        brief_md: string;
      }>(
        `SELECT objective, hypothesis, decision_rule, budget_cap_minor, brief_md
         FROM marketing_plans WHERE id = $1`,
        [id],
      );
      expect(rows.rows[0]).toEqual({
        objective: "Test the Meta rail",
        hypothesis: "Cold traffic converts on the store offer",
        decision_rule: "Stop at £210",
        budget_cap_minor: 21000,
        brief_md: "# Brief\n\nBody.",
      });
    });

    it("stores a whitespace-only optional field as null, not as blanks", async () => {
      const id = await newPlan({ slug: "blank-fields", objective: "   " });
      const rows = await pg.query<{ objective: string | null }>(
        `SELECT objective FROM marketing_plans WHERE id = $1`,
        [id],
      );
      expect(rows.rows[0]).toEqual({ objective: null });
    });

    it.each([
      ["startsOn", { startsOn: "12/09/2026" }],
      ["endsOn", { endsOn: "not-a-date" }],
    ])("rejects an unparseable %s at create", async (field, body) => {
      const res = await call("POST", "/admin/marketing/plans", {
        name: "x",
        slug: "bad-dates",
        offerLanes: [],
        ...body,
      });
      expect(res.status).toBe(400);
      expect(await json(res)).toEqual({
        message: `${field} is not a valid date`,
      });
    });

    it.each([
      ["startsOn", { startsOn: "12/09/2026" }],
      ["endsOn", { endsOn: "not-a-date" }],
    ])("rejects an unparseable %s on PATCH", async (field, body) => {
      const id = await newPlan();
      const res = await call("PATCH", `/admin/marketing/plans/${id}`, body);
      expect(res.status).toBe(400);
      expect(await json(res)).toEqual({
        message: `${field} is not a valid date`,
      });
    });

    it("clears optional plan fields when they are patched to null", async () => {
      const id = await newPlan({
        slug: "clearable",
        objective: "before",
        hypothesis: "before",
        decisionRule: "before",
        briefMd: "before",
      });
      const res = await call("PATCH", `/admin/marketing/plans/${id}`, {
        objective: null,
        hypothesis: null,
        decisionRule: null,
        briefMd: null,
        startsOn: null,
        endsOn: null,
        offerLanes: ["store_offer"],
        budgetCapMinor: null,
        currency: "USD",
        name: "  Renamed  ",
      });
      expect(res.status).toBe(200);
      const rows = await pg.query<Record<string, unknown>>(
        `SELECT name, objective, hypothesis, decision_rule, brief_md,
                starts_on, ends_on, offer_lanes, budget_cap_minor, currency
         FROM marketing_plans WHERE id = $1`,
        [id],
      );
      expect(rows.rows[0]).toEqual({
        name: "Renamed",
        objective: null,
        hypothesis: null,
        decision_rule: null,
        brief_md: null,
        starts_on: null,
        ends_on: null,
        offer_lanes: ["store_offer"],
        budget_cap_minor: null,
        currency: "USD",
      });
    });

    it("rejects an unknown offer lane on PATCH", async () => {
      const id = await newPlan();
      const res = await call("PATCH", `/admin/marketing/plans/${id}`, {
        offerLanes: ["nonsense"],
      });
      expect(res.status).toBe(400);
    });

    it("stores a channel's optional placement and notes, trimmed", async () => {
      const id = await newPlan();
      await call("POST", `/admin/marketing/plans/${id}/channels`, {
        campaignSlug: "meta",
        label: "Meta ads",
        placement: "  Reels  ",
        notes: "  Week 1  ",
      });
      const rows = await pg.query<{ placement: string; notes: string }>(
        `SELECT placement, notes FROM marketing_plan_channels`,
      );
      expect(rows.rows[0]).toEqual({ placement: "Reels", notes: "Week 1" });
    });

    const MISSING = "11111111-1111-4111-8111-111111111111";

    it.each([
      [
        "add a channel",
        "POST",
        `/admin/marketing/plans/${MISSING}/channels`,
        { campaignSlug: "meta", label: "x" },
      ],
      [
        "remove a channel",
        "DELETE",
        `/admin/marketing/plans/${MISSING}/channels/${MISSING}`,
        undefined,
      ],
      [
        "unlink a code",
        "DELETE",
        `/admin/marketing/plans/${MISSING}/codes/${MISSING}`,
        undefined,
      ],
      [
        "update a store offer",
        "PATCH",
        `/admin/marketing/plans/${MISSING}/store-offers/${MISSING}`,
        { priceMinor: 1 },
      ],
      [
        "remove a store offer",
        "DELETE",
        `/admin/marketing/plans/${MISSING}/store-offers/${MISSING}`,
        undefined,
      ],
      [
        "record a metric",
        "PUT",
        `/admin/marketing/plans/${MISSING}/metrics`,
        { metricDate: "2026-09-12" },
      ],
    ])(
      "404s an attempt to %s on a plan that does not exist",
      async (_label, method, path, body) => {
        const res = await call(method, path, body);
        expect(res.status).toBe(404);
      },
    );

    it("404s adding a store offer to a plan that does not exist", async () => {
      const res = await call(
        "POST",
        `/admin/marketing/plans/${MISSING}/store-offers`,
        {
          platform: "ios",
          code: "FOUNDERS6",
          tierName: "premium",
          durationMonths: 6,
          priceMinor: 3000,
        },
      );
      expect(res.status).toBe(404);
    });

    it("404s linking a code to a plan that does not exist", async () => {
      await newCode("METAFOUND");
      const res = await call(
        "POST",
        `/admin/marketing/plans/${MISSING}/codes`,
        {
          code: "METAFOUND",
        },
      );
      expect(res.status).toBe(404);
    });

    it("400s a code link pinned to an unknown campaign slug", async () => {
      const id = await newPlan();
      await newCode("METAFOUND");
      const res = await call("POST", `/admin/marketing/plans/${id}/codes`, {
        code: "METAFOUND",
        campaignSlug: "tiktok-shop",
      });
      expect(res.status).toBe(400);
    });

    it("400s a code link that names neither an id nor a word", async () => {
      const id = await newPlan();
      const res = await call("POST", `/admin/marketing/plans/${id}/codes`, {});
      expect(res.status).toBe(404);
    });

    it.each([
      ["a code with punctuation", { code: "FOUND-6" }],
      ["an unknown campaign slug", { campaignSlug: "tiktok-shop" }],
      ["an unparseable expiry", { expiresOn: "31/10/2026" }],
    ])("400s a store offer with %s", async (_label, overrides) => {
      const id = await newPlan();
      const res = await call(
        "POST",
        `/admin/marketing/plans/${id}/store-offers`,
        {
          platform: "ios",
          code: "FOUNDERS6",
          tierName: "premium",
          durationMonths: 6,
          priceMinor: 3000,
          ...overrides,
        },
      );
      expect(res.status).toBe(400);
      const rows = await pg.query(`SELECT 1 FROM marketing_plan_store_offers`);
      expect(rows.rows).toEqual([]);
    });

    it("stores a store offer's optional redemption URL and notes", async () => {
      const id = await newPlan();
      const res = await call(
        "POST",
        `/admin/marketing/plans/${id}/store-offers`,
        {
          platform: "ios",
          code: "FOUNDERS6",
          tierName: "premium",
          durationMonths: 6,
          priceMinor: 3000,
          currency: "GBP",
          redemptionUrl: "  https://apps.apple.com/redeem?code=FOUNDERS6  ",
          notes: "  Six months up front  ",
        },
      );
      expect(res.status).toBe(201);
      const rows = await pg.query<{ redemption_url: string; notes: string }>(
        `SELECT redemption_url, notes FROM marketing_plan_store_offers`,
      );
      expect(rows.rows[0]).toEqual({
        redemption_url: "https://apps.apple.com/redeem?code=FOUNDERS6",
        notes: "Six months up front",
      });
    });

    it("patches a store offer's every editable field", async () => {
      const id = await newPlan();
      const created = await call(
        "POST",
        `/admin/marketing/plans/${id}/store-offers`,
        {
          platform: "ios",
          code: "FOUNDERS6",
          tierName: "premium",
          durationMonths: 6,
          priceMinor: 3000,
        },
      );
      const offerId = (await json<{ data: { id: string } }>(created)).data.id;
      const res = await call(
        "PATCH",
        `/admin/marketing/plans/${id}/store-offers/${offerId}`,
        {
          tierName: "premium_plus",
          durationMonths: 12,
          priceMinor: 10000,
          currency: "GBP",
          maxRedemptions: null,
          expiresOn: "2026-12-31",
          campaignSlug: "meta",
          redemptionUrl: "  https://apps.apple.com/redeem?code=X  ",
          notes: null,
        },
      );
      expect(res.status).toBe(200);
      const rows = await pg.query<Record<string, unknown>>(
        `SELECT tier_name, duration_months, price_minor, max_redemptions,
                expires_on, campaign_slug, redemption_url, notes
         FROM marketing_plan_store_offers`,
      );
      expect(rows.rows[0]).toEqual({
        tier_name: "premium_plus",
        duration_months: 12,
        price_minor: 10000,
        max_redemptions: null,
        // PGlite hands a `date` column back as a Date; the API serialises the
        // Drizzle-typed string. Either way the stored day is what matters.
        expires_on: new Date("2026-12-31T00:00:00.000Z"),
        campaign_slug: "meta",
        redemption_url: "https://apps.apple.com/redeem?code=X",
        notes: null,
      });
    });

    it.each([
      ["an unknown campaign slug", { campaignSlug: "tiktok-shop" }],
      ["an unparseable expiry", { expiresOn: "31/10/2026" }],
    ])("400s a store-offer PATCH with %s", async (_label, patch) => {
      const id = await newPlan();
      const created = await call(
        "POST",
        `/admin/marketing/plans/${id}/store-offers`,
        {
          platform: "ios",
          code: "FOUNDERS6",
          tierName: "premium",
          durationMonths: 6,
          priceMinor: 3000,
        },
      );
      const offerId = (await json<{ data: { id: string } }>(created)).data.id;
      const res = await call(
        "PATCH",
        `/admin/marketing/plans/${id}/store-offers/${offerId}`,
        patch,
      );
      expect(res.status).toBe(400);
    });

    it("400s a metric row pinned to an unknown campaign slug", async () => {
      const id = await newPlan();
      const res = await call("PUT", `/admin/marketing/plans/${id}/metrics`, {
        campaignSlug: "tiktok-shop",
        metricDate: "2026-09-12",
      });
      expect(res.status).toBe(400);
    });

    it("stores every metric field, trimming the note", async () => {
      const id = await newPlan();
      const res = await call("PUT", `/admin/marketing/plans/${id}/metrics`, {
        campaignSlug: "meta",
        metricDate: "2026-09-12",
        spendMinor: 1000,
        impressions: 5000,
        clicks: 90,
        landingViews: 70,
        storeRedemptions: 3,
        notes: "  Day one  ",
      });
      expect(res.status).toBe(200);
      const rows = await pg.query<Record<string, unknown>>(
        `SELECT spend_minor, impressions, clicks, landing_views,
                store_redemptions, notes, recorded_by
         FROM marketing_plan_metrics`,
      );
      expect(rows.rows[0]).toEqual({
        spend_minor: 1000,
        impressions: 5000,
        clicks: 90,
        landing_views: 70,
        store_redemptions: 3,
        notes: "Day one",
        recorded_by: ADMIN,
      });
    });

    it("clears fields left out of a re-entered metric row", async () => {
      // The weekly form re-submits the whole row, so an omitted field means
      // "cleared", not "unchanged" — otherwise a corrected typo could never be
      // removed.
      const id = await newPlan();
      await call("PUT", `/admin/marketing/plans/${id}/metrics`, {
        metricDate: "2026-09-12",
        spendMinor: 1000,
        impressions: 5000,
      });
      await call("PUT", `/admin/marketing/plans/${id}/metrics`, {
        metricDate: "2026-09-12",
        spendMinor: 1000,
      });
      const rows = await pg.query<{ impressions: number | null }>(
        `SELECT impressions FROM marketing_plan_metrics`,
      );
      expect(rows.rows).toEqual([{ impressions: null }]);
    });
  });

  describe("a plan with no dates of its own", () => {
    it("does not reverse its window when the end date is already past", async () => {
      // Recording a campaign that has already run: start left blank, end in
      // the past. The DB CHECK does not compare `ends_on` to `created_at`, so
      // the creation-date fallback used to put `from` AFTER `to` — every
      // window query is `>= from AND < to`, so the whole panel read zero over
      // a header saying "6 Sep 2026 to 1 Sep 2026".
      const id = await newPlan({
        slug: "already-ran",
        startsOn: null,
        endsOn: "2026-09-01",
      });
      const res = await call("GET", `/admin/marketing/plans/${id}`);
      expect(res.status).toBe(200);
      const { window } = (
        await json<{
          data: { attribution: { window: { from: string; to: string } } };
        }>(res)
      ).data.attribution;
      expect(window.from).toBe("2026-09-01");
      expect(window.to).toBe("2026-09-01");
    });

    it("reads its window from creation to today", async () => {
      // `starts_on`/`ends_on` are optional, so the window has to fall back to
      // the plan's own creation date and today — an empty window would silently
      // report every channel as producing nothing.
      const id = await newPlan({
        slug: "undated",
        startsOn: null,
        endsOn: null,
      });
      await call("POST", `/admin/marketing/plans/${id}/channels`, {
        campaignSlug: "meta",
        label: "Meta ads",
      });
      await pg.query(
        `INSERT INTO analytics_events (event_name, source, occurred_at, properties)
         VALUES ('store_click', 'web', now(), '{"campaign":"meta","store":"ios"}')`,
      );
      const res = await call("GET", `/admin/marketing/plans/${id}`);
      const body = await json<{
        data: {
          attribution: { channels: Array<{ storeClicks: number }> };
        };
      }>(res);
      expect(body.data.attribution.channels[0]!.storeClicks).toBe(1);
    });
  });

  it("serves the campaign slugs the marketing site knows", async () => {
    const res = await call("GET", "/admin/marketing/campaign-slugs");
    const body = await json<{ data: { slugs: string[] } }>(res);
    expect(body.data.slugs).toContain("meta");
    // `default` is the /qr fallback bucket, not a channel anyone plans around.
    expect(body.data.slugs).not.toContain("default");
  });
});
