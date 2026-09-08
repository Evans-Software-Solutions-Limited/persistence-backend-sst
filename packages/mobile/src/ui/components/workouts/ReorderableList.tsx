import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Dimensions, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  scrollTo,
  useAnimatedReaction,
  useSharedValue,
} from "react-native-reanimated";
import {
  Gesture,
  GestureDetector,
  ScrollView as GestureScrollView,
} from "react-native-gesture-handler";
import { scheduleOnRN } from "react-native-worklets";
import * as Haptics from "expo-haptics";
import {
  DropProvider,
  useSortable,
  useSortableList,
} from "react-native-reanimated-dnd";

/**
 * The app's drag-to-reorder list. The active session, the workout editor and
 * the workout creator all reorder through this; nothing else may talk to
 * `react-native-reanimated-dnd` directly.
 *
 * ── The interaction ─────────────────────────────────────────────────────────
 * ONE gesture. Hold the grip: the rows collapse to uniform compact rows so the
 * list can be seen at a glance, and the SAME finger then drags. Release to
 * commit; the rows expand again. No button in, no button out, no second hold.
 *
 * The collapse fires from a long press of its own at
 * `COLLAPSE_LONG_PRESS_MS`, deliberately SHORTER than the drag's own
 * `activateAfterLongPress(200)`, and composed `Gesture.Simultaneous` with it
 * so neither cancels the other. That ordering is the whole trick: the library
 * takes its measurements when the pan activates, so the geometry has to be
 * settled BEFORE that. Collapsing after the drag had started is what made
 * every earlier attempt drift — the drag was anchored to heights that no
 * longer existed. And because compact rows are a known uniform height, the new
 * geometry is published synchronously, with no layout round-trip to lose.
 *
 * ── Why this drives `useSortable` directly ──────────────────────────────────
 * Not `SortableItem`, for two reasons:
 *  1. **The touch target must outlive the collapse.** A touch is delivered to
 *     the view the finger went down on, so a target inside the body would
 *     unmount when the body swaps and take the gesture with it. This component
 *     puts an INVISIBLE target over the row's top-left corner — where every
 *     one of these layouts draws its grip — and swaps only the body beneath
 *     it. The cards keep drawing their own grip, and keep its accessibility.
 *  2. **`SortableItem` owns the gesture and the measuring.** Its own
 *     `onLayout` measurement proved unreliable — on some mounts it simply
 *     never fired, leaving every row at the estimate (rows overlapping in the
 *     session, ~50pt of dead space in the editor). Heights are measured here
 *     instead and handed to the hook as a resolver, which is also what lets
 *     compact mode publish its heights up front.
 *
 * ── The rest, all learned the hard way ──────────────────────────────────────
 * - **This list is the screen's only scroller.** Never nest it in another
 *   ScrollView. Surrounding content goes in `header`/`footer`, which scroll
 *   with the rows.
 * - **Content above the rows is compensated for, not forbidden.** The library
 *   works in a row space whose origin is the first row, while the scroll
 *   offset it compares against is the scroller's own. Anything above the rows
 *   — a header, the content style's padding — makes those differ, which used
 *   to take the auto-scroll edges with it. The rows' wrapper measures its own
 *   offset and the scroll offset handed to the rows is shifted by it.
 * - **Gesture Handler's ScrollView, wrapped for Reanimated**, with
 *   `simultaneousHandlers` — the composition the library's own `Sortable`
 *   uses. A vertical pan inside a vertical scroller is genuinely contended.
 */
const AnimatedScrollView = Animated.createAnimatedComponent(GestureScrollView);

/** Shorter than the drag's own 200ms, so the collapse lands first. */
const COLLAPSE_LONG_PRESS_MS = 90;

/**
 * The scroll offset in the row space the library works in — and FLOORED AT 0.
 *
 * The floor is not tidiness. The library's up-edge target is the constant `0`,
 * an absolute scroll-space value: from a negative row-space offset (which is
 * what any visible header produces) `withTiming(0)` animates the wrong way,
 * scrolling the header off and adding its height to the dragged row's
 * position. In the session that fired on almost every drag of the top rows; in
 * the editor, whose header is the whole form, it was worth two compact slots.
 * Flooring costs a little reach at the DOWN edge while the header is on
 * screen, which is the direction that merely feels stiff instead of committing
 * the wrong order.
 */
function toRowSpace(scrollOffset: number, rowsOffset: number) {
  "worklet";
  return Math.max(0, scrollOffset - rowsOffset);
}

