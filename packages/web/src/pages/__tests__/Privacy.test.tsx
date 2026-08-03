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

  it("states the 16+ age floor and the under-16 deletion route", () => {
    renderPage(<Privacy />);
    expect(
      screen.getByText(/Persistence is intended for users aged 16 or over/),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /an account belongs to someone under 16, we will delete it/,
      ),
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
    expect(screen.getByText(/the summary that comes back/)).toBeTruthy();
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

  it("does not claim a retention period the code cannot enforce", () => {
    renderPage(<Privacy />);
    // `cleanup_old_health_data()` is admin-gated and manually invoked (no
    // pg_cron), so a firm "kept for up to 12 months" would be a commitment with
    // no mechanism. The wording must stay a periodic-removal statement.
    // Both the coach access log and the Apple Health bullets carry it.
    expect(
      screen.getAllByText(/remove records older than 12 months periodically/i)
        .length,
    ).toBe(2);
    // Webhook event tables are never pruned, so retention is unbounded — "at
    // least six years" is honest where a bare "six years" would understate it.
    expect(screen.getByText(/at least six years from the/)).toBeTruthy();
  });

  it("states the cookie position, which is that there are none", () => {
    renderPage(<Privacy />);
    // Verified: no analytics dependency, no external script/font/CDN host, and
    // the only browser storage in packages/web is the theme key.
    expect(screen.getByText(/It sets no cookies at all/)).toBeTruthy();
  });

  it("carries no trace of the superseded copy", () => {
    renderPage(<Privacy />);
    expect(screen.queryByText(/under the age of 13/)).toBeNull();
    expect(screen.queryByText(/Last updated: 22 July 2026/)).toBeNull();
  });
});
