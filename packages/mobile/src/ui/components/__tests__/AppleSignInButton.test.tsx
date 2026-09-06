import * as AppleAuthentication from "expo-apple-authentication";

import { renderWithTheme, waitFor } from "../../../../__tests__/test-utils";
import { AppleSignInButton } from "../AppleSignInButton";

/**
 * Sign in with Apple — App Store Guideline 4 (Design) compliance guard.
 *
 * App Review rejected build 1.0 (39) because the button was drawn by hand: a
 * generic `<OAuthButton>` whose "logo" was the U+F8FF private-use glyph in the
 * app's own font, which is not the Apple mark from Apple Design Resources.
 *
 * The fix is to render Apple's own `AppleAuthenticationButton`, so these tests
 * assert the two things that keep it compliant — that we delegate to Apple's
 * component at all, and that we hand it a configuration Apple permits.
 *
 * Presses go through `button.props.onPress()` rather than `fireEvent.press`.
 * The real button is a native view whose hit-testing no mock reproduces, and
 * RNTL resolves a synthetic press by walking up to the outermost `onPress` —
 * bypassing this component entirely. Invoking the prop is exactly what
 * `ASAuthorizationAppleIDButton` does on device.
 */

const isAvailableAsync =
  AppleAuthentication.isAvailableAsync as jest.MockedFunction<
    typeof AppleAuthentication.isAvailableAsync
  >;

const defaultProps = {
  onPress: jest.fn(),
  isLoading: false,
  isDisabled: false,
  testID: "apple-oauth",
};

/** Flatten a possibly-array RN style into a plain object. */
function flatStyle(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...[style].flat().filter(Boolean));
}

type JsonNode = {
  props?: Record<string, unknown>;
  children?: JsonNode[] | null;
};

/**
 * Find the layout wrapper — the node whose direct child is Apple's button.
 * The wrapper owns the spacing and the dimmed/blocked treatment; Apple's
 * button owns everything inside it.
 */
function findWrapper(node: JsonNode | null): JsonNode | null {
  if (!node || !node.children) return null;
  for (const child of node.children) {
    if (child?.props?.testID === "apple-oauth") return node;
    const found = findWrapper(child);
    if (found) return found;
  }
  return null;
}

beforeEach(() => {
  jest.clearAllMocks();
  isAvailableAsync.mockResolvedValue(true);
});

