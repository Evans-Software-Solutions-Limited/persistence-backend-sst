import { Linking } from "react-native";
import {
  fireEvent,
  renderWithTheme,
} from "../../../../../__tests__/test-utils";
import {
  PRIVACY_POLICY_URL,
  TERMS_OF_USE_URL,
} from "../../../../domain/models/legal";
import { SubscriptionLegalFooter } from "../SubscriptionLegalFooter";

/**
 * Apple App Review Guideline 3.1.2 compliance guard.
 *
 * The 2026-07 App Store rejection was for a missing Terms of Use (EULA) link
 * in the *metadata*; the binary was missing them too. These tests exist so a
 * future refactor can't silently drop the links or point them somewhere dead
 * and hand us the same rejection again.
 */
describe("SubscriptionLegalFooter", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders the auto-renew disclosure required at the point of purchase", () => {
    const { getByTestId } = renderWithTheme(<SubscriptionLegalFooter />);

    const disclosure = getByTestId("subscription-legal-disclosure");
    const copy = disclosure.props.children as string;

    expect(copy).toContain("renew automatically");
    expect(copy).toContain("24 hours before the end of the current period");
    expect(copy).toContain("Apple Account");
  });

  it("uses card wording on the card rail — an Apple Account is not involved", () => {
    // Apple only ever sees the apple variant (the Stripe rail is unreachable
    // on iOS), but "charged to your Apple Account" on a card-billed Android
    // surface would simply be untrue.
    const { getByTestId } = renderWithTheme(
      <SubscriptionLegalFooter rail="card" />,
    );
    const copy = getByTestId("subscription-legal-disclosure").props
      .children as string;

    expect(copy).not.toContain("Apple Account");
    expect(copy).toContain("payment method");
    // The 3.1.2 renewal mechanics are required on BOTH rails.
    expect(copy).toContain("renew automatically");
    expect(copy).toContain("24 hours before the end of the current period");
  });

  it("renders both legal links", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <SubscriptionLegalFooter />,
    );

    expect(getByTestId("subscription-legal-footer")).toBeTruthy();
    expect(getByText("Terms of Use (EULA)")).toBeTruthy();
    expect(getByText("Privacy Policy")).toBeTruthy();
  });

  it("opens the Terms of Use (EULA) URL when the terms link is tapped", () => {
    const spy = jest
      .spyOn(Linking, "openURL")
      .mockResolvedValue(undefined as unknown as never);

    const { getByTestId } = renderWithTheme(<SubscriptionLegalFooter />);
    fireEvent.press(getByTestId("subscription-terms-link"));

    expect(spy).toHaveBeenCalledWith(TERMS_OF_USE_URL);
  });

  it("opens the privacy policy URL when the privacy link is tapped", () => {
    const spy = jest
      .spyOn(Linking, "openURL")
      .mockResolvedValue(undefined as unknown as never);

    const { getByTestId } = renderWithTheme(<SubscriptionLegalFooter />);
    fireEvent.press(getByTestId("subscription-privacy-link"));

    expect(spy).toHaveBeenCalledWith(PRIVACY_POLICY_URL);
  });

  it("swallows a Linking.openURL rejection so a dead handoff can't wedge the purchase flow", async () => {
    jest
      .spyOn(Linking, "openURL")
      .mockRejectedValue(new Error("no handler") as never);

    const { getByTestId } = renderWithTheme(<SubscriptionLegalFooter />);

    expect(() =>
      fireEvent.press(getByTestId("subscription-terms-link")),
    ).not.toThrow();
    await Promise.resolve();
  });

  it("points the EULA link at Apple's standard agreement, served over https", () => {
    expect(TERMS_OF_USE_URL).toBe(
      "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/",
    );
    expect(PRIVACY_POLICY_URL).toMatch(/^https:\/\//);
  });
});
