import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated from "react-native-reanimated";
import { SortableItem, useSortableList } from "react-native-reanimated-dnd";

/**
 * ⚠ NOT YET WIRED TO ANY SCREEN. This is the verified foundation for the
 * reorder rebuild, landed ahead of the surface ports so the device findings
 * behind it are not lost. The session, editor and creator still use
 * `react-native-draggable-flatlist`; swapping them over, and ripping that
 * dependency out, is the remaining work (BRIEF.md § 4 and § 5).
 *
 * Verified on an iPhone 17 Pro Max against the live dev build: drag from the
 * handle, a plain swipe still scrolls, non-uniform row heights lay out and
 * drop, auto-scroll fires at both edges. One known gap: on non-uniform rows a
 * drop can still land a position or two further than the drag distance, so the
 * position maths needs finishing before this drives a real screen.
 *
 * Intended to be the one drag-to-reorder list in the app — session, workout
 * editor and workout creator all consuming this, with nothing else talking to
 * `react-native-reanimated-dnd` directly.
 *
 * Replaces `react-native-draggable-flatlist`, whose auto-scroll never worked
 * on this stack, and the two-gesture "compact reorder mode" that was built to
 * work around it. Authority: specs/milestones/REORDER-REBUILD/BRIEF.md, whose
 * § 3 records the device spike this implementation is built on. Every unusual
 * choice below is one of that spike's findings — read it before changing any
 * of them, because each was a bug first.
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
 *   always working from known geometry.
 * - **Drag is confined to a handle.** `renderItem` receives a `Handle`
 *   wrapper; put the grip in it. Registering a handle disables the whole-item
 *   pan, which the session's cards need because they contain weight and reps
 *   inputs that a card-wide pan would fight.
 */

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
   * Fired once on drop, with the committed order. Derived from the library's
   * `onDrop` (its `onMove` fires per displaced row mid-drag and is NOT a
   * commit hook — treating it as one corrupts the order).
   */
  onReorder: (orderedIds: string[]) => void;
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
  return <ReorderableListInner key={identityKey} {...props} />;
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
}: ReorderableListProps<TItem>) {
  const [heights, setHeights] = useState<Record<string, number>>({});
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
    handleScroll,
    handleScrollEnd,
    contentHeight,
    getItemProps,
  } = useSortableList<TItem>({
    data,
    itemHeight,
    estimatedItemHeight,
  });

  const measure = useCallback((id: string, event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.height);
    if (next <= 0) return;
    setHeights((current) =>
      current[id] === next ? current : { ...current, [id]: next },
    );
  }, []);

  const handleDrop = useCallback(
    (_id: string, _position: number, allPositions?: Record<string, number>) => {
      if (!allPositions) return;
      const ordered = [...dataRef.current]
        .sort((a, b) => (allPositions[a.id] ?? 0) - (allPositions[b.id] ?? 0))
        .map((item) => item.id);
      onReorder(ordered);
    },
    [onReorder],
  );

  return (
    <Animated.ScrollView
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
      onLayout={(event) =>
        setViewportHeight(Math.round(event.nativeEvent.layout.height))
      }
    >
      {header}

      {/*
        Rows are withheld until the viewport has been measured, and this is
        NOT a cosmetic loading gate.

        `useSortable` freezes `containerHeight` on first render
        (`useRef(containerHeight).current`) and derives the auto-scroll edge
        from it as `lowerBound + containerHeight`. Mount a row while the
        measurement is still 0 and that row's edge is pinned at the scroll
        offset itself, so auto-scroll-down stays true for the whole drag: the
        list runs away and a two-row drag travels a dozen positions. Measure
        first, mount second, and every row captures the real viewport.
      */}
      <View style={{ height: contentHeight }}>
        {viewportHeight > 0 &&
          data.map((item, index) => (
            <ReorderableRow
              key={item.id}
              item={item}
              index={index}
              itemProps={getItemProps(item, index)}
              viewportHeight={viewportHeight}
              onDrop={handleDrop}
              onMeasure={measure}
              renderItem={renderItem}
            />
          ))}
      </View>

      {footer}
    </Animated.ScrollView>
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
    >
      <View onLayout={(event) => onMeasure(item.id, event)}>
        {renderItem(item, { Handle, index })}
      </View>
    </SortableItem>
  );
}
