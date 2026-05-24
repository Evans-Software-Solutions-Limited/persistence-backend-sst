/**
 * Tabs layout visibility tests (M10.5 Wave 2 — m105-gates-trainer).
 *
 * The Clients tab is the 6th tab and is conditional on the user being
 * on a trainer tier (`useMySubscription().data.isTrainerTier === true`).
 * The route file itself is always registered — visibility is gated via
 * Expo Router's `href: null` mechanism — so the post-payment Success
 * screen's "Manage Clients" CTA still resolves for non-trainer users
 * (they land on `ClientsContainer`'s `FeatureGatePrompt`).
 *
 * Spec: specs/11-payments-subscriptions/design.md
 *       § Per-screen feature-gate integration (Wave 2)
 * Satisfies: specs/11-payments-subscriptions/requirements.md AC 4.6, 6.1
 */

// Capture every `<Tabs.Screen>` mounted under `<Tabs>` so we can
// assert on the per-tab `options.href` (the visibility hinge).
type CapturedScreen = {
  name: string;
  href: string | null | undefined;
  title: string;
};

const capturedScreens: CapturedScreen[] = [];

jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  // Untyped `props` parameters to keep Jest's mock factory free of
  // type-only references — Jest's `no-out-of-scope-variables` check
  // doesn't permit type aliases here (caught when the suite runs in
  // the full mobile test:unit pass).
  // `Tabs` is a passthrough that renders children. Each `Tabs.Screen`
  // child pushes a CapturedScreen record to the suite-scoped array
  // (the `mock`-prefixed `capturedScreens` is whitelisted by Jest).
  // Returning `null` keeps the test render tree clean — we only care
  // about the side effect.
  function Tabs(props: { children: React.ReactNode }) {
    return React.createElement(React.Fragment, null, props.children);
  }
  function TabsScreen(props: {
    name: string;
    options?: { href?: string | null; title?: string };
  }) {
    capturedScreens.push({
      name: props.name,
      href: props.options?.href,
      title: props.options?.title ?? "",
    });
    return null;
  }
  Tabs.Screen = TabsScreen;
  return { Tabs };
});

// Mock useSafeAreaInsets (no SafeAreaProvider in tests).
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// Mock useMySubscription so each test controls the trainer/non-
// trainer branch directly. We only assert on `data.isTrainerTier`
// (the only field the layout consumes), so the mock return type is
// intentionally loose — the layout treats `data` as `Partial<...>` via
// optional chaining.
type MockSubReturn = { data: Record<string, unknown> | undefined };
const mockUseMySubscription = jest.fn<MockSubReturn, []>();
jest.mock("../../src/ui/hooks/useMySubscription", () => ({
  useMySubscription: () => mockUseMySubscription(),
}));

// eslint-disable-next-line import/first
import React from "react";
// eslint-disable-next-line import/first
import { render } from "@testing-library/react-native";
// eslint-disable-next-line import/first
import TabsLayout from "../(app)/(tabs)/_layout";

beforeEach(() => {
  capturedScreens.length = 0;
  mockUseMySubscription.mockReset();
});

function renderLayout() {
  render(<TabsLayout />);
}

describe("TabsLayout — Clients tab visibility (M10.5 Wave 2)", () => {
  it("registers all six tab screens regardless of subscription tier", () => {
    // The route stays registered so deep links + the Success screen's
    // "Manage Clients" CTA can navigate to /(tabs)/clients regardless
    // of tier. Visibility is governed by `options.href`, not by
    // omitting the screen.
    mockUseMySubscription.mockReturnValue({ data: undefined });
    renderLayout();
    const names = capturedScreens.map((s) => s.name).sort();
    expect(names).toEqual(
      [
        "index",
        "progress",
        "workouts",
        "exercises",
        "clients",
        "profile",
      ].sort(),
    );
  });

  it("hides the Clients tab (href: null) for a free-tier user", () => {
    mockUseMySubscription.mockReturnValue({ data: { isTrainerTier: false } });
    renderLayout();
    const clients = capturedScreens.find((s) => s.name === "clients");
    expect(clients).toBeDefined();
    expect(clients?.href).toBeNull();
  });

  it("hides the Clients tab (href: null) for a premium (non-trainer) user", () => {
    mockUseMySubscription.mockReturnValue({
      data: { isTrainerTier: false, tierName: "premium" },
    });
    renderLayout();
    const clients = capturedScreens.find((s) => s.name === "clients");
    expect(clients?.href).toBeNull();
  });

  it("hides the Clients tab while the subscription cache is still resolving (data undefined)", () => {
    // Defensive default avoids a flash-then-disappear on first launch
    // for non-trainer users; trainer users see the tab on the next
    // focus after `useMySubscription` resolves — acceptable lag per
    // the brief.
    mockUseMySubscription.mockReturnValue({ data: undefined });
    renderLayout();
    const clients = capturedScreens.find((s) => s.name === "clients");
    expect(clients?.href).toBeNull();
  });

  it("shows the Clients tab (href: undefined → default route) for a trainer-pro user", () => {
    mockUseMySubscription.mockReturnValue({
      data: { isTrainerTier: true, tierName: "individual_trainer_pro" },
    });
    renderLayout();
    const clients = capturedScreens.find((s) => s.name === "clients");
    // `undefined` lets Expo Router resolve the default href (the route
    // file path). The Boolean check matters here: `null` would hide
    // it, `undefined` shows it.
    expect(clients?.href).toBeUndefined();
  });

  it("shows the Clients tab for a trainer-standard user", () => {
    mockUseMySubscription.mockReturnValue({
      data: {
        isTrainerTier: true,
        tierName: "individual_trainer_standard",
      },
    });
    renderLayout();
    const clients = capturedScreens.find((s) => s.name === "clients");
    expect(clients?.href).toBeUndefined();
  });

  it("non-Clients tabs are never hidden by the gate (regression cover)", () => {
    // Sanity: changing trainer status must not perturb the other
    // five tabs' visibility. The Clients gate is targeted, not
    // global.
    mockUseMySubscription.mockReturnValue({ data: { isTrainerTier: false } });
    renderLayout();
    const others = capturedScreens.filter((s) => s.name !== "clients");
    for (const screen of others) {
      expect(screen.href).toBeUndefined();
    }
  });
});
