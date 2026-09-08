import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated from "react-native-reanimated";
import { ScrollView as GestureScrollView } from "react-native-gesture-handler";
import * as Haptics from "expo-haptics";
import {
  DropProvider,
  SortableItem,
  useSortableList,
} from "react-native-reanimated-dnd";

/**
 * The one drag-to-reorder list in the app. The active session, the workout
 * editor and the workout creator all consume this; nothing else may talk to
 * `react-native-reanimated-dnd` directly.
 *
 * Replaces `react-native-draggable-flatlist`, whose auto-scroll never worked
 * on this stack, and the two-gesture "reorder mode" that was built to work
 * around it. Authority: specs/milestones/REORDER-REBUILD/BRIEF.md, whose § 3
 * records the device spike this is built on. Every unusual choice below is one
 * of that spike's findings — read it before changing any of them, because each
 * was a bug first.
 *
 * The shape is deliberate:
 *
 * - **This list is the screen's ONLY scroller.** Never nest it inside another
 *   ScrollView. The previous implementation nested its list inside the form's
 *   scroll container and bridged the two with a one-shot async `measureLayout`
 *   whose result went stale the moment anything above the list changed height
 *   — which is precisely why dragging to the bottom never scrolled. Header and
 *   footer content belongs in `header`/`footer` here, inside this scroller.
 * - **Heights come from a resolver, not measurement.** The library's
 *   `enableDynamicHeights` measurement path renders overlapping rows and never
 *   converges. Instead each row reports its natural height with a plain
 *   `onLayout` and we hand the library a resolver over those heights, so it is
 *   always working from known geometry. Row spacing must therefore be PADDING
 *   inside the measured row, never margin — `onLayout` excludes margin, and a
 *   short measurement overlaps the next row.
 * - **Drag is confined to a handle.** `renderItem` receives a `Handle`
 *   wrapper; put the grip in it. Registering a handle disables the library's
 *   whole-item pan, which the session's cards need because they contain
 *   weight and reps inputs that a card-wide pan would fight. The pan is
 *   `activateAfterLongPress(200)`, so holding the grip drags it while a plain
 *   swipe still scrolls.
 */

/**
 * Stand-in until the scroller reports its real height. Only ever used for one
 * render — the rows are re-keyed on the measurement — but it must not be the
 * library's own 500 default, which is wrong on every current phone.
 */
const FALLBACK_VIEWPORT_HEIGHT = 600;

/** Module-scope so its identity never changes across renders. */
const itemId = (item: ReorderableItem) => item.id;

/**
 * Gesture Handler's ScrollView, not React Native's, and wrapped for Reanimated
 * — the same composition the library's own `Sortable` uses. A vertical pan
 * inside a vertical scroller is the one genuinely contended case, and this is
 * what lets the two coordinate (see `simultaneousHandlers` below). With RN's
 * ScrollView the drag simply never engaged from a handle.
 */
const AnimatedScrollView = Animated.createAnimatedComponent(GestureScrollView);

export type ReorderableItem = { id: string };

export type ReorderableRenderProps = {
  /** Wrap the drag grip in this. Nothing else starts a drag. */
  Handle: (props: { children: ReactNode }) => ReactNode;
  index: number;
};

// NOTE: no `isActive`. The lifted-row state is knowable — `useSortable`
// returns `isMoving` — but `SortableItem` does not pass it down to its
// children, so there is no honest way to surface it from here yet. A prop
// hardcoded to `false` would silently strip the drag affordance from every
// consumer that styled on it, so it is left out until it can be wired.

export type ReorderableListProps<TItem extends ReorderableItem> = {
  data: TItem[];
  renderItem: (item: TItem, props: ReorderableRenderProps) => ReactNode;
  /**
   * Fired once on drop with the item that moved, its new index, and the whole
   * committed order. Derived from the library's `onDrop` — its `onMove` fires
   * per DISPLACED row mid-drag and is not a commit hook; treating it as one
   * corrupts the order.
   */
  onReorder: (movedId: string, toIndex: number, orderedIds: string[]) => void;
  header?: ReactNode;
  footer?: ReactNode;
  /** Used only until a row has reported its real height. */
  estimatedItemHeight?: number;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  scrollEnabled?: boolean;
  testID?: string;
};

/**
 * `positions` inside `useSortableList` is seeded from the data order ONCE and
 * never re-synced, so the hook must remount when the id *set* changes (an
 * exercise added or removed) — but must NOT remount on a plain reorder, or the
 * list would jump back to the top after every drop. Keying on the SORTED ids
 * draws exactly that line.
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

  /**
   * Row heights are measured HERE, above the hook, because the hook seeds its
   * own geometry once per mount (`initialHeights` is a `useMemo(…, [])`, and
   * each row's initial top offset likewise). Measured heights necessarily
   * arrive after that, so a hook mounted against estimates keeps them for
   * life — the drag engages and then moves nothing, which is precisely what it
   * did. Re-keying the hook on the settled heights makes it seed from the real
   * geometry instead.
   */
  const [heights, setHeights] = useState<Record<string, number>>({});
  const measure = useCallback((id: string, event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.height);
    if (next <= 0) return;
    setHeights((current) =>
      current[id] === next ? current : { ...current, [id]: next },
    );
  }, []);

  // Only once EVERY row has reported does the token change, so the hook
  // remounts once on settle rather than once per row.
  const settled =
    props.data.length > 0 &&
    props.data.every((item) => heights[item.id] != null);
  const geometryKey = settled
    ? props.data.map((item) => heights[item.id]).join(",")
    : "estimating";

  return (
    <ReorderableListInner
      key={`${identityKey}::${geometryKey}`}
      {...props}
      heights={heights}
      onMeasureRow={measure}
    />
  );
}

