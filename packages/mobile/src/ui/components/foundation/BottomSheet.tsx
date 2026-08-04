import GorhomBottomSheet, {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import { Text, View } from "@tamagui/core";
import {
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useWindowDimensions } from "react-native";

import { SafeAreaInsetsContext } from "react-native-safe-area-context";

import { useReducedMotionGate } from "@/ui/hooks/useReducedMotionGate";
import { toneHex, toneTokens } from "./tones";

/**
 * <BottomSheet> — slide-up modal for inline flows (Scan, Snap, Quick add,
 * ProfileDrawer). Ports fuel-sheets.jsx:13-42 + extra.jsx:7-25.
 * Implements 01-design-system/design.md § Foundation primitives #12 +
 * STORY-003 AC 3.6 + the 2026-05-29 revision (gorhom v5, not v4).
 *
 * Default 78% height; `peek` drops to 60%, `tall` rises to 88%. Backdrop tap
 * dismisses. The header (eyebrow + title + drag handle) is fixed; children
 * scroll. `accent` tints the eyebrow + drag-handle.
 *
 * ## `footer` — a pinned region below the scroll
 *
 * Ports the prototype's `AMSticky` (design-source `screens.jsx:23`). A sheet
 * whose primary action sits at the BOTTOM OF THE SCROLLING BODY puts that action
 * below the fold whenever the body grows — and the body grows for reasons the
 * user did not choose (a multi-item suggestion, a conditional safety caveat). A
 * confirm button you have to hunt for on the step that writes to a log is a
 * defect, not a polish item, so the commit action belongs in a region that
 * cannot scroll away.
 *
 * The footer is a flex sibling of the scroll view inside the same definite-height
 * column, so it takes its intrinsic height and `flex: 1` leaves the remainder to
 * the scroll view. It also takes over the bottom safe-area inset from the scroll
 * content — leaving both would open a dead band above the footer.
 */

export type BottomSheetAccent =
  | "primary"
  | "gold"
  | "trainer"
  | "ember"
  | "success";
export type BottomSheetHeight = number | "peek" | "default" | "tall";

export type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  eyebrow?: string;
  accent?: BottomSheetAccent;
  /** peek=60%, default=78%, tall=88%, or an explicit percentage number (0-100). */
  height?: BottomSheetHeight;
  children: ReactNode;
  /**
   * Pinned below the scrolling body — for a primary action that must stay
   * reachable however tall `children` grows. See the component docstring.
   */
  footer?: ReactNode;
  testID?: string;
};

/**
 * gorhom's drag handle: `padding: 10` top and bottom around a 4pt indicator
 * (`bottomSheetHandle/styles.ts`, and our `handleIndicatorStyle` keeps that 4).
 * The handle is laid out ABOVE the content inside the sheet, so the body gets
 * the snap height minus this.
 */
const HANDLE_HEIGHT = 24;

/** Snap height as a 0-1 fraction of the container. */
function resolveFraction(height: BottomSheetHeight): number {
  if (height === "peek") return 0.6;
  if (height === "default") return 0.78;
  if (height === "tall") return 0.88;
  return Math.min(100, Math.max(10, height)) / 100;
}

function resolveSnap(height: BottomSheetHeight): string {
  return `${resolveFraction(height) * 100}%`;
}

/** Accent as a Tamagui token — for the eyebrow <Text> (resolves the theme). */
function accentToken(accent?: BottomSheetAccent): string {
  if (!accent) return "$text3";
  return toneTokens(accent).base;
}

/** Accent as a concrete colour — for the gorhom drag-handle (plain RN, no
 * Tamagui token resolution). */
function accentHex(accent?: BottomSheetAccent): string {
  if (!accent) return "rgba(255,255,255,0.16)";
  return toneHex(accent).base;
}

