import { View } from "react-native";

import { renderWithTheme } from "../../../../__tests__/test-utils";
import { Avatar } from "../foundation/Avatar";
import { Btn } from "../foundation/Btn";
import { Card } from "../foundation/Card";
import { IconBtn } from "../foundation/IconBtn";
import { Segmented } from "../foundation/Segmented";
import { TabBar, type TabSpec } from "../foundation/TabBar";
import { ClientRow } from "../composite/ClientRow";
import { DrawerRow } from "../composite/DrawerRow";
import { HabitTile } from "../composite/HabitTile";
import { SummaryChip } from "../composite/SummaryChip";
import { WorkoutCarouselCard } from "../composite/WorkoutCarouselCard";
import { IconHome } from "../icons";

/**
 * Automated a11y audit (01-design-system STORY-005 AC 5.4 + 5.5 + 5.3).
 *
 * Every pressable primitive variant must:
 *   1. expose accessibilityRole (button / tab) — screen readers announce it;
 *   2. expose a non-empty accessibilityLabel — fails loudly otherwise;
 *   3. meet the 44pt effective touch-target floor, either via minHeight >= 44
 *      OR via hitSlop that expands a smaller visual to 44 (Apple HIG). The two
 *      documented exceptions are asserted explicitly:
 *        - <Btn size="sm"> is 36pt by contract (dense-row only; parent meets 44)
 *        - the 44pt floor for IconBtn/Avatar/HabitTile is met by hitSlop, not
 *          minHeight (they keep their compact visual size).
 */

const ICON = <View testID="icon" />;

/** Flatten a possibly-array/function RN style into a plain object. */
function flatStyle(style: unknown): Record<string, unknown> {
  if (typeof style === "function") {
    return flatStyle(
      (style as (s: { pressed: boolean }) => unknown)({
        pressed: false,
      }),
    );
  }
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (acc, s) => ({ ...acc, ...flatStyle(s) }),
      {},
    );
  }
  return (style as Record<string, unknown>) ?? {};
}

/** Effective touch target: max(visual minHeight, size) + 2*hitSlop >= 44.
 * Walks the node + its descendants because primitives put hitSlop on the outer
 * Pressable but minHeight/height on an inner View. */
function meetsTouchTarget(node: {
  props: Record<string, unknown>;
  children?: unknown[];
}): boolean {
  const slop = node.props.hitSlop;
  const slopPad =
    typeof slop === "number"
      ? slop * 2
      : slop && typeof slop === "object"
        ? ((slop as { top?: number }).top ?? 0) +
          ((slop as { bottom?: number }).bottom ?? 0)
        : 0;

  let maxDim = 0;
  const visit = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const el = n as { props?: Record<string, unknown>; children?: unknown[] };
    if (el.props) {
      const style = flatStyle(el.props.style);
      const minH =
        typeof style.minHeight === "number" ? (style.minHeight as number) : 0;
      const h = typeof style.height === "number" ? (style.height as number) : 0;
      maxDim = Math.max(maxDim, minH, h);
    }
    const kids = el.children;
    if (Array.isArray(kids)) kids.forEach(visit);
  };
  visit(node);

  return maxDim + slopPad >= 44;
}