function ReorderableListInner<TItem extends ReorderableItem>({
  data,
  renderItem,
  onReorder,
  header,
  footer,
  estimatedItemHeight = 96,
  style,
  contentContainerStyle,
  scrollEnabled = true,
  testID,
  heights,
  onMeasureRow,
}: ReorderableListProps<TItem> & {
  heights: Record<string, number>;
  onMeasureRow: (id: string, event: LayoutChangeEvent) => void;
}) {
  const [viewportHeight, setViewportHeight] = useState(0);
  const dataRef = useRef(data);
  dataRef.current = data;

  // A fresh identity whenever a measurement changes, so the hook's effect
  // recomputes the geometry it derives from this.
  const itemHeight = useCallback(
    (item: TItem) => heights[item.id] ?? estimatedItemHeight,
    [heights, estimatedItemHeight],
  );

  const {
    scrollViewRef,
    dropProviderRef,
    handleScroll,
    handleScrollEnd,
    contentHeight,
    getItemProps,
  } = useSortableList<TItem>({
    data,
    itemHeight,
    estimatedItemHeight,
    // Stable identity on purpose. The hook defaults this to a fresh arrow on
    // every call and then lists it in its geometry effect's deps, so leaving
    // it out re-runs that effect on every single render.
    itemKeyExtractor: itemId,
  });

  const handleDrop = useCallback(
    (id: string, position: number, allPositions?: Record<string, number>) => {
      if (!allPositions) return;
      const ordered = [...dataRef.current]
        .sort((a, b) => (allPositions[a.id] ?? 0) - (allPositions[b.id] ?? 0))
        .map((item) => item.id);
      const from = dataRef.current.findIndex((item) => item.id === id);
      if (from === position) return;
      onReorder(id, position, ordered);
    },
    [onReorder],
  );

  // Matches the feel the old handle gave on long-press, now fired by the
  // library at the moment the drag actually engages rather than by a Pressable
  // that only pretended to start one.
  const handleDragStart = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
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
        scrollEnabled={scrollEnabled}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        style={[{ flex: 1 }, style]}
        contentContainerStyle={contentContainerStyle}
        simultaneousHandlers={dropProviderRef}
        onLayout={(event) =>
          setViewportHeight(Math.round(event.nativeEvent.layout.height))
        }
      >
        {header}

        {/*
        Keyed on the measured viewport, and that is load-bearing.

        `useSortable` freezes `containerHeight` on first render
        (`useRef(containerHeight).current`) and derives the auto-scroll edge
        from it as `lowerBound + containerHeight`. So a row that mounts before
        the measurement lands keeps the wrong edge for its whole life: with the
        library's own default of 500 the downward trigger sits ~200pt above the
        real bottom of a tall phone's list — dragging to the bottom does not
        scroll, while dragging to the top still does, because the upward edge
        keys off the scroll offset instead. Re-keying remounts the rows once
        the real height is known, and again if it changes (rotation, keyboard).
      */}
        <View style={{ height: contentHeight }}>
          {data.map((item, index) => (
            <ReorderableRow
              key={item.id}
              item={item}
              index={index}
              itemProps={getItemProps(item, index)}
              viewportHeight={viewportHeight || FALLBACK_VIEWPORT_HEIGHT}
              onDrop={handleDrop}
              onDragStart={handleDragStart}
              onMeasure={onMeasureRow}
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

function ReorderableRow<TItem extends ReorderableItem>({
  item,
  index,
  itemProps,
  viewportHeight,
  onDrop,
  onDragStart,
  onMeasure,
  renderItem,
}: {
  item: TItem;
  index: number;
  itemProps: ItemProps;
  viewportHeight: number;
  onDrop: (
    id: string,
    position: number,
    allPositions?: Record<string, number>,
  ) => void;
  onDragStart: () => void;
  onMeasure: (id: string, event: LayoutChangeEvent) => void;
  renderItem: (item: TItem, props: ReorderableRenderProps) => ReactNode;
}) {
  // NOTE: `lowerBound` is passed through UNCHANGED, deliberately.
  //
  // Rows sit in their own coordinate space starting below the header, so on
  // paper this needs correcting by the header's height. Subtracting it was
  // tried and made auto-scroll wildly over-eager — a two-row drag travelled
  // thirteen positions — whereas the uncorrected value drops precisely and
  // still auto-scrolls at both edges, verified on device with a header more
  // than twice this one's height. The library evidently already reconciles
  // the two spaces (`onStart` captures the item's content Y and the finger's
  // absolute Y together, and tracks the scroll delta from there). Measured
  // behaviour wins over the model: leave it alone.
  const Handle = useCallback(
    ({ children }: { children: ReactNode }) => (
      <SortableItem.Handle>{children}</SortableItem.Handle>
    ),
    [],
  );

  return (
    <SortableItem
      data={item}
      {...itemProps}
      // Defaults to 500 and is captured once in a ref; the library's own
      // wrapper never passes it, which puts the auto-scroll edge ~200pt above
      // the real bottom of a tall phone's list.
      containerHeight={viewportHeight}
      onDrop={onDrop}
      onDragStart={onDragStart}
    >
      <View onLayout={(event) => onMeasure(item.id, event)}>
        {renderItem(item, { Handle, index })}
      </View>
    </SortableItem>
  );
}
