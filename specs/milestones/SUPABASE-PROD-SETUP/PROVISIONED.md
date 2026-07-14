# Supabase Prod Setup — Provisioned Resources (live coordinates)

_Non-secret coordinates only (project ref, URL, anon/publishable key — all
public-by-design). **Never** add DB passwords, service-role keys, or pooler
connection strings here — those go straight into GitHub Environment secrets._

## Staging — `persistence-staging` ✅ CREATED 2026-07-14 (via MCP)
- **Org:** `yeasty-apricot-zahshtf` (existing free org) · **Plan:** Free · **Region:** `eu-west-2` · **PG 17**
- **Project ref:** `nxkhlrvjxotyjulodxzk`
- **Project URL:** `https://nxkhlrvjxotyjulodxzk.supabase.co`  ← `domain-config.ts` staging + mobile preview/dev profile
- **anon key (legacy JWT):**
  `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54a2hscnZqeG90eWp1bG9keHprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwMjY1NjEsImV4cCI6MjA5OTYwMjU2MX0.0_Y1EZmY4erEII_7u1gKm1XbffLkM6PIfDEtMWI8Kmc`
- **publishable key (new format):** `sb_publishable_0iNqYz7shdeooibTaD4lMQ_g7JYKsgC`
- **Still needed from the dashboard (secrets → GitHub `staging` Environment):**
  DB password (Settings → Database → reset/copy), transaction-pooler `DATABASE_URL`
  (port 6543), `service_role` key (Settings → API), plus a `SUPABASE_ACCESS_TOKEN`.

## Production — `persistence-prod` ✅ CREATED 2026-07-14 (Brad, dashboard)
- **Org:** NEW org (separate from the free org) · **Plan:** Pro · **Region:** `eu-west-2`
- **Compute:** **Micro** (Brad's call — Small/PITR deferred; ⚠ **PITR requires ≥ Small**, so
  PITR is NOT active until the compute is upgraded → Phase 6 backups = daily snapshots only for now)
- **Project ref:** `opcvjypsoivaxerahbal`
- **Project URL:** `https://opcvjypsoivaxerahbal.supabase.co`  ← already wired into `domain-config.ts` production
- **anon key:** _Brad to paste_ (⚠ **MCP cannot read this project** — it lives in an org the MCP
  connector isn't authorised for; every MCP call against `opcvjypsoivaxerahbal` returns
  "permission denied"). Needed for the mobile prod build profile (`eas.json`).
- (secrets → GitHub `Production` Environment, same set as staging + live Stripe/RevenueCat)

> **⚠ MCP scope:** the Supabase MCP connector is authorised only for the `yeasty-apricot-zahshtf`
> org (it lists only `persistence-staging` + old `persistence`). The prod project is invisible to
> it → **all prod migrate/harden/verify work is dashboard + CI, not MCP.** To let Claude assist prod
> via MCP later, re-auth the connector for the new org.

## Old shared free project — `dfeyebgdktfteqlacmru` ⚠ RETIRE AFTER PROD CUTOVER PROVEN
- Currently still referenced by `domain-config.ts` for BOTH stages until the code edit lands.