describe("<AppleSignInButton>", () => {
  it("renders Apple's own button rather than a hand-drawn one", () => {
    const { getByTestId } = renderWithTheme(
      <AppleSignInButton {...defaultProps} />,
    );
    expect(getByTestId("apple-oauth")).toBeTruthy();
  });

  it("configures the button with the Apple-permitted type and colour scheme", () => {
    const { getByTestId } = renderWithTheme(
      <AppleSignInButton {...defaultProps} />,
    );
    const button = getByTestId("apple-oauth");

    // CONTINUE renders Apple's "Continue with Apple" label — the copy is
    // Apple's, not ours.
    expect(button.props.buttonType).toBe(
      AppleAuthentication.AppleAuthenticationButtonType.CONTINUE,
    );
    // WHITE = white button, black mark. The app is dark-only, and white-on-dark
    // is Apple's prescribed pairing.
    expect(button.props.buttonStyle).toBe(
      AppleAuthentication.AppleAuthenticationButtonStyle.WHITE,
    );
  });

  it("sets corner radius via cornerRadius, never via style", () => {
    // Apple forbids overriding backgroundColor/borderRadius through `style`;
    // doing so is itself a Guideline 4 failure.
    const { getByTestId } = renderWithTheme(
      <AppleSignInButton {...defaultProps} />,
    );
    const button = getByTestId("apple-oauth");

    expect(button.props.cornerRadius).toBe(14);
    const style = flatStyle(button.props.style);
    expect(style.backgroundColor).toBeUndefined();
    expect(style.borderRadius).toBeUndefined();
  });

  it("gives the button explicit width and height, or it will not appear", () => {
    const { getByTestId } = renderWithTheme(
      <AppleSignInButton {...defaultProps} />,
    );
    const style = flatStyle(getByTestId("apple-oauth").props.style);
    // 52 matches the Google button beside it — the HIG requires Sign in with
    // Apple to be no smaller or less prominent than the alternatives.
    expect(style.height).toBe(52);
    expect(style.width).toBe("100%");
  });

  it("renders no text of its own — the label is Apple's to draw", () => {
    // The rejected implementation rendered "Continue with Apple" plus the
    // U+F8FF glyph as app-drawn <Text>. Nothing here may do that again.
    const { queryByText, toJSON } = renderWithTheme(
      <AppleSignInButton {...defaultProps} />,
    );
    expect(queryByText(/Continue with Apple/i)).toBeNull();
    expect(JSON.stringify(toJSON())).not.toContain("\uF8FF");
  });

  it("fires onPress when Apple's button invokes it", () => {
    const onPress = jest.fn();
    const { getByTestId } = renderWithTheme(
      <AppleSignInButton {...defaultProps} onPress={onPress} />,
    );
    getByTestId("apple-oauth").props.onPress();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("swallows the press while its own auth request is in flight", () => {
    const onPress = jest.fn();
    const { getByTestId } = renderWithTheme(
      <AppleSignInButton {...defaultProps} onPress={onPress} isLoading />,
    );
    getByTestId("apple-oauth").props.onPress();
    expect(onPress).not.toHaveBeenCalled();
  });

  it("swallows the press while a sibling provider is authenticating", () => {
    const onPress = jest.fn();
    const { getByTestId } = renderWithTheme(
      <AppleSignInButton {...defaultProps} onPress={onPress} isDisabled />,
    );
    getByTestId("apple-oauth").props.onPress();
    expect(onPress).not.toHaveBeenCalled();
  });

  it("dims and stops touches while blocked, and is live when idle", () => {
    const { toJSON, rerender } = renderWithTheme(
      <AppleSignInButton {...defaultProps} />,
    );
    const wrapper = () => findWrapper(toJSON() as JsonNode)?.props ?? {};

    expect(flatStyle(wrapper().style).opacity).toBe(1);
    expect(wrapper().pointerEvents).toBe("auto");

    rerender(<AppleSignInButton {...defaultProps} isLoading />);
    expect(flatStyle(wrapper().style).opacity).toBe(0.5);
    expect(wrapper().pointerEvents).toBe("none");
  });

  it("applies the requested top margin", () => {
    const { toJSON } = renderWithTheme(
      <AppleSignInButton {...defaultProps} marginTop="md" />,
    );
    const style = flatStyle(findWrapper(toJSON() as JsonNode)?.props?.style);
    expect(style.marginTop).toBe(8);
  });

  /**
   * These two are the only assertions in this file that live entirely inside
   * an async window: the button starts OPTIMISTIC and collapses only once
   * `isAvailableAsync()` settles. RTL-native's `waitFor` caps at one second by
   * default — jest's `testTimeout` does not govern it, as the note beside that
   * setting in package.json says — and on a two-core CI runner working through
   * 525 suites with coverage, a promise-then plus a re-render can miss that
   * window purely because the box is busy. It failed exactly that way on CI.
   *
   * Widened here rather than through the global `asyncUtilTimeout`: raising
   * the ceiling for every `waitFor` in the package was tried and made things
   * worse, turning fast assertions in other container suites into long polls
   * (32 failures and one suite past ten minutes). The poll still exits the
   * instant the expectation holds, so this costs nothing when it passes.
   */
  const COLLAPSE_TIMEOUT = { timeout: 5000 };

  it("collapses instead of leaving a gap when Sign in with Apple is unavailable", async () => {
    isAvailableAsync.mockResolvedValue(false);
    const { queryByTestId } = renderWithTheme(
      <AppleSignInButton {...defaultProps} />,
    );
    await waitFor(
      () => expect(queryByTestId("apple-oauth")).toBeNull(),
      COLLAPSE_TIMEOUT,
    );
  });

  it("collapses when the availability check rejects", async () => {
    isAvailableAsync.mockRejectedValue(new Error("no native module"));
    const { queryByTestId } = renderWithTheme(
      <AppleSignInButton {...defaultProps} />,
    );
    await waitFor(
      () => expect(queryByTestId("apple-oauth")).toBeNull(),
      COLLAPSE_TIMEOUT,
    );
  });
});