/** Module scope so its identity never changes between renders. */
const itemId = (item: ReorderableItem) => item.id;

export type ReorderableItem = { id: string };

export type ReorderableRenderProps = {
  index: number;
  /** True while the list is collapsed for a drag. */
  isCompact: boolean;
};

export type ReorderableListProps<TItem extends ReorderableItem> = {
  data: TItem[];
  /**
   * Seed height for a row, used only until it has been measured. Rows are NOT
   * required to be this tall, or to match each other.
   */
  estimatedItemHeight: number;
  /** Uniform height of a compact row, including its spacing. */
  compactItemHeight: number;
  /**
   * The row's body — the real card, or the compact row while `isCompact`. Draw
   * the grip wherever it belongs in that layout; this component puts an
   * invisible touch target over the row's top-left corner and wires the
   * gestures to it.
   */
  renderItem: (item: TItem, props: ReorderableRenderProps) => ReactNode;
  /**
   * Fired once on drop with the item that moved, its new index, and the whole
   * committed order. Derived from the library's `onDrop` — its `onMove` fires
   * per DISPLACED row mid-drag and is not a commit hook; treating it as one
   * corrupts the order.
   */
  onReorder: (movedId: string, toIndex: number, orderedIds: string[]) => void;
  /** Scrolls with the rows. Its height is compensated for; see above. */
  header?: ReactNode;
  footer?: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Forwarded to the scroller. The session logs sets into it. */
  keyboardDismissMode?: "none" | "on-drag" | "interactive";
  automaticallyAdjustKeyboardInsets?: boolean;
  testID?: string;
};

/**
 * `positions` inside `useSortableList` is seeded from the data order ONCE, so
 * the hook must remount when the id *set* changes (a row added or removed).
 * A plain reorder must NOT remount it — the list would lose its scroll offset
 * after every drop — and does not need to: the inner component re-seeds
 * `positions` in place when the order changes underneath it.
 */
export function ReorderableList<TItem extends ReorderableItem>(
  props: ReorderableListProps<TItem>,
) {
  const identityKey = useMemo(
    () =>
      props.data
        .map((item) => item.id)
        .sort()
        .join("|"),
    [props.data],
  );
  return <ReorderableListInner key={identityKey} {...props} />;
}

