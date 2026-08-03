import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { PrivacyPolicyPresenter } from "../PrivacyPolicyPresenter";

/**
 * The in-app policy must stay content-identical to the hosted one at
 * `packages/web/src/pages/Privacy.tsx`. These assertions pin the claims that
 * carry legal weight — the ones that were WRONG in the legacy port (age floor,
 * missing legal bases) or that would be an Art 5(1)(a) accuracy breach if they
 * drifted from what the code actually does (meal-photo retention, the 30-day
 * deletion window). If a change here fails these, change the hosted policy in
 * the same PR rather than loosening the test.
 */
describe("PrivacyPolicyPresenter", () => {
  it("renders the header title and last-updated line", () => {
    const { getByText } = renderWithTheme(
      <PrivacyPolicyPresenter onBack={jest.fn()} />,
    );
    expect(getByText("Privacy Policy")).toBeTruthy();
    expect(getByText("Last Updated: 3 August 2026")).toBeTruthy();
  });

  it("renders all fourteen section titles verbatim", () => {
    const { getByText } = renderWithTheme(
      <PrivacyPolicyPresenter onBack={jest.fn()} />,
    );
    expect(getByText("1. Who we are")).toBeTruthy();
    expect(getByText("2. Who can use Persistence")).toBeTruthy();
    expect(getByText("3. Information we collect")).toBeTruthy();
    expect(getByText("4. How we use your information")).toBeTruthy();
    expect(
      getByText("5. AI features and what they do with your data"),
    ).toBeTruthy();
    expect(getByText("6. Legal bases for using your data")).toBeTruthy();
    expect(getByText("7. Sharing data with your coach")).toBeTruthy();
    expect(getByText("8. Third-party services")).toBeTruthy();
    expect(
      getByText("9. Where your data is stored and international transfers"),
    ).toBeTruthy();
    expect(getByText("10. How we protect your data")).toBeTruthy();
    expect(getByText("11. Data retention")).toBeTruthy();
    expect(getByText("12. Your rights")).toBeTruthy();
    expect(getByText("13. Changes to this policy")).toBeTruthy();
    expect(getByText("14. Contact us")).toBeTruthy();
  });

  it("states the 16+ age floor and the under-16 deletion route", () => {
    const { getByText } = renderWithTheme(
      <PrivacyPolicyPresenter onBack={jest.fn()} />,
    );
    expect(
      getByText(/Persistence is intended for users aged 16 or over/),
    ).toBeTruthy();
    expect(
      getByText(/an account belongs to someone under 16, we will delete it/),
    ).toBeTruthy();
  });

  it("carries no trace of the superseded legacy copy", () => {
    const { queryByText } = renderWithTheme(
      <PrivacyPolicyPresenter onBack={jest.fn()} />,
    );
    // The legacy port set the floor at 13 — invalid for explicit-consent
    // special-category processing — and named analytics providers we don't use.
    expect(queryByText(/under the age of 13/)).toBeNull();
    expect(queryByText(/analytics providers/)).toBeNull();
    expect(queryByText("Last Updated: January 2025")).toBeNull();
  });

  it("names all four legal bases with their Article references", () => {
    const { getByText } = renderWithTheme(
      <PrivacyPolicyPresenter onBack={jest.fn()} />,
    );
    expect(
      getByText(/Performance of a contract \(Article 6\(1\)\(b\)\)/),
    ).toBeTruthy();
    expect(getByText(/Explicit consent \(Article 9\(2\)\(a\)\)/)).toBeTruthy();
    expect(
      getByText(/Legitimate interests \(Article 6\(1\)\(f\)\)/),
    ).toBeTruthy();
    expect(getByText(/Legal obligation \(Article 6\(1\)\(c\)\)/)).toBeTruthy();
  });

  it("states that submitted images and text are not stored, nor used for training", () => {
    const { getByText } = renderWithTheme(
      <PrivacyPolicyPresenter onBack={jest.fn()} />,
    );
    // Backed by the implementation: the estimate handlers take the image/text as
    // a request-body payload, forward it to Bedrock and persist nothing — there
    // is no meal-photo bucket and `ai_usage_log` stores sizes only.
    expect(
      getByText(/The images and text you submit are not stored/),
    ).toBeTruthy();
    expect(
      getByText(/nothing you send is used to train AI models/),
    ).toBeTruthy();
  });

  it("discloses every AI path, including the STORED coach summary", () => {
    const { getByText } = renderWithTheme(
      <PrivacyPolicyPresenter onBack={jest.fn()} />,
    );
    // A policy naming only the photo path would be an Art 13(1)(c) gap: text
    // food logging, recipe extraction, Loadout remap and the coach summary all
    // reach Bedrock too, and the coach summary is the one output PERSISTED
    // (`client_ai_summaries`), so it must be called out as such.
    expect(getByText(/Food logging from a description/)).toBeTruthy();
    expect(getByText(/Recipes from a photo/)).toBeTruthy();
    expect(getByText(/Equipment scanning and workout adaptation/)).toBeTruthy();
    expect(getByText(/the summary that comes back is stored/)).toBeTruthy();
  });

  it("does NOT claim AI on the recipe-import-from-link path", () => {
    const { getByText } = renderWithTheme(
      <PrivacyPolicyPresenter onBack={jest.fn()} />,
    );
    // `recipesImportHandler` is deterministic Schema.org ld+json scraping — no
    // Bedrock anywhere in recipes/services. Sweeping it into the AI section
    // claimed processing that does not happen, AND its `recipes.source_url` IS
    // persisted, which the blanket not-stored sentence contradicted.
    expect(
      getByText(/Importing a recipe from a link does not involve AI/),
    ).toBeTruthy();
    expect(getByText(/the site you named sees a request from us/)).toBeTruthy();
    expect(
      getByText(/the link to any recipe you imported, which we/),
    ).toBeTruthy();
  });

  it("does not claim a retention period the code cannot enforce", () => {
    const { getAllByText, getByText } = renderWithTheme(
      <PrivacyPolicyPresenter onBack={jest.fn()} />,
    );
    // Mirrors the web suite. `cleanup_old_health_data()` is admin-gated and
    // manually invoked (no pg_cron), so a firm 12-month ceiling would be a
    // commitment with no mechanism; and the provider webhook-event tables are
    // never pruned, so "at least" is the honest floor. TIGHTENING either of
    // these re-creates the false claim — that is what this test exists to stop.
    expect(
      getAllByText(/remove records older than 12 months periodically/i).length,
    ).toBe(2);
    expect(getByText(/at least six years from the/)).toBeTruthy();
  });

  it("states the 30-day deletion window and that restore needs confirming", () => {
    const { getByText } = renderWithTheme(
      <PrivacyPolicyPresenter onBack={jest.fn()} />,
    );
    expect(
      getByText(/scheduled for permanent deletion 30 days later/),
    ).toBeTruthy();
    // Signing in alone is NOT sufficient — the restore screen requires an
    // explicit confirm that calls POST /account/restore.
    expect(
      getByText(/signing back in and confirming when prompted/),
    ).toBeTruthy();
  });

  it("states that the consent record and coach access log die with the account", () => {
    const { getByText } = renderWithTheme(
      <PrivacyPolicyPresenter onBack={jest.fn()} />,
    );
    // Both tables are ON DELETE CASCADE off `profiles`, so this is accurate and
    // must not regress into the vaguer "retained for N years" framing.
    expect(getByText(/are deleted along with your account/)).toBeTruthy();
  });

  it("fires onBack when the header back affordance is tapped", () => {
    const onBack = jest.fn();
    const { getByTestId } = renderWithTheme(
      <PrivacyPolicyPresenter onBack={onBack} />,
    );
    fireEvent.press(getByTestId("privacy-policy-back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("surfaces the support email so rights are exercisable", () => {
    const { getAllByText } = renderWithTheme(
      <PrivacyPolicyPresenter onBack={jest.fn()} />,
    );
    // Appears in the under-16 route, the transfers section and Contact us.
    const matches = getAllByText(/admin@evans-software-solutions\.com/);
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });
});
