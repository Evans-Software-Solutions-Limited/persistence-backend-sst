// Jest setup file for mobile package
// Runs after test framework is installed but before tests execute

// Mock react-native-reanimated
jest.mock("react-native-reanimated", () => {
  const { View, Text } = require("react-native");
  return {
    __esModule: true,
    default: {
      View,
      Text,
      createAnimatedComponent: (component: unknown) => component,
    },
    useSharedValue: (init: unknown) => ({ value: init }),
    useAnimatedStyle: (fn: () => unknown) => fn(),
    useAnimatedProps: (fn: () => unknown) => fn(),
    // SemiCircleSlider port (Phase 3a) calls these — stub them as
    // pass-through so the component can mount in tests. The actual
    // animation behaviour isn't asserted (it's gesture-driven on
    // device); the slider's pure math lives in Constants.ts and is
    // unit-tested separately.
    useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
    withSpring: (val: unknown) => val,
    runOnJS:
      <Args extends unknown[], R>(fn: (...args: Args) => R) =>
      (...args: Args) =>
        fn(...args),
    withTiming: (val: number) => val,
    withDelay: (_delay: number, val: number) => val,
    withRepeat: (val: number) => val,
    cancelAnimation: () => undefined,
    interpolate: (val: number) => val,
    // <TabBar> (14-navigation Phase 14.6) interpolates the active accent
    // colour between $primary and $accentTrainer. In tests return the first
    // output stop so the rendered colour is deterministic.
    interpolateColor: (
      _val: number,
      _input: readonly number[],
      output: readonly string[],
    ) => output[0],
    // Bar/Ring (01-design-system) call useReducedMotion to bypass the fill
    // animation; default to false in tests so the animated path is exercised.
    useReducedMotion: () => false,
    Extrapolation: { CLAMP: "clamp" },
    Easing: {
      linear: "linear",
      cubic: "cubic",
      ease: "ease",
      out: () => "easeOut",
      in: () => "easeIn",
      inOut: () => "easeInOut",
      bezier: () => ({ factory: () => "bezier" }),
    },
    FadeIn: {
      duration: () => ({ duration: () => ({}) }),
    },
  };
});

// Mock react-native-gesture-handler — SemiCircleSlider's gesture
// overlay (Phase 3a) imports `Gesture.Pan() / .Tap() / .Race()` and
// `<GestureDetector>`. We render the wrapped child as a plain View
// so the SemiCircleSlider mounts in tests; gesture behaviour isn't
// asserted (it's pixel-driven on device).
jest.mock("react-native-gesture-handler", () => {
  const { View } = require("react-native");
  const React = require("react");
  const noop = () => undefined;
  const builder = () => {
    const fn = () => builder();
    fn.onStart = builder;
    fn.onUpdate = builder;
    fn.onEnd = builder;
    fn.maxDuration = builder;
    return fn;
  };
  return {
    __esModule: true,
    Gesture: {
      Pan: builder,
      Tap: builder,
      Race: noop,
    },
    GestureDetector: ({ children }: { children: React.ReactNode }) =>
      React.createElement(View, null, children),
    // Root wrapper used at `app/_layout.tsx` — passthrough so test
    // trees that mount the layout don't have to thread provider
    // boilerplate.
    GestureHandlerRootView: ({ children }: { children: React.ReactNode }) =>
      React.createElement(View, null, children),
  };
});

