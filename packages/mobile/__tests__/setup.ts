// Jest setup file for mobile package
// Runs after test framework is installed but before tests execute

// Mock react-native-reanimated
jest.mock("react-native-reanimated", () => {
  const { View } = require("react-native");
  return {
    __esModule: true,
    default: {
      View,
      createAnimatedComponent: (component: unknown) => component,
    },
    useSharedValue: (init: number) => ({ value: init }),
    useAnimatedStyle: (fn: () => unknown) => fn(),
    useAnimatedProps: (fn: () => unknown) => fn(),
    withTiming: (val: number) => val,
    withDelay: (_delay: number, val: number) => val,
    withRepeat: (val: number) => val,
    interpolate: (val: number) => val,
    Extrapolation: { CLAMP: "clamp" },
    Easing: {
      linear: "linear",
      cubic: "cubic",
      ease: "ease",
      out: () => "easeOut",
      in: () => "easeIn",
      inOut: () => "easeInOut",
    },
    FadeIn: {
      duration: () => ({ duration: () => ({}) }),
    },
  };
});

// Mock react-native-svg (native module, not available in Jest)
jest.mock("react-native-svg", () => {
  const { View } = require("react-native");
  return {
    __esModule: true,
    default: View, // Svg
    Svg: View,
    Path: View,
    Circle: View,
    Rect: View,
    G: View,
  };
});

// Mock expo-linear-gradient (native module, not available in Jest)
jest.mock("expo-linear-gradient", () => {
  const View = require("react-native").View;
  return {
    LinearGradient: View,
  };
});

// Mock expo-web-browser (used by OAuth flow)
jest.mock("expo-web-browser", () => ({
  openAuthSessionAsync: jest.fn(),
}));

// Mock expo-linking (used by OAuth redirect URL)
jest.mock("expo-linking", () => ({
  createURL: jest.fn((path: string) => `persistencemobile://${path}`),
}));

// Mock expo-notifications (M3 — native bindings unavailable in Jest).
// The ExpoNotificationsAdapter is a thin wrapper; integration is verified
// on staging EAS builds before merge per FRONTEND_BRIEF § Group C.
jest.mock("expo-notifications", () => ({
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  getPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  scheduleNotificationAsync: jest.fn(async () => "stub-notif-id"),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
}));

// Mock @expo/vector-icons to a no-op View. The real Icon component
// kicks off an async font-loader on mount that calls setState after
// the font resolves; if the test finishes before that, the setState
// fires after Jest tears down its environment and emits
// "ReferenceError: You are trying to access a property or method of
// the Jest environment after it has been torn down." Stubbing here
// removes the async leak globally so any test that mounts an Icon
// (sessions, banners, tab icons, etc.) is safe.
jest.mock("@expo/vector-icons", () => {
  const { View } = require("react-native");
  const React = require("react");
  const Icon = (props: Record<string, unknown>) =>
    React.createElement(View, { testID: props.testID });
  return new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === "__esModule") return true;
        return Icon;
      },
    },
  );
});

// Silence known-noisy warnings in tests unless debugging.
// Other warnings (including React act() warnings) still surface.
const SILENCED_WARNINGS = [
  "Require cycle:",
  "Non-serializable values were found in the navigation state",
  "AsyncStorage has been extracted",
];

if (!process.env.DEBUG_TESTS) {
  const originalWarn = console.warn;
  jest.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    const message = typeof args[0] === "string" ? args[0] : "";
    if (SILENCED_WARNINGS.some((prefix) => message.startsWith(prefix))) {
      return;
    }
    originalWarn(...args);
  });
}