function ReorderableListInner<TItem extends ReorderableItem>({
  data,
  estimatedItemHeight,
  compactItemHeight,
  renderItem,
  onReorder,
  header,
  footer,
  style,
  contentContainerStyle,
  keyboardDismissMode,
  automaticallyAdjustKeyboardInsets,
  testID,
}: ReorderableListProps<TItem>) {
  /**
   * The auto-scroll window, taken from the WINDOW at mount — deliberately not
   * measured.
   *
   * `useSortable` freezes this on its first render
   * (`useRef(containerHeight).current`) and derives the auto-scroll edge from
   * it as `lowerBound + containerHeight`. It must therefore be right on that
   * first render, and measuring it is what made everything worse: the rows had
   * to be keyed on the measurement so they could re-freeze, and that remount
   * is fatal. The library computes a row's resting top ONCE, as
   * `index × estimatedItemHeight`, and only corrects it when the measured
   * heights CHANGE afterwards — so a remount that happens after the heights
   * are known strands every row at the estimate (rows overlapping in the
   * session, ~50pt of dead space between editor cards). No remount, no
   * stranding.
   *
   * The cost is that the window is the SCREEN rather than this scroller, so
   * it over-estimates by whatever chrome sits outside it (~60pt here). That
   * makes the auto-scroll trigger slightly harder to reach and `maxScroll`
   * slightly generous, which `scrollTo` clamps. Both are far cheaper than a
   * list whose rows are laid out at a guess. NEVER 0: 0 is not `undefined`, so
   * the library's own 500 default would not apply, and a 0 window makes the
   * scroll-down test unconditionally true — every drag then runs to the end
   * and commits at the LAST index.
   */
  const windowHeight = useRef(Dimensions.get("window").height).current;

  /**
   * The rows' own offset inside the scroll content — the row space ↔ scroll
   * space difference. Measured from the wrapper's layout rather than computed
   * from the header, so content-container padding counts too.
   */
  const [rowsOffset, setRowsOffset] = useState(0);
  /**
   * A layout that lands DURING a drag, held until the drag ends.
   *
   * `onLayout` only fires again when the layout actually changes, so simply
   * discarding one — a trainer banner mounting, the cardio meta block
   * appearing — left `rowsOffset` wrong for every later drag, and the whole
   * auto-scroll window with it.
   */
  const deferredRowsOffset = useRef<number | null>(null);
  /** Measured row heights, by id. Ours, not the library's. */
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [isCompact, setIsCompact] = useState(false);

  const isDraggingRef = useRef(false);
  const dataRef = useRef(data);
  dataRef.current = data;

  const measureRow = useCallback((id: string, height: number) => {
    const rounded = Math.round(height);
    if (rounded <= 0) return;
    setHeights((previous) =>
      Math.abs((previous[id] ?? 0) - rounded) < 1
        ? previous
        : { ...previous, [id]: rounded },
    );
  }, []);

  /**
   * The height resolver handed to the hook.
   *
   * Compact rows report their uniform height immediately — no measurement, so
   * the drag that is about to activate already has the right geometry. Full
   * rows report what they measured, falling back to the estimate for the frame
   * before that lands.
   */
  const resolveHeight = useCallback(
    (item: TItem) =>
      isCompact ? compactItemHeight : (heights[item.id] ?? estimatedItemHeight),
    [isCompact, compactItemHeight, heights, estimatedItemHeight],
  );

  const {
    positions,
    scrollY,
    scrollViewRef,
    dropProviderRef,
    handleScroll,
    handleScrollEnd,
    contentHeight,
    getItemProps,
  } = useSortableList<TItem>({
    data,
    itemHeight: resolveHeight,
    estimatedItemHeight,
    // Stable identity on purpose: the hook defaults this to a fresh arrow on
    // every call and then lists it in its geometry effect's deps, so leaving
    // it out re-runs that effect on every render.
    itemKeyExtractor: itemId,
  });

  /**
   * Re-seed the library's position map from the rendered order.
   *
   * It is seeded once at mount, so any reorder arriving from OUTSIDE a drag —
   * a VoiceOver "Move down", a coach editing elsewhere — left the map
   * disagreeing with what is on screen, and the next drop committed against
   * the stale one. Never while dragging: the map IS the drag's state then.
   */
  const orderKey = data.map((item) => item.id).join("|");
  useEffect(() => {
    if (isDraggingRef.current) return;
    const seeded: Record<string, number> = {};
    dataRef.current.forEach((item, index) => {
      seeded[item.id] = index;
    });
    positions.value = seeded;
  }, [orderKey, positions]);

  /**
   * Row space starts at the first row; the scroll offset the library compares
   * it against starts at the top of the content. Hand the rows a shifted
   * offset so both edges of the auto-scroll window, and `maxScroll`, land
   * where they actually are on screen.
   */
  const rowSpaceOffset = useSharedValue(0);
  const isDraggingSV = useSharedValue(false);
  const rowsOffsetSV = useSharedValue(0);
  rowsOffsetSV.value = rowsOffset;

  /**
   * Seed the shift, and re-seed it when the offset is measured. Doing this
   * only from the scroll reaction below was a real bug: at rest the list sits
   * at offset 0, `scrollY` never changes, the reaction never fires, and the
   * rows compare against an unshifted window. Since what the library compares
   * is the dragged row's TOP, that put the auto-scroll trigger about a
   * header's height below where a finger can reach.
   */
  useEffect(() => {
    if (isDraggingRef.current) return;
    rowSpaceOffset.value = toRowSpace(scrollY.value, rowsOffset);
  }, [rowsOffset, rowSpaceOffset, scrollY]);

  useAnimatedReaction(
    () => scrollY.value,
    (offset) => {
      // Not while dragging: the row animates this value itself (the library
      // drives auto-scroll by writing to the offset it was given), and
      // assigning over a running `withTiming` cancels it — auto-scroll would
      // stall after a single frame.
      if (isDraggingSV.value) return;
      rowSpaceOffset.value = toRowSpace(offset, rowsOffsetSV.value);
    },
  );

  useAnimatedReaction(
    () => rowSpaceOffset.value,
    (offset) => {
      if (!isDraggingSV.value) return;
      scrollTo(scrollViewRef, 0, offset + rowsOffsetSV.value, false);
    },
  );

  /**
   * Clamped to the COMPACT content, not the full content.
   *
   * The library computes `maxScroll = <current content> - containerHeight`
   * with no floor, and it does that at DRAG time — by which point the rows are
   * compact, so the content is `n × compactItemHeight`. Clamping against the
   * full-height content (which is all that exists at the row's first render,
   * the only one that counts, since `useSortable` freezes this in a ref) left
   * `maxScroll` NEGATIVE for any list under about ten rows: dragging the last
   * row toward the bottom then animated the offset to a negative target, which
   * both shoved the scroller off its own top and subtracted that distance from
   * the dragged row's position — committing it several slots above where it
   * was dropped.
   *
   * NEVER 0: 0 is not `undefined`, so the library's own 500 default would not
   * apply, and a 0 window makes the scroll-down test unconditionally true —
   * every drag then runs to the end and commits at the LAST index.
   */
  const containerHeight = Math.min(
    windowHeight,
    Math.max(data.length * compactItemHeight, 1),
  );

  const handleDrop = useCallback(
    (id: string, position: number, allPositions?: Record<string, number>) => {
      // Gesture Handler calls `onFinalize` for FAILED and CANCELLED as well as
      // END, and the library forwards all of them here — so this also fires
      // for a pan that never activated.
      const wasDragging = isDraggingRef.current;
      isDraggingRef.current = false;
      isDraggingSV.value = false;
      setIsCompact(false);
      // The library animated the offset wherever its 1500ms auto-scroll got
      // to, and the scroll reaction only re-syncs when `scrollY` next CHANGES
      // — which never happens if the platform clamped that scroll. Put it back
      // explicitly, and take any layout the drag made us hold.
      if (deferredRowsOffset.current !== null) {
        setRowsOffset(deferredRowsOffset.current);
        deferredRowsOffset.current = null;
      }
      rowSpaceOffset.value = toRowSpace(scrollY.value, rowsOffsetSV.value);
      if (!wasDragging || !allPositions) return;
      const from = dataRef.current.findIndex((item) => item.id === id);
      if (from === position) return;
      const ordered = [...dataRef.current]
        .sort((a, b) => (allPositions[a.id] ?? 0) - (allPositions[b.id] ?? 0))
        .map((item) => item.id);
      onReorder(id, position, ordered);
    },
    [onReorder, isDraggingSV, rowSpaceOffset, rowsOffsetSV, scrollY],
  );

  const handleDragStart = useCallback(() => {
    isDraggingRef.current = true;
    isDraggingSV.value = true;
  }, [isDraggingSV]);

  /** Fired by the collapse long press, BEFORE the drag activates. */
  const handleCollapse = useCallback(() => {
    setIsCompact(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

  /**
   * A press that collapsed the list but never became a drag has to put it
   * back, or a tap on the grip would leave the list compact with nothing to
   * undo it. The library's `onDrop` covers a pan that activated; this covers
   * one that never did.
   */
  const handleCollapseEnd = useCallback(() => {
    if (isDraggingRef.current) return;
    setIsCompact(false);
  }, []);

  return (
    <DropProvider ref={dropProviderRef}>
      <AnimatedScrollView
        ref={scrollViewRef}
        testID={testID}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        onScrollEndDrag={handleScrollEnd}
        onMomentumScrollEnd={handleScrollEnd}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={keyboardDismissMode}
        automaticallyAdjustKeyboardInsets={automaticallyAdjustKeyboardInsets}
        style={[{ flex: 1 }, style]}
        contentContainerStyle={contentContainerStyle}
        simultaneousHandlers={dropProviderRef}
        scrollEnabled={!isCompact}
      >
        {header}

        {/*
          NOT keyed on anything measured. A remount here re-runs each row's
          one-shot resting-top calculation against heights that are already
          known, which strands every row at the estimate — see the note on
          `windowHeight`.
        */}
        <View
          style={{ height: contentHeight }}
          onLayout={(event) => {
            // `y` is relative to the scroll content, so this is exactly the
            // offset the rows sit at — header, padding and all.
            const measured = Math.round(event.nativeEvent.layout.y);
            if (isDraggingRef.current) {
              deferredRowsOffset.current = measured;
              return;
            }
            setRowsOffset(measured);
          }}
        >
          {data.map((item, index) => (
            <ReorderableRow
              key={item.id}
              item={item}
              index={index}
              itemProps={getItemProps(item, index)}
              rowSpaceOffset={rowSpaceOffset}
              containerHeight={containerHeight}
              compactItemHeight={compactItemHeight}
              isCompact={isCompact}
              // Nothing to reorder, so no target. The cards draw no grip in
              // that case either (`ExerciseReorderHandle` renders null), and
              // an invisible target with no grip under it is worse than
              // useless: RN hit-tests the topmost view and walks up its
              // ANCESTORS, so it swallows touches meant for the card beneath
              // — the top of the editor's Sets stepper, a strip of the
              // session card's "open details" row.
              draggable={data.length > 1}
              onMeasure={measureRow}
              onDrop={handleDrop}
              onDragStart={handleDragStart}
              onCollapse={handleCollapse}
              onCollapseEnd={handleCollapseEnd}
              renderItem={renderItem}
            />
          ))}
        </View>

        {footer}
      </AnimatedScrollView>
    </DropProvider>
  );
}

type ItemProps = ReturnType<
  ReturnType<typeof useSortableList<ReorderableItem>>["getItemProps"]
>;

/**
 * The invisible drag target, over the row's top-left corner.
 *
 * Deliberately generous (56×56): it has to cover wherever the body beneath it
 * draws its grip — the session card's, the editor card's and the compact
 * row's all sit inside this corner — and a target that misses the grip is a
 * grip that does not drag. It stops short of the row number and the name, and
 * the destructive controls are all on the right.
 */
const GRIP_TARGET = {
  position: "absolute" as const,
  left: 0,
  top: 0,
  width: 56,
  height: 56,
  zIndex: 2,
};

function ReorderableRow<TItem extends ReorderableItem>({
  item,
  index,
  itemProps,
  rowSpaceOffset,
  containerHeight,
  compactItemHeight,
  isCompact,
  draggable,
  onMeasure,
  onDrop,
  onDragStart,
  onCollapse,
  onCollapseEnd,
  renderItem,
}: {
  item: TItem;
  index: number;
  itemProps: ItemProps;
  rowSpaceOffset: ItemProps["lowerBound"];
  containerHeight: number;
  compactItemHeight: number;
  isCompact: boolean;
  draggable: boolean;
  onMeasure: (id: string, height: number) => void;
  onDrop: (
    id: string,
    position: number,
    allPositions?: Record<string, number>,
  ) => void;
  onDragStart: () => void;
  onCollapse: () => void;
  onCollapseEnd: () => void;
  renderItem: (item: TItem, props: ReorderableRenderProps) => ReactNode;
}) {
  const { animatedStyle, handlePanGestureHandler, registerHandle } =
    useSortable<TItem>({
      ...itemProps,
      lowerBound: rowSpaceOffset,
      containerHeight,
      // The library uses this BOTH as the auto-scroll trigger threshold and
      // as the fallback for an unmeasured row. Drags only ever happen with
      // compact rows, so the compact height is the honest value for both: the
      // list's own (full-card) estimate made the trigger zone two and a half
      // compact rows deep.
      estimatedItemHeight: compactItemHeight,
      onDrop,
      onDragStart,
    });

  // Tells the hook a handle exists, which disables the row-wide pan — the
  // whole row must not drag, only the grip.
  useEffect(() => {
    registerHandle(true);
  }, [registerHandle]);

  /**
   * The collapse gesture, composed SIMULTANEOUS with the drag so neither
   * cancels the other. Its 90ms beats the drag's 200ms, so by the time the
   * pan activates the rows are compact and their heights already published.
   */
  const gesture = useMemo(() => {
    const collapse = Gesture.LongPress()
      .minDuration(COLLAPSE_LONG_PRESS_MS)
      // A drag travels far; without this the long press bails out and takes
      // its `onEnd` with it, putting the rows back mid-drag.
      .maxDistance(10_000)
      .shouldCancelWhenOutside(false)
      .onStart(() => {
        "worklet";
        scheduleOnRN(onCollapse);
      })
      .onFinalize(() => {
        "worklet";
        scheduleOnRN(onCollapseEnd);
      });
    return Gesture.Simultaneous(handlePanGestureHandler, collapse);
  }, [handlePanGestureHandler, onCollapse, onCollapseEnd]);

  const renderProps = { index, isCompact };

  return (
    <Animated.View
      style={animatedStyle}
      onLayout={(event) => {
        // Ours, because the library's own measurement did not always fire —
        // and when it does not, every row is left at the estimate.
        if (isCompact) return;
        onMeasure(item.id, event.nativeEvent.layout.height);
      }}
      testID={`sortable-item-${item.id}`}
    >
      {renderItem(item, renderProps)}

      {/*
        OUTSIDE the body and never re-created by the collapse: a touch goes to
        the view the finger landed on, so a target that unmounts when the body
        swaps takes the gesture with it. A plain View, never a Pressable — RN's
        press responder claims the touch before Gesture Handler's pan can
        activate, so a Pressable here simply never drags.
      */}
      {draggable && (
        <GestureDetector gesture={gesture}>
          <View style={GRIP_TARGET} testID={`sortable-handle-${item.id}`} />
        </GestureDetector>
      )}
    </Animated.View>
  );
}
