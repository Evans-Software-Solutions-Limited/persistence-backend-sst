import { Text, View } from "@tamagui/core";
import { useCallback, useEffect, useRef } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  type LayoutChangeEvent,
} from "react-native";

import { toneTokens } from "./tones";

/**
 * <Segmented> — top-level switcher used inside hubs (Train: Workouts |
 * Exercises). Ports ~/Downloads/handoff/design-source/tab-bar.jsx:88-115.
 * Implements 01-design-system/design.md § Foundation primitives #9 +
 * STORY-003 AC 3.7 + locked decision #9 (2-5 options).
 *
 * Content-width inline segments (each hugs its label, per the prototype's
 * `inline-flex` track — the control does NOT stretch full-width), $surface2
 * track left-aligned, active segment $surface4 fill + accent-dim shadow ring.
 * The track ALWAYS scrolls horizontally rather than truncating labels — see the
 * warning below for why there is no option-count or viewport gate on that.
 *
 * ⚠ **The scroll is UNCONDITIONAL** (changed 2026-08-02, when the Train hub gained
 * a fourth `Gyms` segment). It used to be gated twice, and both gates were the same
 * mistake: `width < 360` left every phone between 360pt and the track's real
 * content width clipping instead of scrolling, and `options.length >= 4` left the
 * 3-option sets clipping at large Dynamic Type — a ~256pt track at AX sizes
 * overflows a 375pt device several times over, and the trailing segment becomes
 * untappable with no scroll path. The Train hub's no-coach set went from 2 options
 * to 3 in that same change, which is what made `Gyms` the segment that vanished.
 *
 * Both were guesses about text metrics — font, locale, Dynamic Type — which is
 * exactly what a constant cannot know. Being unconditional costs nothing: a
 * horizontal `ScrollView` whose content is narrower than its viewport does not
 * scroll, and `flexGrow: 0` plus the track's `alignSelf: flex-start` keep it
 * hugging its content, so a fitting control is pixel-identical to the bare track.
 *
 * ⚠ **This changes the render path for EVERY consumer**, so it is not confined to
 * the Train hub. `MealPickerPresenter` (the four `MEAL_SLOTS`, inside
 * `QuickAddSheetPresenter` / `ScanBarcodeSheetPresenter` / `AiDraftConfirmPresenter`)
 * was already a 4-option consumer, and the 2- and 3-option consumers now take the
 * scrolling path too. Device-checked at 402pt: the Train hub's 3-option track and
 * the Fuel quick-add sheet's 4-option meal picker both render and switch
 * identically. Re-check them if this component's layout is touched again.
 *
 * ⚠ **The active option is scrolled into view on mount and on change.** Without
 * it the track always started at offset 0, so a persisted last-position segment
 * (the Train hub writes `persistence.train.segment` to disk) could cold-launch
 * with its body rendered and its pill off-screen — a switcher showing nothing
 * selected. That is reachable exactly where the width gate used to be wrong:
 * narrow devices, large Dynamic Type, longer locales.
 *
 * Two things make that work, and a first attempt at it did neither:
 *
 * - **The MOUNT scroll is driven from `onLayout`, not from an effect.** Offsets
 *   live in a ref (writing them must not re-render), so an effect running after
 *   the first commit reads an EMPTY map, returns early, and never re-runs — the
 *   cold-launch case stayed broken. The active segment's own layout callback is
 *   the first moment its x is known, so that is where the initial scroll belongs.
 *   It is one-shot (`didInitialScrollRef`) so later re-layouts cannot yank a
 *   track the user is mid-drag on.
 * - **Offsets are dropped when the option SET changes.** Otherwise the Train hub's
 *   own coach gate corrupts it: while `useClientRelationships` is loading a
 *   non-Training segment renders 3 options, then resolving to coached swaps in a
 *   4th — at which point every offset has moved and the effect would scroll to the
 *   3-option one, short by a whole segment. Keying on the joined values means a
 *   membership change re-measures instead of trusting the old track.
 */

export type SegmentedOption = string | { value: string; label: string };
export type SegmentedAccent = "primary" | "gold" | "trainer";
export type SegmentedSize = "sm" | "md";

export type SegmentedProps = {
  /** 2-5 options. */
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  accent?: SegmentedAccent;
  size?: SegmentedSize;
  /**
   * Stretch the track to fill its row, splitting the width evenly between
   * segments, instead of the default content-width left-hugging strip. Opt-in
   * so existing consumers (Train hub, meal picker) are byte-identical — only
   * set where the design calls for a full-width control (Mealprint sheets). The
   * horizontal ScrollView is retained for keyboard-tap safety; at full width it
   * simply never has overflow to scroll. Long labels truncate (`numberOfLines`)
   * rather than scroll in this mode, which the full-width design accepts.
   */
  full?: boolean;
  testID?: string;
};

const SIZE_SPEC: Record<
  SegmentedSize,
  { height: number; padding: number; fontSize: number }
> = {
  sm: { height: 32, padding: 3, fontSize: 12 },
  md: { height: 38, padding: 4, fontSize: 13 },
};

function optionValue(o: SegmentedOption): string {
  return typeof o === "string" ? o : o.value;
}
function optionLabel(o: SegmentedOption): string {
  return typeof o === "string" ? o : o.label;
}