export function BottomSheet({
  visible,
  onClose,
  title,
  eyebrow,
  accent,
  height = "default",
  children,
  footer,
  testID,
}: BottomSheetProps) {
  const ref = useRef<GorhomBottomSheet>(null);
  const snapPoints = useMemo(() => [resolveSnap(height)], [height]);
  // Reduce-motion (spec-12.2 AC 3.3): snap the sheet open/closed instead of
  // sliding. gorhom drives the mount + expand/close transitions through
  // `animationConfigs`; a zero-duration timing config makes them instant while
  // leaving the slide default untouched when reduce-motion is off.
  const gate = useReducedMotionGate();
  const animationConfigs = useMemo(
    () => (gate.sheetAnimation === "snap" ? { duration: 0 } : undefined),
    [gate.sheetAnimation],
  );
  // Read the inset context directly (rather than useSafeAreaInsets, which
  // throws without a provider) so the sheet still renders in tests / any tree
  // mounted outside a SafeAreaProvider — falls back to 0.
  const bottomInset = useContext(SafeAreaInsetsContext)?.bottom ?? 0;

  // The sheet body needs an EXPLICIT height. `flex: 1` here does not work:
  // gorhom's content view (`BottomSheetContent`) applies its height through an
  // animated style that returns `{}` until the container has been measured, so
  // there are frames — and, for this drawer, the steady state — where this
  // column has no definite height to divide up. A `flex: 1` child of an
  // unsized column sizes to its CONTENT, which means the inner
  // BottomSheetScrollView's viewport equals its content: nothing overflows, so
  // nothing scrolls. The body then simply overflowed the sheet and got clipped
  // by `overflow: "hidden"` below, which LOOKS exactly like a scroll boundary —
  // which is why this kept being misread as a gesture/lock bug and "fixed" at
  // the gesture layer. Verified on an iPhone 17 Pro simulator: with `flex: 1`
  // the drawer will not scroll even with a plain RN ScrollView and no gorhom
  // gesture wiring at all; with the explicit height it scrolls to Sign out and
  // Delete account. Derived from the same fraction that builds the snap point,
  // so the two cannot drift.
  const windowHeight = useWindowDimensions().height;
  const sheetBodyHeight =
    windowHeight * resolveFraction(height) - HANDLE_HEIGHT;

  // Render the sheet once it has been opened at least once, then keep it
  // mounted so a parent-driven close (`setVisible(false)`) animates DOWN via
  // `ref.current.close()` instead of unmounting synchronously (which would
  // null the ref before the close call and snap the sheet shut). gorhom holds
  // the closed sheet at `index = -1`; `onAnimate` clears `mounted` only after
  // the close settles, dropping the machinery from the tree (PR #83 review).
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      ref.current?.expand();
    } else {
      ref.current?.close();
    }
  }, [visible]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior="close"
        opacity={0.6}
      />
    ),
    [],
  );

  // Once the close animation settles on the closed index (-1), drop the sheet
  // from the tree to keep it light. gorhom fires onAnimate(from, to) at the
  // start of the transition; we wait for the change handler below.
  const handleChange = useCallback(
    (index: number) => {
      if (index === -1 && !visible) {
        setMounted(false);
      }
    },
    [visible],
  );

  // Never been opened → render nothing (no flash, light tree).
  if (!mounted) {
    return null;
  }

  return (
    <GorhomBottomSheet
      ref={ref}
      index={visible ? 0 : -1}
      onChange={handleChange}
      snapPoints={snapPoints}
      animationConfigs={animationConfigs}
      // gorhom v5 defaults `enableDynamicSizing: true`, which sizes the sheet to
      // its CONTENT height and overrides `snapPoints`. With a long body (e.g. the
      // Create-Exercise form) that pushes the sheet to ~full screen instead of the
      // intended 88%/78%/60%. This component always has an explicit snap point, so
      // dynamic sizing is never wanted — disable it to honour `height` exactly.
      enableDynamicSizing={false}
      enablePanDownToClose
      // Keyboard handling (device-QA #5): without these, gorhom's default
      // keyboard behaviour fights the inner BottomSheetScrollView on
      // form-heavy sheets (worst case: the Fuel Targets calculator) — the
      // content stops scrolling reliably once the keyboard is up on-device.
      // `interactive` keeps the sheet pinned above the keyboard + lets the
      // scroll track the keyboard; `restore` returns to the snap point on
      // dismiss; Android needs `adjustResize` so the window (not just the
      // sheet) reflows. CI mocks gorhom, so this is device-verified.
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      onClose={onClose}
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={{
        backgroundColor: accentHex(accent),
        width: 40,
        height: 4,
      }}
      backgroundStyle={{ backgroundColor: "#12141D" }}
      style={{
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        overflow: "hidden",
      }}
    >
      <View
        // `height` + `flexShrink`, and BOTH halves are load-bearing.
        //
        // `height` supplies a DEFINITE flex basis. That is the whole fix: gorhom
        // applies its content height through an animated style that returns `{}`
        // until the container is measured, so in those frames the parent column
        // has no definite height. A `flex: 1` child (basis `0%`) collapses to its
        // content there, which makes the inner scroll view's viewport equal its
        // content — nothing overflows, so nothing scrolls, and the body just
        // overflows the sheet and is clipped by `overflow: "hidden"` above.
        // `maxHeight` fails for the same reason: no basis to resolve against, so
        // it collapsed the body to nothing on device. Don't retry either.
        //
        // `flexShrink` lets the body give that height BACK, clamping to the box
        // gorhom actually computed (`animatedContentHeightMax`) whenever that is
        // smaller than our estimate. Two real cases need it, both found by
        // Inspector Brad:
        //   1. `windowHeight` is the wrong ruler for a sheet that is NOT mounted
        //      at the root. gorhom measures its PARENT, so the three Home
        //      quick-log sheets (Weigh-in, Water, Sleep — mounted inside
        //      HomeContainer, i.e. inside the tab scene) sit in a container
        //      ~102pt shorter than the window. Without shrink the body overshoots
        //      by ~90pt (`tall`) / ~61pt (`peek`) and that band is unreachable —
        //      on Weigh-in it contains the Save button.
        //   2. `keyboardBehavior="interactive"` shrinks that box further while
        //      the keyboard is up.
        // RN's default `flexShrink` is 0, which is exactly why neither case
        // worked before. Shrink keeps the basis, so it cannot reintroduce the
        // collapse — it only adds a ceiling, and demotes HANDLE_HEIGHT to a
        // fallback rather than a load-bearing constant.
        height={sheetBodyHeight}
        flexShrink={1}
        testID={testID}
        // Plain in-flow flex container — NOT gorhom's <BottomSheetView>, whose
        // base style is position:absolute (top/left/right, no height) and thus
        // overrides flex:1, sizing the node to its content. That left the inner
        // BottomSheetScrollView with no bounded viewport, so it never scrolled
        // and tall bodies (e.g. the coach ProfileDrawer) were clipped — the
        // Sign-out button unreachable. NOTE: an earlier version of this comment
        // concluded that "a flex:1 View fills the box" — it does NOT, and that
        // claim is what produced two failed fixes at the gesture layer. See the
        // basis/shrink note above; the height must be explicit.
        // a11y: mark the open sheet as a modal so VoiceOver/TalkBack traps focus
        // INSIDE it and ignores the screen behind the backdrop.
        accessibilityViewIsModal
        importantForAccessibility="yes"
      >
        {title || eyebrow ? (
          <View
            paddingHorizontal={20}
            paddingTop={4}
            paddingBottom={12}
            borderBottomWidth={1}
            borderColor="$border"
          >
            {eyebrow ? (
              <Text
                fontFamily="$display"
                fontSize={10.5}
                fontWeight="600"
                letterSpacing={1.7}
                textTransform="uppercase"
                color={accentToken(accent)}
                marginBottom={4}
              >
                {eyebrow}
              </Text>
            ) : null}
            {title ? (
              <Text
                fontFamily="$display"
                fontWeight="700"
                fontSize={20}
                letterSpacing={-0.4}
                color="$text"
                // a11y: announce the sheet title as a heading so screen-reader
                // users get the sheet's purpose on focus + can navigate by header.
                accessibilityRole="header"
              >
                {title}
              </Text>
            ) : null}
          </View>
        ) : null}

        <BottomSheetScrollView
          // `flex: 1` bounds the scroll view to the space below the fixed
          // header (the sheet is a fixed-height flex column now that dynamic
          // sizing is off). Without it the scroll view grows to its content
          // height and overflows — clipped by the sheet's `overflow: hidden`,
          // so the body looked cut off and unscrollable.
          style={{ flex: 1 }}
          // Add the bottom safe-area inset so the last row (e.g. the drawer's
          // Sign out) clears the home indicator instead of sitting under it —
          // when the body is ~sheet-height it otherwise looks cut off and
          // there's nothing to scroll to. The extra height also lets the
          // scroll view engage when the content is borderline.
          //
          // With a `footer`, that inset moves to the footer instead: the footer
          // is what now sits against the home indicator, and paying the inset
          // twice would leave a dead band of scroll above it.
          contentContainerStyle={{
            padding: 20,
            paddingBottom: footer ? 24 : 40 + bottomInset,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </BottomSheetScrollView>

        {footer ? (
          <View
            paddingHorizontal={20}
            paddingTop={12}
            paddingBottom={12 + bottomInset}
            borderTopWidth={1}
            borderColor="$border"
            backgroundColor="$surface"
            testID="bottom-sheet-footer"
          >
            {footer}
          </View>
        ) : null}
      </View>
    </GorhomBottomSheet>
  );
}