// Mock SemiCircleSlider — the WorkoutRatingPresenter consumes it as
// the rating control. Tests interact with the presenter via the
// per-value `workout-rating-{n}` testIDs the legacy segmented buttons
// exposed; the real slider is gesture-driven and effectively
// untestable in Jest. The mock renders one TouchableOpacity per
// integer in [minValue, maxValue] that fires `onValueChange(n)` so
// the existing test assertions keep working.
//
// SemiCircleSlider's own implementation is exercised by the pure
// `Constants.ts` math tests, not via this mock.
jest.mock("@/ui/components/workouts/SemiCircleSlider", () => {
  const { TouchableOpacity, View } = require("react-native");
  const React = require("react");
  return {
    __esModule: true,
    SemiCircleSlider: ({
      minValue,
      maxValue,
      value,
      onValueChange,
      renderLabel,
    }: {
      minValue: number;
      maxValue: number;
      value: number;
      onValueChange: (n: number) => void;
      renderLabel?: (val: number) => React.ReactNode;
    }) => {
      const buttons = [];
      for (let n = minValue; n <= maxValue; n++) {
        buttons.push(
          React.createElement(TouchableOpacity, {
            key: n,
            testID: `workout-rating-${n}`,
            onPress: () => onValueChange(n),
            accessibilityLabel: `Rate ${n} out of ${maxValue}`,
          }),
        );
      }
      return React.createElement(
        View,
        { testID: "workout-rating-slider" },
        ...buttons,
        renderLabel ? renderLabel(value) : null,
      );
    },
  };
});

// Mock expo-font — the native font loader isn't available in Jest. The app's
// ThemeProvider gates first paint on `useFonts(...)` returning loaded=true
// (01-design-system STORY-002). Returning [true, null] lets every test tree
// that mounts the provider render immediately with the (mocked) Geist faces.
jest.mock("expo-font", () => ({
  __esModule: true,
  useFonts: jest.fn(() => [true, null]),
  loadAsync: jest.fn(async () => undefined),
  isLoaded: jest.fn(() => true),
}));

// Mock @gorhom/bottom-sheet (01-design-system <BottomSheet> primitive). The
// real package pulls native gesture/reanimated bindings; in Jest we render a
// plain View tree so the sheet's header + children mount and can be asserted.
jest.mock("@gorhom/bottom-sheet", () => {
  const { View } = require("react-native");
  const React = require("react");
  const passthrough = (testIdFallback?: string) =>
    function MockSheetPart(props: Record<string, unknown>) {
      return React.createElement(
        View,
        { testID: (props.testID as string) ?? testIdFallback },
        props.children as React.ReactNode,
      );
    };
  const GorhomBottomSheet = React.forwardRef(
    (props: Record<string, unknown>, _ref: unknown) => {
      const backdropComponent = props.backdropComponent;
      const backdrop =
        typeof backdropComponent === "function"
          ? backdropComponent({ animatedIndex: { value: 0 }, style: {} })
          : null;
      return React.createElement(
        View,
        { testID: "gorhom-bottom-sheet" },
        backdrop,
        props.children as React.ReactNode,
      );
    },
  );
  return {
    __esModule: true,
    default: GorhomBottomSheet,
    BottomSheetModal: GorhomBottomSheet,
    BottomSheetModalProvider: passthrough(),
    BottomSheetView: passthrough(),
    BottomSheetScrollView: passthrough(),
    BottomSheetBackdrop: passthrough("gorhom-backdrop"),
    BottomSheetTextInput: passthrough(),
    BottomSheetHandle: passthrough(),
    useBottomSheet: () => ({ expand: jest.fn(), close: jest.fn() }),
    useBottomSheetModal: () => ({ dismiss: jest.fn() }),
  };
});