export function Segmented({
  options,
  value,
  onChange,
  accent = "primary",
  size = "md",
  full = false,
  testID,
}: SegmentedProps) {
  const spec = SIZE_SPEC[size];
  const accentDim = toneTokens(accent).dim;

  /**
   * Scroll the active option into view. `onLayout` on each segment is the only
   * source of its x-offset — the labels are text, so nothing here knows a
   * segment's width until it has been measured. See the docblock for why the
   * mount case cannot be an effect and why the map is keyed to the option set.
   */
  const scrollRef = useRef<ScrollView | null>(null);
  const offsetsRef = useRef<Map<string, number>>(new Map());
  const didInitialScrollRef = useRef(false);
  /** Read inside `onSegmentLayout` without making the callback re-identify. */
  const valueRef = useRef(value);
  valueRef.current = value;

  // A little lead-in so the active pill is not flush against the edge, and never
  // negative — `scrollTo` clamps, but a negative offset reads as a bug.
  const scrollToOffset = (x: number, animated: boolean) => {
    scrollRef.current?.scrollTo({ x: Math.max(0, x - 12), animated });
  };

  // Identity of the option SET, not the array — a parent re-rendering with a
  // fresh array of the same values must not count as a change.
  const optionsKey = options.map(optionValue).join("\u0000");
  const lastOptionsKeyRef = useRef(optionsKey);
  if (lastOptionsKeyRef.current !== optionsKey) {
    lastOptionsKeyRef.current = optionsKey;
    offsetsRef.current.clear();
    didInitialScrollRef.current = false;
  }

  const onSegmentLayout = useCallback((v: string, e: LayoutChangeEvent) => {
    const { x } = e.nativeEvent.layout;
    offsetsRef.current.set(v, x);
    // The first measurement of the ACTIVE option is the earliest point a mount
    // (or a post-membership-change re-measure) can be positioned. Not animated:
    // this is where the track should have started, not a move the user made.
    if (didInitialScrollRef.current || v !== valueRef.current) return;
    didInitialScrollRef.current = true;
    scrollToOffset(x, false);
  }, []);

  // Subsequent changes of `value` — a tap, or a store write from elsewhere.
  const previousValueRef = useRef(value);
  useEffect(() => {
    if (previousValueRef.current === value) return;
    previousValueRef.current = value;
    const x = offsetsRef.current.get(value);
    if (x === undefined) {
      // Never measured — or measured and then cleared by an option-set change.
      // ⚠ Re-arm the one-shot rather than swallowing this: `previousValueRef` has
      // already consumed the change, so without it neither path would ever fire
      // again and the track would be silently stuck for good. (Not reachable via
      // `TrainHubContainer`, which adds/removes a LEADING option so everything
      // re-measures — but it is a trap for the next consumer that changes a
      // trailing one.)
      didInitialScrollRef.current = false;
      return;
    }
    scrollToOffset(x, true);
  }, [value]);

  const segments = options.map((o) => {
    const v = optionValue(o);
    const label = optionLabel(o);
    const isActive = value === v;
    return (
      <Pressable
        key={v}
        testID={testID ? `${testID}-option-${v}` : undefined}
        onPress={() => onChange(v)}
        accessibilityRole="tab"
        accessibilityState={{ selected: isActive }}
        accessibilityLabel={label}
        onLayout={(e) => onSegmentLayout(v, e)}
        style={{
          minHeight: spec.height - spec.padding * 2,
          // Full-width: each segment takes an equal share of the track.
          flex: full ? 1 : undefined,
        }}
      >
        <View
          height={spec.height - spec.padding * 2}
          paddingHorizontal={14}
          borderRadius={9}
          alignItems="center"
          justifyContent="center"
          backgroundColor={isActive ? "$surface4" : "transparent"}
          borderColor={isActive ? accentDim : "transparent"}
          borderWidth={1}
        >
          <Text
            fontFamily="$display"
            fontWeight="600"
            fontSize={spec.fontSize}
            numberOfLines={1}
            color={isActive ? "$text" : "$text3"}
          >
            {label}
          </Text>
        </View>
      </Pressable>
    );
  });

  const track = (
    <View
      testID={testID}
      accessibilityRole="tablist"
      flexDirection="row"
      alignItems="center"
      // Full-width fills the (flexGrow:1) content container; default hugs its
      // content on the left as before.
      alignSelf={full ? "stretch" : "flex-start"}
      flexGrow={full ? 1 : 0}
      gap={2}
      padding={spec.padding}
      borderRadius={12}
      backgroundColor="$surface2"
      borderColor="$border"
      borderWidth={1}
    >
      {segments}
    </View>
  );

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      // ⚠ REQUIRED now that the wrapper is unconditional. RN's
      // `scrollResponderHandleStartShouldSetResponderCapture` captures — and
      // eats — the touch when a soft keyboard is open, the target is not a
      // TextInput, and this is unset or "never". Without it the FIRST tap on any
      // segment in the app is swallowed whenever a field is focused: the
      // gym-name editor behind the Train hub switcher, the coach search fields
      // above Archive/Drafts, the food search above the meal picker.
      //
      // The prop does NOT inherit — each ScrollView needs its own — and capture
      // runs ROOT-FIRST (`traverseTwoPhase` walks the path downwards and takes
      // the first `true`), so an ancestor scroller that leaves it unset would
      // still win over this one. Every ancestor in play today already sets it.
      //
      // "handled" rather than "always": both stop the capture, but only
      // `true`/"always" also suppress the blur in `_handleResponderRelease`, so
      // "always" would break dismissing the keyboard by tapping the strip's dead
      // space. Invisible to the suite either way — `fireEvent.press` hits the
      // Pressable directly and never enters the responder system.
      keyboardShouldPersistTaps="handled"
      // `flexGrow: 0` on both so the wrapper cannot claim free space in a flex
      // parent — without it a fitting control would no longer be pixel-identical
      // to the bare track it replaced, which is the whole premise above.
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      testID={testID ? `${testID}-scroll` : undefined}
    >
      {track}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  scrollContent: { flexGrow: 0 },
});
