import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { Dimensions, View, type StyleProp, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import {
  GestureDetector,
  ScrollView as GestureScrollView,
} from "react-native-gesture-handler";
import {
  DropProvider,
  useSortable,
  useSortableList,
} from "react-native-reanimated-dnd";

/**
 * The list shown while a screen is in REORDER MODE (PER-67, Brad 10 Nov 2026).
 *
 * The active session, the workout editor and the workout creator each have a
 * "Reorder" button. Tapping it swaps the cards for this list: one compact row
 * per exercise (a superset is one row), each with a visible drag handle, under
 * a bar with Done. Outside reorder mode there is no drag at all: the cards
 * are an ordinary scroll view, so no tap, hold or delete can start one.
 *
 * This replaces a single-gesture design (hold the grip on a card: every card
 * collapsed on a 90 ms long press while the library's own 200 ms pan was
 * still pending, through an invisible target laid over each card's corner).
 * Any gesture that ended in between could leave some cards collapsed and
 * others not, which is what PER-67 and Brad's "two sets" report were.
 *
 * Because every row here is the same known height and there is nothing above
 * the rows in this scroller, none of that design's workarounds are needed:
 * no measuring, no compensation for a header, no collapse timing.
 *
 * The one library quirk that still matters: `useSortable` freezes
 * `containerHeight` on its first render and derives the auto-scroll edge from
 * it, so it is taken from the window at mount and clamped to the rows'
 * height. NEVER 0 — the library would read every drag as "scroll down" and
 * commit it at the last index.
 *
 * `react-native-reanimated-dnd` is only used here.
 */
const AnimatedScrollView = Animated.createAnimatedComponent(GestureScrollView);

export type ReorderableItem = { id: string };

export type ReorderableRowProps = {
  index: number;
  /**
   * Wrap the row's grip in this. It attaches the drag (a 200 ms hold on the
   * handle, then move) to that grip and nothing else in the row.
   */
  wrapHandle: (handle: ReactNode) => ReactNode;
};

export type ReorderableListProps<TItem extends ReorderableItem> = {
  data: TItem[];
  /** Height of every row, including its spacing. */
  rowHeight: number;
  renderRow: (item: TItem, props: ReorderableRowProps) => ReactNode;
  /**
   * Fired once on drop with the item that moved, its new index and the whole
   * committed order. Not per displaced row: the library's `onMove` is not a
   * commit hook.
   */
  onReorder: (movedId: string, toIndex: number, orderedIds: string[]) => void;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  testID?: string;
};

const itemId = (item: ReorderableItem) => item.id;

/**
 * `positions` inside `useSortableList` is seeded once, so the hook remounts
 * when the id SET changes. A plain reorder re-seeds in place instead (see
 * below), which keeps the scroll offset after a drop.
 */
export function ReorderableList<TItem extends ReorderableItem>(
  props: ReorderableListProps<TItem>,
) {
  const identityKey = props.data
    .map((item) => item.id)
    .sort()
    .join("|");
  return <ReorderableListInner key={identityKey} {...props} />;
}

function ReorderableListInner<TItem extends ReorderableItem>({
  data,
  rowHeight,
  renderRow,
  onReorder,
  style,
  contentContainerStyle,
  testID,
}: ReorderableListProps<TItem>) {
  const windowHeight = useRef(Dimensions.get("window").height).current;
  const isDraggingRef = useRef(false);
  const dataRef = useRef(data);
  dataRef.current = data;

  const {
    positions,
    scrollViewRef,
    dropProviderRef,
    handleScroll,
    handleScrollEnd,
    contentHeight,
    getItemProps,
  } = useSortableList<TItem>({
    data,
    itemHeight: rowHeight,
    estimatedItemHeight: rowHeight,
    itemKeyExtractor: itemId,
  });

  /**
   * Re-seed the position map from the rendered order when it changes outside
   * a drag (a VoiceOver Move up / Move down), or the next drop would commit
   * against the stale map.
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

  const containerHeight = Math.min(
    windowHeight,
    Math.max(data.length * rowHeight, 1),
  );

  const handleDragStart = useCallback(() => {
    isDraggingRef.current = true;
  }, []);

  const handleDrop = useCallback(
    (id: string, position: number, allPositions?: Record<string, number>) => {
      // Gesture Handler finalizes FAILED and CANCELLED pans too, and the
      // library forwards them here: only a pan that started commits.
      const wasDragging = isDraggingRef.current;
      isDraggingRef.current = false;
      if (!wasDragging || !allPositions) return;
      const from = dataRef.current.findIndex((item) => item.id === id);
      if (from === position) return;
      const ordered = [...dataRef.current]
        .sort((a, b) => (allPositions[a.id] ?? 0) - (allPositions[b.id] ?? 0))
        .map((item) => item.id);
      onReorder(id, position, ordered);
    },
    [onReorder],
  );

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
        style={[{ flex: 1 }, style]}
        contentContainerStyle={contentContainerStyle}
        simultaneousHandlers={dropProviderRef}
      >
        <View style={{ height: contentHeight }}>
          {data.map((item, index) => (
            <ReorderableRow
              key={item.id}
              item={item}
              index={index}
              itemProps={getItemProps(item, index)}
              rowHeight={rowHeight}
              containerHeight={containerHeight}
              onDragStart={handleDragStart}
              onDrop={handleDrop}
              renderRow={renderRow}
            />
          ))}
        </View>
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
  rowHeight,
  containerHeight,
  onDragStart,
  onDrop,
  renderRow,
}: {
  item: TItem;
  index: number;
  itemProps: ItemProps;
  rowHeight: number;
  containerHeight: number;
  onDragStart: () => void;
  onDrop: (
    id: string,
    position: number,
    allPositions?: Record<string, number>,
  ) => void;
  renderRow: (item: TItem, props: ReorderableRowProps) => ReactNode;
}) {
  const { animatedStyle, handlePanGestureHandler, registerHandle } =
    useSortable<TItem>({
      ...itemProps,
      itemHeight: rowHeight,
      estimatedItemHeight: rowHeight,
      containerHeight,
      onDragStart,
      onDrop,
    });

  // Only the handle drags; the rest of the row scrolls the list.
  useEffect(() => {
    registerHandle(true);
  }, [registerHandle]);

  const wrapHandle = (handle: ReactNode) => (
    <GestureDetector gesture={handlePanGestureHandler}>
      <View collapsable={false} testID={`sortable-handle-${item.id}`}>
        {handle}
      </View>
    </GestureDetector>
  );

  return (
    <Animated.View
      style={[animatedStyle, { height: rowHeight }]}
      testID={`sortable-item-${item.id}`}
    >
      {renderRow(item, { index, wrapHandle })}
    </Animated.View>
  );
}
