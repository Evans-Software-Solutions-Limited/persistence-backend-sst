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

// Mock ReanimatedSwipeable (subpath import) — the Fuel meal-log rows wrap each
// logged entry in a swipe-to-delete Swipeable. The real component pulls native
// reanimated/gesture bindings; in Jest we render the row content AND eagerly
// render the right-actions (the Delete panel) so tests can press Delete without
// driving a real gesture. `close()` is a noop.
jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () => {
  const { View } = require("react-native");
  const React = require("react");
  const Swipeable = ({
    children,
    renderRightActions,
  }: {
    children: React.ReactNode;
    renderRightActions?: (
      progress: unknown,
      translation: unknown,
      methods: { close: () => void },
    ) => React.ReactNode;
  }) =>
    React.createElement(
      View,
      null,
      children,
      renderRightActions
        ? renderRightActions(
            { value: 0 },
            { value: 0 },
            { close: () => undefined },
          )
        : null,
    );
  return { __esModule: true, default: Swipeable };
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

// Mock expo-camera (M9 — barcode scanner). The native CameraView can't mount
// in Jest. `CameraView` renders as a plain View exposing its testID so the
// ScanBarcodeSheet tree mounts; the barcode-scan callback is exercised by
// firing it from the test (the mock surfaces no frames). `useCameraPermissions`
// returns a granted permission + a no-op request fn so the permission-gate path
// renders the camera branch by default; per-test overrides take precedence.
jest.mock("expo-camera", () => {
  const { View } = require("react-native");
  const React = require("react");
  const CameraView = React.forwardRef(
    (props: Record<string, unknown>, _ref: unknown) =>
      React.createElement(
        View,
        { testID: (props.testID as string) ?? "camera-view" },
        props.children as React.ReactNode,
      ),
  );
  return {
    __esModule: true,
    CameraView,
    useCameraPermissions: jest.fn(() => [
      { granted: true, canAskAgain: true, status: "granted" },
      jest.fn(async () => ({ granted: true, status: "granted" })),
    ]),
  };
});

// Mock expo-haptics (M9 — water tracker + add-confirm feedback). The native
// taptic engine is a no-op in Jest; tests assert the calls fire via jest.fn().
jest.mock("expo-haptics", () => ({
  __esModule: true,
  selectionAsync: jest.fn(async () => undefined),
  impactAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: {
    Success: "success",
    Warning: "warning",
    Error: "error",
  },
}));

// Mock expo-image (M9 — recipe/food photos). Render the source-driven Image as
// a plain View carrying its testID so cards mount; image decoding/caching is a
// device concern not asserted in Jest.
jest.mock("expo-image", () => {
  const { View } = require("react-native");
  const React = require("react");
  const Image = (props: Record<string, unknown>) =>
    React.createElement(View, { testID: (props.testID as string) ?? "image" });
  return { __esModule: true, Image };
});

// Mock @shopify/flash-list (M9 — meal/food/recipe lists). The real FlashList
// needs native layout measurement; in Jest we render a plain FlatList-style
// pass-through that maps `data` through `renderItem` so list rows are queryable
// in render tests. `estimatedItemSize` and recycling are device-only concerns.
jest.mock("@shopify/flash-list", () => {
  const { View } = require("react-native");
  const React = require("react");
  function FlashList<T>(props: {
    data?: readonly T[] | null;
    renderItem?: (info: { item: T; index: number }) => React.ReactNode;
    keyExtractor?: (item: T, index: number) => string;
    ListEmptyComponent?: React.ReactNode | (() => React.ReactNode);
    ListHeaderComponent?: React.ReactNode | (() => React.ReactNode);
    ListFooterComponent?: React.ReactNode | (() => React.ReactNode);
    testID?: string;
  }) {
    const resolve = (
      c: React.ReactNode | (() => React.ReactNode),
    ): React.ReactNode => (typeof c === "function" ? c() : c);
    const data = props.data ?? [];
    const header = props.ListHeaderComponent
      ? resolve(props.ListHeaderComponent)
      : null;
    const footer = props.ListFooterComponent
      ? resolve(props.ListFooterComponent)
      : null;
    const body =
      data.length === 0 && props.ListEmptyComponent
        ? resolve(props.ListEmptyComponent)
        : data.map((item, index) =>
            React.createElement(
              React.Fragment,
              {
                key: props.keyExtractor
                  ? props.keyExtractor(item, index)
                  : index,
              },
              props.renderItem?.({ item, index }),
            ),
          );
    return React.createElement(
      View,
      { testID: props.testID ?? "flash-list" },
      header,
      body,
      footer,
    );
  }
  return { __esModule: true, FlashList };
});

// Mock expo-web-browser (used by OAuth flow)
jest.mock("expo-web-browser", () => ({
  openAuthSessionAsync: jest.fn(),
}));

// Mock expo-linking (used by the OAuth redirect URL + invite-code deep links).
// Mirrors the real createURL: prefixes the app scheme and appends any
// `queryParams` as a query string (the real module env-switches the prefix;
// tests only need the standalone custom-scheme form + faithful query handling).
jest.mock("expo-linking", () => ({
  createURL: jest.fn(
    (
      path: string,
      options?: { queryParams?: Record<string, string | undefined | null> },
    ) => {
      const entries = Object.entries(options?.queryParams ?? {}).filter(
        ([, value]) => value != null,
      );
      const query = entries.length
        ? "?" + entries.map(([key, value]) => `${key}=${value}`).join("&")
        : "";
      return `persistencemobile://${path}${query}`;
    },
  ),
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
  getExpoPushTokenAsync: jest.fn(async () => ({
    data: "ExponentPushToken[stub]",
    type: "expo",
  })),
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

// Mock react-native-purchases — M12 (iOS RevenueCat rail). The native module
// isn't linked in Jest. The `RevenueCatPurchasesAdapter` (production) is the
// only consumer of the real package; hook / container / presenter tests inject
// `MockPurchasesAdapter` via the Adapters context. This global keeps the
// adapter's own module-load (a static `import Purchases from ...`) from
// blowing up the jest module graph, and lets the adapter's unit test drive
// the static methods via `jest.spyOn`.
jest.mock("react-native-purchases", () => ({
  __esModule: true,
  default: {
    configure: jest.fn(),
    setLogLevel: jest.fn(async () => undefined),
    logIn: jest.fn(async () => ({ customerInfo: {}, created: false })),
    logOut: jest.fn(async () => ({})),
    getOfferings: jest.fn(async () => ({ all: {}, current: null })),
    purchasePackage: jest.fn(async () => ({
      customerInfo: { entitlements: { active: {} } },
      productIdentifier: "",
    })),
    restorePurchases: jest.fn(async () => ({ entitlements: { active: {} } })),
  },
  LOG_LEVEL: { DEBUG: "DEBUG", INFO: "INFO" },
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