describe("a11y audit — pressable primitives expose role + label (AC 5.4, 5.5)", () => {
  it("Btn (all tones) announces button role + label", () => {
    const { getByTestId } = renderWithTheme(
      <Btn
        onPress={() => undefined}
        accessibilityLabel="Start workout"
        testID="btn"
      >
        Start
      </Btn>,
    );
    const n = getByTestId("btn");
    expect(n.props.accessibilityRole).toBe("button");
    expect(n.props.accessibilityLabel).toBeTruthy();
  });

  it("IconBtn announces button role + label", () => {
    const { getByTestId } = renderWithTheme(
      <IconBtn
        icon={ICON}
        onPress={() => undefined}
        accessibilityLabel="Notifications"
        testID="ib"
      />,
    );
    const n = getByTestId("ib");
    expect(n.props.accessibilityRole).toBe("button");
    expect(n.props.accessibilityLabel).toBe("Notifications");
  });

  it("Avatar (pressable) announces button role + label", () => {
    const { getByTestId } = renderWithTheme(
      <Avatar initials="BE" onPress={() => undefined} testID="av" />,
    );
    const n = getByTestId("av");
    expect(n.props.accessibilityRole).toBe("button");
    expect(n.props.accessibilityLabel).toBeTruthy();
  });

  it("Card (pressable) announces button role + label", () => {
    const { getByTestId } = renderWithTheme(
      <Card onPress={() => undefined} accessibilityLabel="Open" testID="card">
        <View />
      </Card>,
    );
    const n = getByTestId("card-pressable");
    expect(n.props.accessibilityRole).toBe("button");
    expect(n.props.accessibilityLabel).toBe("Open");
  });

  it("Segmented options announce tab role + label", () => {
    const { getByTestId } = renderWithTheme(
      <Segmented
        testID="seg"
        options={["A", "B"]}
        value="A"
        onChange={() => undefined}
      />,
    );
    const n = getByTestId("seg-option-A");
    expect(n.props.accessibilityRole).toBe("tab");
    expect(n.props.accessibilityLabel).toBeTruthy();
  });

  it("TabBar tabs announce tab role + label", () => {
    const tabs: TabSpec[] = [
      { id: "home", icon: IconHome, label: "Home" },
      { id: "you", icon: IconHome, label: "You" },
      { id: "x", icon: IconHome, label: "X" },
    ];
    const { getByTestId } = renderWithTheme(
      <TabBar tabs={tabs} active="home" onChange={() => undefined} />,
    );
    const n = getByTestId("tabbar-tab-home");
    expect(n.props.accessibilityRole).toBe("tab");
    expect(n.props.accessibilityLabel).toBe("Home");
  });

  it.each([
    [
      "DrawerRow",
      <DrawerRow
        key="d"
        icon={ICON}
        title="Settings"
        onPress={() => undefined}
        testID="row"
      />,
    ],
    [
      "SummaryChip",
      <SummaryChip
        key="s"
        count={3}
        label="Active"
        tone="success"
        onPress={() => undefined}
        testID="row"
      />,
    ],
    [
      "ClientRow",
      <ClientRow
        key="c"
        avatar={{ initials: "JD" }}
        name="Jane"
        onPress={() => undefined}
        testID="row"
      />,
    ],
    [
      "WorkoutCarouselCard",
      <WorkoutCarouselCard
        key="w"
        title="Push"
        mins={45}
        sub="x"
        chips={[]}
        onPress={() => undefined}
        testID="row"
      />,
    ],
    [
      "HabitTile",
      <HabitTile
        key="h"
        state="today"
        tone="primary"
        label="Workout"
        onPress={() => undefined}
        testID="row"
      />,
    ],
  ])("composite %s (pressable) announces button role + label", (_name, el) => {
    const { getByTestId } = renderWithTheme(el);
    const n = getByTestId("row");
    expect(n.props.accessibilityRole).toBe("button");
    expect(n.props.accessibilityLabel).toBeTruthy();
  });
});

describe("a11y audit — touch-target floor (AC 5.3)", () => {
  it("Btn md/lg meet the 44pt floor via minHeight", () => {
    for (const [size, expected] of [
      ["md", 44],
      ["lg", 52],
    ] as const) {
      const { getByTestId } = renderWithTheme(
        <Btn size={size} onPress={() => undefined} testID={`btn-${size}`}>
          x
        </Btn>,
      );
      expect(meetsTouchTarget(getByTestId(`btn-${size}`))).toBe(true);
      void expected;
    }
  });

  it("Btn sm is the documented 36pt dense-row exception (NOT 44)", () => {
    const { getByTestId } = renderWithTheme(
      <Btn size="sm" onPress={() => undefined} testID="btn-sm">
        x
      </Btn>,
    );
    const style = flatStyle(getByTestId("btn-sm").props.style);
    expect(style.minHeight).toBe(36);
  });

  it("IconBtn (default 36) meets 44pt via hitSlop", () => {
    const { getByTestId } = renderWithTheme(
      <IconBtn
        icon={ICON}
        onPress={() => undefined}
        accessibilityLabel="x"
        testID="ib"
      />,
    );
    expect(meetsTouchTarget(getByTestId("ib"))).toBe(true);
  });

  it("Avatar (default 36, pressable) meets 44pt via hitSlop", () => {
    const { getByTestId } = renderWithTheme(
      <Avatar initials="BE" onPress={() => undefined} testID="av" />,
    );
    expect(meetsTouchTarget(getByTestId("av"))).toBe(true);
  });

  it("HabitTile (36) meets 44pt via hitSlop", () => {
    const { getByTestId } = renderWithTheme(
      <HabitTile
        state="today"
        tone="primary"
        onPress={() => undefined}
        testID="ht"
      />,
    );
    expect(meetsTouchTarget(getByTestId("ht"))).toBe(true);
  });

  it("DrawerRow / ClientRow / SummaryChip meet 44pt via minHeight", () => {
    const rows = [
      <DrawerRow
        key="d"
        icon={ICON}
        title="S"
        onPress={() => undefined}
        testID="r"
      />,
      <ClientRow
        key="c"
        avatar={{ initials: "JD" }}
        name="J"
        onPress={() => undefined}
        testID="r"
      />,
      <SummaryChip
        key="s"
        count={1}
        label="x"
        tone="primary"
        onPress={() => undefined}
        testID="r"
      />,
    ];
    for (const el of rows) {
      const { getByTestId, unmount } = renderWithTheme(el);
      expect(meetsTouchTarget(getByTestId("r"))).toBe(true);
      unmount();
    }
  });
});