// Mock react-native-svg (native module, not available in Jest).
// lucide-react-native imports this as a namespace (`import * as NativeSvg`)
// and renders `NativeSvg.Svg` + PascalCased child tags (Path, Circle, Line,
// Polyline, Polygon, Rect, Ellipse, G, …). A Proxy can't be used here because
// Jest/babel's `_interopRequireWildcard` copies own-enumerable keys, which a
// Proxy doesn't expose — so the namespace must be a plain object that names
// every element lucide (and our own SVG components) may touch.
jest.mock("react-native-svg", () => {
  const { View } = require("react-native");
  const React = require("react");
  // The Svg root maps lucide's `data-testid` onto RN `testID` so icon testIDs
  // stay queryable after the Ionicons -> lucide adoption sweep.
  const Svg = (props: Record<string, unknown>) => {
    const dataTestId = props["data-testid"];
    const testID = (props.testID ?? dataTestId) as string | undefined;
    return React.createElement(
      View,
      { testID },
      props.children as React.ReactNode,
    );
  };
  const elements = [
    "Path",
    "Circle",
    "Ellipse",
    "Line",
    "Polyline",
    "Polygon",
    "Rect",
    "G",
    "Text",
    "TSpan",
    "TextPath",
    "Defs",
    "Use",
    "Symbol",
    "Image",
    "ClipPath",
    "Mask",
    "Marker",
    "Pattern",
    "LinearGradient",
    "RadialGradient",
    "Stop",
    "ForeignObject",
  ];
  const mock: Record<string, unknown> = {
    __esModule: true,
    default: Svg,
    Svg,
  };
  for (const name of elements) {
    mock[name] = View;
  }
  return mock;
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
// `setNotificationHandler` and `setNotificationChannelAsync` were added
// in the post-M3 staging-bugfix PR — both are called at app boot
// (root layout) and must exist on the mock or the layout test suite
// throws during module-load.
jest.mock("expo-notifications", () => ({
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  getPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  scheduleNotificationAsync: jest.fn(async () => "stub-notif-id"),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  AndroidImportance: {
    MAX: 5,
    HIGH: 4,
    DEFAULT: 3,
    LOW: 2,
    MIN: 1,
    NONE: 0,
    UNSPECIFIED: -1000,
  },
}));

// Mock @stripe/stripe-react-native — M10. The native module isn't
// linked in Jest, so importing it for real throws on iOS-only
// bindings. The adapter under test (`StripeApplePayAdapter`) carries
// its own per-test mock at the top of its spec file (which takes
// precedence over this global). This global covers the rest of the
// suite — chiefly the root layout test which mounts `<StripeProvider>`
// and any future container test that pulls in the providers tree.
jest.mock("@stripe/stripe-react-native", () => {
  const { View } = require("react-native");
  const React = require("react");
  return {
    __esModule: true,
    StripeProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(View, null, children),
    isPlatformPaySupported: jest.fn(async () => false),
    createPlatformPayPaymentMethod: jest.fn(async () => ({})),
    handleNextAction: jest.fn(async () => ({})),
    PlatformPay: {
      PaymentType: {
        Immediate: "Immediate",
        Recurring: "Recurring",
        Deferred: "Deferred",
      },
      IntervalUnit: {
        Minute: "minute",
        Hour: "hour",
        Day: "day",
        Month: "month",
        Year: "year",
      },
    },
  };
});

// Mock @react-native-community/netinfo — the native module isn't
// linked in Jest, so importing it directly throws on its native
// bindings. The `RNNetInfoAdapter` (production) is the only consumer
// of the real package; everywhere else, tests inject
// `InMemoryNetInfoAdapter` via the Adapters context. This global
// mock keeps `RNNetInfoAdapter`'s own module-load from blowing up
// the jest module graph if any test happens to import it.
jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: {
    fetch: jest.fn(async () => ({
      isConnected: true,
      isInternetReachable: true,
    })),
    addEventListener: jest.fn(() => () => undefined),
  },
}));

// Mock @react-native-async-storage/async-storage — the native module
// isn't linked in the Jest environment, so importing it directly
// throws `[@RNC/AsyncStorage]: NativeModule: AsyncStorage is null`.
// Required by `useNotificationPermissions` (and any future hook that
// reads / writes the install-scoped permission flag). Per-test
// overrides via `jest.mock(...)` at the top of a test file still
// take precedence over this global.
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
    clear: jest.fn(async () => undefined),
    getAllKeys: jest.fn(async () => []),
    multiGet: jest.fn(async () => []),
    multiSet: jest.fn(async () => undefined),
    multiRemove: jest.fn(async () => undefined),
  },
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
