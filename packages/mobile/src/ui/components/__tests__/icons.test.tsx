import { render } from "@testing-library/react-native";
import type { ComponentType } from "react";
import { createElement } from "react";

import * as icons from "../icons";
import {
  ICON_COLOR_DEFAULT,
  ICON_STROKE,
  iconDefaults,
  IconFire,
  IconFlame,
  IconHome,
} from "../icons";

// The 48 prototype-facing IconXxx names that every downstream spec + the
// adoption sweep depend on. The list mirrors design.md § Lucide icon
// migration (with the 2026-05-29 Lucide-1.x rename note applied — the
// *alias* names are unchanged, only their underlying Lucide import moved).
const EXPECTED_ICON_NAMES = [
  "IconHome",
  "IconDumbbell",
  "IconChart",
  "IconFlame",
  "IconApple",
  "IconUser",
  "IconUsers",
  "IconBook",
  "IconGrid",
  "IconMore",
  "IconMore_v",
  "IconBolt",
  "IconMedal",
  "IconCrown",
  "IconPlus",
  "IconMinus",
  "IconBarcode",
  "IconCamera",
  "IconDroplet",
  "IconChevronR",
  "IconChevronD",
  "IconArrowUp",
  "IconArrowR",
  "IconBell",
  "IconSearch",
  "IconFilter",
  "IconSettings",
  "IconLogout",
  "IconCheck",
  "IconHeart",
  "IconCalendar",
  "IconTimer",
  "IconClipboard",
  "IconLayers",
  "IconMessage",
  "IconSwap",
  "IconX",
  "IconHealth",
  "IconTrending",
  "IconPlay",
  "IconPause",
  "IconSparkles",
  "IconTarget",
  "IconEdit",
  "IconInfo",
  "IconBack",
  "IconNote",
  "IconTag",
  // Vocabulary extension (2026-05-29) — unblocks the STORY-007 adoption sweep.
  "IconTrash",
  "IconLock",
  "IconList",
  "IconChevronUp",
  "IconWarning",
  "IconAlert",
  "IconMail",
  "IconClock",
] as const;

describe("icons module", () => {
  it("exports every prototype IconXxx name from the mapping table", () => {
    for (const name of EXPECTED_ICON_NAMES) {
      const Comp = (icons as Record<string, unknown>)[name];
      expect(Comp).toBeDefined();
      // lucide icons are React forwardRef objects, renderable as components.
      const t = typeof Comp;
      expect(t === "function" || t === "object").toBe(true);
    }
  });

  it("exports the IconFire alias pointing at the same glyph as IconFlame", () => {
    expect(IconFire).toBe(IconFlame);
  });

  it("renders an icon without throwing", () => {
    const { UNSAFE_root } = render(
      createElement(IconHome, { ...iconDefaults() }),
    );
    expect(UNSAFE_root).toBeTruthy();
  });

  it("renders each exported icon component without throwing", () => {
    for (const name of EXPECTED_ICON_NAMES) {
      const Comp = (icons as Record<string, unknown>)[name] as ComponentType<
        Record<string, unknown>
      >;
      expect(() =>
        render(createElement(Comp, { ...iconDefaults() })),
      ).not.toThrow();
    }
  });
});

describe("icon defaults (STORY-008 AC 8.4 + 8.5)", () => {
  it("defaults colour to currentColor so primitives drive the tint", () => {
    expect(ICON_COLOR_DEFAULT).toBe("currentColor");
    expect(iconDefaults().color).toBe("currentColor");
  });

  it("uses stroke 1.75 for resting state and 2 for active", () => {
    expect(ICON_STROKE.default).toBe(1.75);
    expect(ICON_STROKE.active).toBe(2);
    expect(iconDefaults().strokeWidth).toBe(1.75);
    expect(iconDefaults({ active: true }).strokeWidth).toBe(2);
  });

  it("defaults size to 22 and forwards a standardised size", () => {
    expect(iconDefaults().size).toBe(22);
    expect(iconDefaults({ size: 18 }).size).toBe(18);
    expect(iconDefaults({ size: 24, active: true })).toEqual({
      size: 24,
      strokeWidth: 2,
      color: "currentColor",
    });
  });
});
