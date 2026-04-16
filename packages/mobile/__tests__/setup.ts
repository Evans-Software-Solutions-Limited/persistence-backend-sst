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
