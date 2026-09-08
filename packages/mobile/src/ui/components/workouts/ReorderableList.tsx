import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import { ScrollView as GestureScrollView } from "react-native-gesture-handler";
import * as Haptics from "expo-haptics";
import {
  DropProvider,
  SortableItem,
  useSortableList,
} from "react-native-reanimated-dnd";

/**
 * The app's drag-to-reorder list. The active session, the workout editor and
 * the workout creator all reorder through this; nothing else may talk to
 * `react-native-reanimated-dnd` directly.
 *
 * ⚠ ROWS MUST BE A SINGLE UNIFORM HEIGHT, and that is not a stylistic
 * preference — it is the one thing that makes the drag work at all.
 *
 * Bisected on device against the real session screen: with a uniform
 * `itemHeight` a held grip drags the row and commits the order; with real
 * per-card heights the drag engages and moves nothing, whether those heights
 * are measured or handed in. The library's varying-height sortable is simply
 * broken — the same spike also rendered rows of 96/168/240pt overlapping each
 * other. So this component takes ONE number and the callers collapse to
 * uniform rows while reordering. Do not reintroduce a height resolver.
 *
 * The rest of the shape is deliberate too:
 *
 * - **This list is the screen's only scroller while it is mounted.** Never
 *   nest it in another ScrollView. The previous implementation nested its list
 *   inside the form's scroller and bridged them with a one-shot async
 *   `measureLayout` that went stale whenever anything above it changed height,
 *   which is why dragging to the bottom never scrolled. Put surrounding
 *   content in `header`/`footer` instead.
 * - **Gesture Handler's ScrollView, wrapped for Reanimated**, with
 *   `simultaneousHandlers` — the composition the library's own `Sortable`
 *   uses. A vertical pan inside a vertical scroller is genuinely contended.
 * - **Drag is confined to a handle.** `renderItem` receives a `Handle`
 *   wrapper; put the grip inside it. Registering a handle disables the
 *   whole-item pan, and the pan is `activateAfterLongPress(200)`, so holding
 *   the grip drags while a plain swipe still scrolls.
 */
const AnimatedScrollView = Animated.createAnimatedComponent(GestureScrollView);

/** Module scope so its identity never changes between renders. */
const itemId = (item: ReorderableItem) => item.id;

export type ReorderableItem = { id: string };

export type ReorderableRenderProps = {
  /** Wrap the drag grip in this. Nothing else starts a drag. */
  Handle: (props: { children: ReactNode }) => ReactNode;
  index: number;
};

export type ReorderableListProps<TItem extends ReorderableItem> = {
  data: TItem[];
  /** Uniform row height, including any spacing. See the note above. */
  itemHeight: number;
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
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * `positions` inside `useSortableList` is seeded from the data order ONCE and
 * never re-synced, so the hook must remount when the id *set* changes (a row
 * added or removed) — but must NOT remount on a plain reorder, or the list
 * would jump back to the top after every drop. Keying on the SORTED ids draws
 * exactly that line.
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
  itemHeight,
  renderItem,
  onReorder,
  header,
  footer,
  style,
  contentContainerStyle,
  testID,
}: ReorderableListProps<TItem>) {
  const [viewportHeight, setViewportHeight] = useState(0);
  const dataRef = useRef(data);
  dataRef.current = data;

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
    // Stable identity on purpose: the hook defaults this to a fresh arrow on
    // every call and then lists it in its geometry effect's deps, so leaving
    // it out re-runs that effect on every render.
    itemKeyExtractor: itemId,
  });

  const handleDrop = useCallback(
    (id: string, position: number, allPositions?: Record<string, number>) => {
      if (!allPositions) return;
      const from = dataRef.current.findIndex((item) => item.id === id);
      if (from === position) return;
      const ordered = [...dataRef.current]
        .sort((a, b) => (allPositions[a.id] ?? 0) - (allPositions[b.id] ?? 0))
        .map((item) => item.id);
      onReorder(id, position, ordered);
    },
    [onReorder],
  );

  // Matches the feel the old handle gave on long-press, but fired at the
  // moment the drag actually engages rather than by a Pressable that only
  // pretended to start one.
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
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        style={[{ flex: 1 }, style]}
        contentContainerStyle={contentContainerStyle}
        simultaneousHandlers={dropProviderRef}
        onLayout={(event) =>
          setViewportHeight(Math.round(event.nativeEvent.layout.height))
        }
      >
        {header}

        <View style={{ height: contentHeight }}>
          {data.map((item, index) => (
            <ReorderableRow
              key={item.id}
              item={item}
              index={index}
              itemProps={getItemProps(item, index)}
              viewportHeight={viewportHeight}
              onDrop={handleDrop}
              onDragStart={handleDragStart}
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
  renderItem: (item: TItem, props: ReorderableRenderProps) => ReactNode;
}) {
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
      // Defaults to 500 and is frozen on first render
      // (`useRef(containerHeight).current`), and the library's own wrapper
      // never passes it — which puts the auto-scroll trigger edge ~200pt above
      // the real bottom of a tall phone's list. That is why dragging DOWN to
      // the bottom did not scroll while dragging up did: the upward edge keys
      // off the scroll offset instead.
      containerHeight={viewportHeight}
      onDrop={onDrop}
      onDragStart={onDragStart}
    >
      {renderItem(item, { Handle, index })}
    </SortableItem>
  );
}
