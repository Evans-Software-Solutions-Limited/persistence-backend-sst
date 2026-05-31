/**
 * Tabs layout route-registration tests.
 *
 * Phase 14.3 (14-navigation) restructured the tab route set from the legacy
 * 6 tabs (index / progress / workouts / exercises / clients / profile) to the
 * Option 3 IA: index / train / fuel / you (+ coach-only clients / programs).
 *
 * This transitional layout still uses the legacy Ionicons rendering and keeps
 * the M10.5 Wave 2 trainer-tier gate on Clients (programs is hidden until
 * Phase 14.4 wires mode-driven visibility). Phase 14.4 rewrites the layout to
 * the mode-aware `<TabBar>` primitive + adds the athlete/coach component test
 * (T-14.4.4).
 *
 * Spec: specs/14-navigation/design.md § <TabsLayout> + § Route registration
 *       specs/14-navigation/requirements.md STORY-001, STORY-002 (AC 2.6)
 *       specs/11-payments-subscriptions/design.md § Per-screen gate (Wave 2)
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

describe("TabsLayout — Option 3 route registration (14-navigation Phase 14.3)", () => {
  it("registers exactly the Option 3 tab route set", () => {
    // The route set is the new 4-tab athlete IA + the two coach-only routes
    // (registered so deep links + programmatic navigation resolve; their
    // visibility is gated). Legacy progress / workouts / exercises / profile
    // are gone — folded into you / train / drawer respectively.
    mockUseMySubscription.mockReturnValue({ data: undefined });
    renderLayout();
    const names = capturedScreens.map((s) => s.name).sort();
    expect(names).toEqual(
      ["index", "train", "fuel", "you", "clients", "programs"].sort(),
    );
  });

  it("does not register any legacy tab routes", () => {
    mockUseMySubscription.mockReturnValue({ data: undefined });
    renderLayout();
    const names = capturedScreens.map((s) => s.name);
    for (const legacy of ["progress", "workouts", "exercises", "profile"]) {
      expect(names).not.toContain(legacy);
    }
  });

  it("hides the Programs tab (coach-only) regardless of tier", () => {
    mockUseMySubscription.mockReturnValue({
      data: { isTrainerTier: true, tierName: "individual_trainer" },
    });
    renderLayout();
    const programs = capturedScreens.find((s) => s.name === "programs");
    expect(programs?.href).toBeNull();
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
    mockUseMySubscription.mockReturnValue({ data: undefined });
    renderLayout();
    const clients = capturedScreens.find((s) => s.name === "clients");
    expect(clients?.href).toBeNull();
  });

  it("shows the Clients tab (href: undefined → default route) for a trainer-tier user", () => {
    mockUseMySubscription.mockReturnValue({
      data: { isTrainerTier: true, tierName: "individual_trainer" },
    });
    renderLayout();
    const clients = capturedScreens.find((s) => s.name === "clients");
    // `undefined` lets Expo Router resolve the default href (the route
    // file path). The Boolean check matters here: `null` would hide
    // it, `undefined` shows it.
    expect(clients?.href).toBeUndefined();
  });

  it("the four athlete tabs are always visible (never href: null)", () => {
    mockUseMySubscription.mockReturnValue({ data: { isTrainerTier: false } });
    renderLayout();
    for (const name of ["index", "train", "fuel", "you"]) {
      const screen = capturedScreens.find((s) => s.name === name);
      expect(screen?.href).toBeUndefined();
    }
  });
});
