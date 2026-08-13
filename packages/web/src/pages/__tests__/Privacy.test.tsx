import { screen } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import Privacy from "../Privacy";

/**
 * This page is the policy URL registered in App Store Connect, so it is the
 * higher-exposure of the two copies — the other being
 * `packages/mobile/.../PrivacyPolicyPresenter.tsx`, which has a mirror of this
 * suite.
 *
 * These assertions deliberately pin the claims that carry legal weight rather
 * than layout: an overstated privacy policy is itself a UK GDPR Art 5(1)(a)
 * breach, and the two copies silently diverging is exactly what this change was
 * raised to fix. A one-sided edit should fail CI, not ship.
 */
describe("Privacy", () => {
  it("renders every section heading", () => {
    renderPage(<Privacy />);
    // The presenter suite pins all fourteen of its numbered titles; without the
    // same inventory here, silently dropping the transfers or security section
    // from the HIGHER-exposure copy would stay green.
    for (const heading of [
      "Who can use Persistence",
      "Information we collect",
      "How we use your information",
      "AI features and what they do with your data",
      "Importing a recipe from a link",
      "Legal bases for using your data",
      "Sharing data with your coach",
      "Third-party services",
      "Where your data is stored and international transfers",
      "How we protect your data",
      "Data retention",
      "Your rights",
      "Cookies and the Persistence website",
      "Advertising and measurement",
      "Changes to this policy",
      "Contact",
    ]) {
      expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
    }
  });

  it("does NOT claim AI on the recipe-import-from-link path", () => {
    renderPage(<Privacy />);
    // `recipesImportHandler` is deterministic Schema.org ld+json scraping — no
    // Bedrock anywhere in recipes/services — and `recipes.source_url` IS
    // persisted, so the blanket not-stored sentence had to carve it out.
    expect(screen.getByText(/This one does not involve AI/)).toBeTruthy();
    expect(
      screen.getByText(/the site you named sees a\s+request from us/),
    ).toBeTruthy();
    expect(
      screen.getByText(/the link to any recipe you imported/),
    ).toBeTruthy();
  });

  it("states the 13+ age floor, the under-13 route, and the under-18 coach warning", () => {
    renderPage(<Privacy />);
    // 13 is the UK statutory age for a child to consent to an online service on
    // their own behalf (DPA 2018 s.9). Because the App Store content rating is
    // 9+, the service is "likely to be accessed by children", so the under-18
    // coach-sharing warning is load-bearing, not decoration.
    expect(
      screen.getByText(/Persistence is intended for users aged 13 or over/),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /an account belongs to someone under 13, we will delete it/,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(/If you are under 18, please talk to a parent/),
    ).toBeTruthy();
  });

  it("covers religious belief, not just health, under Article 9", () => {
    renderPage(<Privacy />);
    // `nutrition_preferences.dietary_patterns` permits 'halal' and 'kosher',
    // which reveal RELIGIOUS BELIEF — a separate Art 9(1) category from health.
    // A 9(2)(a) basis worded only around "health and body metrics" would not
    // reach it, so this must stay explicit.
    // Stated TWICE by design: once where the data is listed as collected, once
    // in the Art 9(2)(a) basis. Both are load-bearing.
    expect(
      screen.getAllByText(/religious or philosophical belief/).length,
    ).toBe(2);
    expect(
      screen.getByText(/the allergens you\s+ask us to avoid/),
    ).toBeTruthy();
  });

  it("lists food preferences as collected special-category data", () => {
    renderPage(<Privacy />);
    expect(screen.getByText(/Food preferences/)).toBeTruthy();
    expect(
      screen.getByText(/halal or kosher\), foods you dislike or like/),
    ).toBeTruthy();
  });

  it("discloses Health Connect alongside Apple Health", () => {
    renderPage(<Privacy />);
    expect(
      screen.getByText(/data read\s+from Apple Health or Health Connect/),
    ).toBeTruthy();
    expect(
      screen.getByText(/raw Apple Health or\s+Health Connect data/),
    ).toBeTruthy();
  });

  it("names all four legal bases with their Article references", () => {
    renderPage(<Privacy />);
    expect(
      screen.getByText(/Performance of a contract \(Article 6\(1\)\(b\)\)/),
    ).toBeTruthy();
    expect(
      screen.getByText(/Explicit consent \(Article 9\(2\)\(a\)\)/),
    ).toBeTruthy();
    expect(
      screen.getByText(/Legitimate interests \(Article 6\(1\)\(f\)\)/),
    ).toBeTruthy();
    expect(
      screen.getByText(/Legal obligation \(Article 6\(1\)\(c\)\)/),
    ).toBeTruthy();
  });

  it("states that submitted images and text are not stored, nor used for training", () => {
    renderPage(<Privacy />);
    // True because the AI handlers take the payload in the request body, forward
    // it to Bedrock and persist nothing: `Avatars` is the only bucket, and
    // `ai_usage_log` records sizes and duration only.
    expect(
      screen.getByText(/The images and text you submit are not stored/),
    ).toBeTruthy();
    expect(
      screen.getByText(/nothing you send is used to train AI models/),
    ).toBeTruthy();
  });

  it("discloses every AI path, including the STORED coach summary", () => {
    renderPage(<Privacy />);
    // Naming only the photo path would be an Art 13(1)(c) gap — text food
    // logging, recipe extraction and the Loadout remap all reach Bedrock, and
    // the coach summary is the one output PERSISTED (`client_ai_summaries`).
    expect(screen.getByText(/Food logging from a description/)).toBeTruthy();
    expect(screen.getByText(/Recipes from a photo/)).toBeTruthy();
    expect(
      screen.getByText(/Equipment scanning and workout adaptation/),
    ).toBeTruthy();
    expect(screen.getByText(/Coach summaries/)).toBeTruthy();
    // Mealprint (#350) landed on main mid-review with a mounted, live
    // `POST /nutrition/ai/meal-suggest`. It was undisclosed until the rebase.
    expect(screen.getByText(/Meal suggestions/)).toBeTruthy();
    // Plan generation + single-meal swap (spec-26 Phase 2) — new live AI paths.
    expect(screen.getByText(/Meal plans/)).toBeTruthy();
    // Two bullets now carry the server-side shortlist promise, so this must be
    // getAllByText — a singular getByText throws on the ambiguity, which is the
    // signal that the plan disclosure was added.
    expect(screen.getAllByText(/applied on our servers/)).toHaveLength(2);
    expect(screen.getByText(/the summary that comes back/)).toBeTruthy();
    // Teardown now DELETES the summaries, so the policy must not imply they
    // merely become inaccessible — reconnecting used to revive them.
    expect(
      screen.getByText(/nothing reappears if you later reconnect/),
    ).toBeTruthy();
  });

  it("states the 30-day deletion window and that restore needs confirming", () => {
    renderPage(<Privacy />);
    expect(
      screen.getByText(/scheduled for permanent deletion 30 days later/),
    ).toBeTruthy();
    // Signing in alone is not sufficient: the restore screen requires an
    // explicit confirm that calls POST /account/restore.
    expect(
      screen.getByText(/signing back in and confirming\s+when prompted/),
    ).toBeTruthy();
  });

  it("states that the consent record and coach access log die with the account", () => {
    renderPage(<Privacy />);
    // Both tables are ON DELETE CASCADE off `profiles`.
    expect(
      screen.getByText(/are deleted along with your account/),
    ).toBeTruthy();
  });

  it("claims the 12-month window now that a nightly sweep enforces it", () => {
    renderPage(<Privacy />);
    // The firm ceiling is only publishable because `dataRetentionSweep` runs on
    // the nightly `accountPurgeCron`. If that sweep is ever removed, this claim
    // becomes false and these assertions must be softened back.
    expect(
      screen.getAllByText(/deleted automatically each night/i).length,
    ).toBe(2);
    expect(
      screen.getByText(/is kept for up to 12 months, so that we can answer/),
    ).toBeTruthy();
    // Webhook event tables are still never pruned, so retention there IS
    // unbounded — "at least six years" stays honest where a bare "six years"
    // would understate it.
    expect(screen.getByText(/at least six years from the/)).toBeTruthy();
  });

  it("describes the consent-gated Meta cookie, not the old 'no cookies' claim", () => {
    renderPage(<Privacy />);
    // The superseded absolute claims are gone (the pixel now exists, behind a
    // consent gate — spec-30 R3.5/R3.6).
    expect(screen.queryByText(/It sets no cookies at all/)).toBeNull();
    expect(
      screen.queryByText(/there is no cookie banner to dismiss/),
    ).toBeNull();
    // The accurate replacement: Meta named, consent-gated, withdrawable — and
    // NOT claiming the dormant Turnstile runs.
    expect(screen.getByText(/one advertising cookie from Meta/)).toBeTruthy();
    expect(screen.getByText(/nothing is stored until you choose/)).toBeTruthy();
    // Unique to the cookies section (the advertising section reuses the "footer"
    // phrasing, so assert the cookie-specific withdrawal wording instead).
    expect(
      screen.getByText(/withdrawing consent\s+removes these cookies/),
    ).toBeTruthy();
  });

  it("discloses Meta as a server-side recipient and drops the blanket advertising claim (R3.7)", () => {
    renderPage(<Privacy />);
    // The blanket "we don't use it for advertising" claims are gone — the CAPI
    // makes them false.
    expect(screen.queryByText(/we do not use it for advertising/)).toBeNull();
    expect(
      screen.queryByText(/do not sell them or use them for advertising/),
    ).toBeNull();
    // Replaced with an accurate, scoped disclosure: Meta named as a server-side
    // recipient, hashed email, consent-based, and app activity never sent.
    expect(
      screen.getByText(
        /our servers send Meta Platforms Ireland Limited a limited set of website events/,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /Your activity\s+inside the Persistence app is never sent to Meta/,
      ),
    ).toBeTruthy();
    // The remaining scoped claim (health/app data not used for advertising) is
    // fine and stays — assert it survives so we don't over-scrub.
    expect(
      screen.getByText(
        /we never use your workouts, nutrition, progress or\s+health data for advertising/,
      ),
    ).toBeTruthy();
  });

  it("carries no trace of the superseded copy", () => {
    renderPage(<Privacy />);
    expect(screen.queryByText(/Last updated: 22 July 2026/)).toBeNull();
    // The 16+ floor was replaced by 13+ (Brad, 2026-08-03) — a stale 16 in
    // either copy is the divergence this suite exists to catch.
    expect(screen.queryByText(/aged 16 or over/)).toBeNull();
  });
});
