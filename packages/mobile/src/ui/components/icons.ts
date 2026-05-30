// Persistence — Lucide icon vocabulary
//
// Implements 01-design-system/requirements.md STORY-008 (AC 8.1–8.5) and
// design.md § "Lucide icon migration" + the 2026-05-29 revision note
// (Lucide 1.x renames).
//
// Re-exports `lucide-react-native` components under the prototype's IconXxx
// names so the adoption sweep (STORY-007) is a one-line swap per call-site.
// The IconXxx names are the stable contract downstream specs consume; only
// the underlying Lucide export name tracks upstream renames.
//
// Five icons were renamed in Lucide 1.x (old aliases dropped):
//   Home -> House, BarChart3 -> ChartColumn, MoreHorizontal -> Ellipsis,
//   MoreVertical -> EllipsisVertical, Filter -> ListFilter.

import {
  Apple as IconApple,
  ArrowLeft as IconBack,
  ArrowLeftRight as IconSwap,
  ArrowRight as IconArrowR,
  ArrowUp as IconArrowUp,
  Barcode as IconBarcode,
  Bell as IconBell,
  BookOpen as IconBook,
  Calendar as IconCalendar,
  Camera as IconCamera,
  ChartColumn as IconChart,
  Check as IconCheck,
  ChevronDown as IconChevronD,
  ChevronRight as IconChevronR,
  ChevronUp as IconChevronUp,
  CircleAlert as IconAlert,
  Clipboard as IconClipboard,
  Clock as IconClock,
  Crown as IconCrown,
  Droplet as IconDroplet,
  Dumbbell as IconDumbbell,
  Ellipsis as IconMore,
  EllipsisVertical as IconMore_v,
  Flame as IconFlame,
  Grid3x3 as IconGrid,
  Heart as IconHeart,
  HeartPulse as IconHealth,
  House as IconHome,
  Info as IconInfo,
  Layers as IconLayers,
  List as IconList,
  ListFilter as IconFilter,
  Lock as IconLock,
  LogOut as IconLogout,
  Mail as IconMail,
  Medal as IconMedal,
  MessageCircle as IconMessage,
  Minus as IconMinus,
  Pause as IconPause,
  Pencil as IconEdit,
  Play as IconPlay,
  Plus as IconPlus,
  Search as IconSearch,
  Settings as IconSettings,
  Sparkles as IconSparkles,
  StickyNote as IconNote,
  Tag as IconTag,
  Target as IconTarget,
  Timer as IconTimer,
  Trash2 as IconTrash,
  TrendingUp as IconTrending,
  TriangleAlert as IconWarning,
  User as IconUser,
  Users as IconUsers,
  X as IconX,
  Zap as IconBolt,
} from "lucide-react-native";

export {
  IconAlert,
  IconApple,
  IconArrowR,
  IconArrowUp,
  IconBack,
  IconBarcode,
  IconBell,
  IconBolt,
  IconBook,
  IconCalendar,
  IconCamera,
  IconChart,
  IconCheck,
  IconChevronD,
  IconChevronR,
  IconChevronUp,
  IconClipboard,
  IconClock,
  IconCrown,
  IconDroplet,
  IconDumbbell,
  IconEdit,
  IconFilter,
  IconFlame,
  IconGrid,
  IconHealth,
  IconHeart,
  IconHome,
  IconInfo,
  IconLayers,
  IconList,
  IconLock,
  IconLogout,
  IconMail,
  IconMedal,
  IconMessage,
  IconMinus,
  IconMore,
  IconMore_v,
  IconNote,
  IconPause,
  IconPlay,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSparkles,
  IconSwap,
  IconTag,
  IconTarget,
  IconTimer,
  IconTrash,
  IconTrending,
  IconUser,
  IconUsers,
  IconWarning,
  IconX,
};

// Alias per design-source/icons.jsx:51 — IconFire is IconFlame.
export { IconFlame as IconFire };

// ────────────────────────────────────────────────────────────
// Defaults (STORY-008 AC 8.4 + 8.5)
// ────────────────────────────────────────────────────────────

/**
 * Standardised icon sizes matching the prototype's `<Ico size={...}>` usage.
 * No free-floating icon size values are permitted in primitive code — pick
 * from this scale.
 */
export type IconSize = 14 | 16 | 18 | 20 | 22 | 24;

/**
 * Default stroke widths. Lucide's own default is 2; the prototype renders
 * unselected icons lighter (1.75) and emphasised/selected icons at 2.
 */
export const ICON_STROKE = {
  /** Unselected / resting state. */
  default: 1.75,
  /** Selected / emphasised state. */
  active: 2,
} as const;

/**
 * Default icon colour. `currentColor` lets the parent primitive
 * (`<TabBar>`, `<Btn>`, `<IconBtn>`, …) drive colour via the passed
 * `color` prop / Tamagui token theming.
 */
export const ICON_COLOR_DEFAULT = "currentColor";

/**
 * Shared default props for a Lucide icon rendered inside a primitive.
 * Spread onto an icon element to apply the resting-state defaults:
 *   <IconHome {...iconDefaults()} />
 *   <IconHome {...iconDefaults({ size: 24, active: true })} />
 */
export function iconDefaults(opts?: { size?: IconSize; active?: boolean }) {
  return {
    size: opts?.size ?? 22,
    strokeWidth: opts?.active ? ICON_STROKE.active : ICON_STROKE.default,
    color: ICON_COLOR_DEFAULT,
  } as const;
}
