# 01 — Design System: Design

> **Spec rewritten from scratch on 2026-05-27.** Mirrors the May 2026 design package at `~/Downloads/handoff/`. Pairs with `requirements.md` (same date).

---

## Architecture overview

The design system is a flat library of token + primitive exports under `packages/mobile/src/ui/` with no domain coupling. Every other spec composes against it.

```
packages/mobile/src/ui/
├── theme/
│   ├── tokens.ts           ← drop-in of ~/Downloads/handoff/tokens.tamagui.ts
│   ├── fonts.ts            ← Geist + Geist Mono Tamagui config
│   ├── tamagui.config.ts   ← createTamagui({ tokens, fonts, animations, themes })
│   ├── legacy/             ← homeLegacyTheme, workoutsLegacyTheme, subscriptionLegacyTheme, profileLegacyTheme (kept until M11 Polish)
│   └── __tests__/
├── components/
│   ├── foundation/         ← 12 primitives from STORY-003
│   │   ├── Card.tsx
│   │   ├── Btn.tsx
│   │   ├── Pill.tsx
│   │   ├── IconBtn.tsx
│   │   ├── Avatar.tsx
│   │   ├── Bar.tsx
│   │   ├── Ring.tsx        ← exports both Ring and MultiRing
│   │   ├── Stat.tsx
│   │   ├── Segmented.tsx
│   │   ├── TabBar.tsx
│   │   ├── HeaderBar.tsx
│   │   ├── BottomSheet.tsx
│   │   └── __tests__/
│   ├── composite/          ← 10 primitives from STORY-004
│   │   ├── Section.tsx
│   │   ├── DrawerRow.tsx
│   │   ├── MicroPill.tsx
│   │   ├── RingLegend.tsx
│   │   ├── PRCard.tsx
│   │   ├── SummaryChip.tsx
│   │   ├── ClientRow.tsx
│   │   ├── WorkoutCarouselCard.tsx
│   │   ├── HabitTile.tsx
│   │   ├── SearchBar.tsx
│   │   └── __tests__/
│   ├── icons.ts            ← lucide-react-native re-exports under IconXxx names
│   └── index.ts            ← barrel
└── dev/                    ← __DEV__-only smoke-test routes (see § Smoke-test routes)
```

Existing domain folders (`packages/mobile/src/ui/components/workouts/`, `session/`, `home/`, etc.) stay in place. The adoption sweep (STORY-007) rewires their internals to consume the new primitives, but leaves the folder organisation alone.

---

## Token reference

Source: `~/Downloads/handoff/tokens.tamagui.ts` (drop-in verbatim). Contrast ratios computed against `$bg #0A0B12`.

### Colour

| Token                   | Hex                      | Contrast   | Use                                  |
| ----------------------- | ------------------------ | ---------- | ------------------------------------ |
| `$bg`                   | `#0A0B12`                | —          | Root screen background               |
| `$surface`              | `#12141D`                | —          | Base card                            |
| `$surface2`             | `#1A1D29`                | —          | Elevated card                        |
| `$surface3`             | `#232735`                | —          | Input fields, drawer body            |
| `$surface4`             | `#2D3243`                | —          | Modal headers, segmented active fill |
| `$surface5`             | `#3A4055`                | —          | Overlays                             |
| `$text`                 | `#F4F4F8`                | **17.8:1** | Primary text                         |
| `$text2`                | `#C2C2CE`                | **9.4:1**  | Secondary text                       |
| `$text3`                | `#8A8A98`                | **4.8:1**  | Eyebrow / metadata (AA floor)        |
| `$text4`                | `#5C5C68`                | 3.0:1      | Disabled — non-text only             |
| `$text5`                | `#383841`                | —          | Hairlines                            |
| `$border`               | `rgba(255,255,255,0.06)` | —          | Default 1pt borders                  |
| `$border2`              | `rgba(255,255,255,0.10)` | —          | Emphasised borders                   |
| `$border3`              | `rgba(255,255,255,0.16)` | —          | Drag handles                         |
| `$primary`              | `#22D3EE`                | **10.1:1** | Brand cyan (athlete)                 |
| `$primaryBright`        | `#67E8F9`                | 12.5:1     | Loud highlight                       |
| `$primary7`             | `#0E7490`                | —          | Pressed / depth                      |
| `$primaryGlow`          | `rgba(34,211,238,0.22)`  | —          | Outer glow                           |
| `$primaryDim`           | `rgba(34,211,238,0.10)`  | —          | Soft fill background                 |
| `$primaryInk`           | `#042F39`                | —          | Text on solid primary                |
| `$gold` family          | `#F5C518` (base)         | **11.2:1** | PRs, achievements, milestones        |
| `$accentTrainer` family | `#A78BFA` (base)         | **7.4:1**  | Coach-mode accent                    |
| `$ember` family         | `#FB923C`                | 8.6:1      | Strain, calorie, urgency             |
| `$success`              | `#34D399`                | 10.3:1     | Positive state                       |
| `$warning`              | `#FBBF24`                | —          | Caution                              |
| `$error`                | `#F87171`                | —          | Destructive                          |
| `$info`                 | `#60A5FA`                | —          | Informational                        |

### Space (padding / margin / gap)

`$xxs 2 · $xs 4 · $sm 8 · $md 12 · $base 16 · $lg 20 · $xl 24 · $2xl 32 · $3xl 48 · $4xl 64`

### Size

Extends `space` plus: `$touchTarget 44 · $tabBarHeight 72 · $headerHeight 54 · $bottomPadding 140`.

### Radius

`$sm 6 · $md 10 · $lg 14 · $xl 20 · $2xl 28 · $pill 9999`

### Z-Index

`$0 0 · $sticky 10 · $tabBar 40 · $modal 90 · $drawer 100 · $sheet 120 · $toast 200`

### Fonts

```ts
$display: "Geist"; // weights 400–900, letter-spacing { tight, snug, normal, wide, eyebrow }
$body: "Geist"; // weights 400–600, line-height { tight, normal, relaxed }
$mono: "Geist Mono"; // weights 400–600, font-features ['tnum', 'zero']
```

Numeric display ALWAYS uses `$mono`. The `<Stat>` primitive and `<Text variant="stat-lg">` helper auto-apply `$mono` + `tnum`.

### Shadow

`card`, `glowPrimary`, `glowGold`, `glowTrainer`, `sheet` — per `tokens.tamagui.ts`.

---

## Foundation primitives — twelve PRs

Each primitive ports its `~/Downloads/handoff/design-source/ui.jsx` (or `tab-bar.jsx`) reference. Source line refs below.

### 1. `<Card>` — `ui.jsx:7–25`

```ts
// Re-export for downstream specs (referenced by 04 muscleToTone, 09 NotificationRow border, etc.)
export type CardAccent =
  | "primary"
  | "gold"
  | "trainer"
  | "ember"
  | "success"
  | "error";

type CardProps = {
  surface?: 0 | 1 | 2; // 0=$surface, 1=$surface2 (default), 2=$surface3
  pad?: number; // default 16
  radius?: number; // default 14
  glow?: "primary" | "gold" | "trainer";
  accent?: CardAccent; // tints border with $<accent>Dim — full 6-tone palette matching <Btn>
  onPress?: () => void;
  children: ReactNode;
  style?: ViewStyle;
};
```

Accent matches the full `<Btn>` tone palette so any spec that derives a tone from domain data (e.g. `muscleToTone` in `04-workout-management`, programme accent in `10-trainer-features`) can pass the same union to `<Card accent>` without a coercion step. `glow` stays narrower (`primary | gold | trainer`) because the glow ring is a stronger visual treatment reserved for the three primary brand accents.

With `onPress`: `<Pressable>` with default press feedback. Without: `<View>`. `glow` adds `0 0 0 1px $<glow>Dim, 0 8px 24px $<glow>Glow`.

### 2. `<Btn>` — `ui.jsx:117–139`

```ts
type BtnProps = {
  variant: "filled" | "outline" | "ghost" | "soft";
  tone: "primary" | "gold" | "trainer" | "ember" | "success" | "error";
  size?: "sm" | "md" | "lg"; // default 'md'; heights 36 / 44 / 52
  icon?: ReactNode;
  full?: boolean; // default false
  onPress: () => void;
  children: ReactNode;
  accessibilityLabel?: string;
};
```

Variant matrix per `ui.jsx:122–127`:

- `filled` — bg `$<tone>`, fg `$bg`, shadow `0 0 0 1px $<tone>Dim, 0 6px 20px $<tone>Glow`
- `outline` — transparent bg, 1.5pt `$<tone>` border, fg `$<tone>`
- `ghost` — transparent bg + border, fg `$<tone>`
- `soft` — bg `$<tone>Dim`, fg `$<tone>`

### 3. `<Pill>` — `ui.jsx:85–112`

```ts
type PillProps = {
  tone:
    | "neutral"
    | "primary"
    | "gold"
    | "trainer"
    | "ember"
    | "success"
    | "error";
  size?: "xs" | "sm" | "md"; // default 'sm'
  filled?: boolean;
  children: ReactNode;
};
```

`xs` 9.5pt, `sm` 10.5pt, `md` 12pt. Uppercase weight 600. **`whiteSpace: 'nowrap'` + `flexShrink: 0` mandatory** (prevents pill text from wrapping or compressing in dense rows).

### 4. `<IconBtn>` — `ui.jsx:255–275`

```ts
type IconBtnTone =
  | "neutral"
  | "ghost"
  | "primary"
  | "gold"
  | "trainer"
  | "ember"
  | "success"
  | "error";

type IconBtnProps = {
  icon: ReactNode;
  onPress?: () => void;
  tone?: IconBtnTone; // default 'neutral'. Matches <Btn>'s tone palette so screen authors don't need an ad-hoc `color?` escape hatch (e.g. delete-set IconBtn in 05 uses tone="error").
  size?: number; // default 36
  active?: boolean;
  accessibilityLabel?: string;
};
```

`event.stopPropagation()` baked into `onPress` handler. No `onPress` → renders as `<View>` (nested-pressable-safe). `tone` widening matches the sweep-4 `<Card accent>` extension to the full `<Btn>` palette — same rationale: any domain-derived tone (`muscleToTone` in 04, `noteTypeToTone` in 10, etc.) can be passed to `<IconBtn>` without coercion.

### 5. `<Avatar>` — `ui.jsx:205–234`

```ts
type AvatarProps = {
  initials: string;
  size?: number; // default 36
  tone?: "primary" | "gold" | "trainer"; // default 'primary'
  dot?: "success" | "warning" | "error"; // status dot, top-right
  badge?: string; // 'COACH' label, bottom-right
  onPress?: () => void;
  accessibilityLabel?: string; // defaults to `Avatar ${initials}`
};
```

Gradient bg `linear-gradient(135deg, $<tone>, $<tone>7)`, fg `$<tone>Ink`, font-size = `size × 0.36`. Two-ring border `0 0 0 2px $bg, 0 0 0 3.5px $border2`. COACH badge always uses `$accentTrainer` regardless of `tone`.

### 6. `<Bar>` — `ui.jsx:239–250`

```ts
type BarProps = {
  pct: number; // 0..1
  color?: string; // default $primary
  height?: number; // default 6
  track?: string; // default $surface3
  glow?: boolean;
};
```

Width animates via Reanimated 3 `withTiming` (600ms cubic-bezier `0.2, 0.7, 0.2, 1`). Respects `useReducedMotion()`.

### 7. `<Ring>` + `<MultiRing>` — `ui.jsx:31–80`

```ts
type RingProps = {
  pct: number; // 0..1
  size?: number; // default 80
  stroke?: number; // default 9
  color?: string; // default $primary
  track?: string; // default $surface3
  glow?: boolean;
  children?: ReactNode; // centre overlay
};

type MultiRingProps = {
  size?: number; // default 110
  stroke?: number; // default 11
  rings: { pct: number; color: string; track?: string }[]; // outer-first
  glow?: boolean; // default true
};
```

Fill animates via Reanimated 3 `useAnimatedProps` on `strokeDasharray` (800ms cubic-bezier `0.2, 0.7, 0.2, 1`). Respects `useReducedMotion()` — when reduced, jumps to final state. SVG via `react-native-svg`.

### 8. `<Stat>` — `ui.jsx:159–175`

```ts
type StatProps = {
  value: string | number;
  unit?: string;
  label?: string;
  trend?: number; // signed percent: > 0 → ▲ $success, < 0 → ▼ $error
  tone?: "text" | "primary" | "gold" | "trainer" | "ember"; // default 'text'
  size?: "md" | "lg" | "xl"; // default 'lg'; 20 / 28 / 40pt
  align?: "left" | "center";
  sub?: string;
};
```

ALWAYS renders `value` in `$mono` with `tnum` + `zero`. `unit` `$mono` 13pt. `trend` `$mono` 11pt.

### 9. `<Segmented>` — `tab-bar.jsx:88–115`

```ts
type SegmentedProps = {
  options: (string | { value: string; label: string })[]; // 2–5 options
  value: string;
  onChange: (value: string) => void;
  accent?: "primary" | "gold" | "trainer"; // default 'primary'
  size?: "sm" | "md"; // default 'md'
};
```

Equal-width inline-flex, `$surface2` bg, `$border` 1pt, `$md` radius. Active segment: `$surface4` fill + `0 0 0 1px $<accent>Dim` shadow ring. **2–5 options** per locked decision #9. Auto-scroll horizontally when ≥4 options on viewport `< 360pt`.

### 10. `<TabBar>` — `tab-bar.jsx:4–83`

```ts
type TabSpec = { id: string; icon: LucideIcon; label: string; badge?: string };

type TabBarProps = {
  tabs: TabSpec[]; // 3–5 tabs
  active: string;
  onChange: (id: string) => void;
  mode?: "athlete" | "coach"; // default 'athlete'
  floatingBtn?: ReactNode; // reserved
};
```

12pt left/right margin, `rgba(18,20,29,0.86)` bg, blur 24px saturate 140%, `$border2` 1pt border, 22pt radius, 8/4pt padding. Active pill 30×4pt above icon + accent glow. COACH chrome dot at `top: -10pt` when `mode === 'coach'`: `$accentTrainer` bg, `$bg` fg, 9.5pt eyebrow.

Detailed nav composition in `14-navigation`.

### 11. `<HeaderBar>` — `ui.jsx:180–200`

```ts
type HeaderBarProps = {
  title?: string;
  eyebrow?: string;
  sub?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  large?: boolean;
};
```

Compact: centred title 18pt + leading/trailing slots. Large: left-aligned eyebrow + display-lg title (32pt) + optional sub.

### 12. `<BottomSheet>` — `fuel-sheets.jsx:13–42` + `extra.jsx:7–25`

```ts
type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  eyebrow?: string;
  accent?: "primary" | "gold" | "trainer" | "ember";
  height?: number | "peek" | "default"; // peek=60%, default=78%
  children: ReactNode;
};
```

`@gorhom/bottom-sheet` v4 (snap points, gestures, backdrop, ESC). Backdrop blur 6px. Drag-handle 40×4pt `$border3`. Top corners 24pt radius. Children scroll, header fixed.

---

## Composite primitives — ten PRs

Each composite composes foundation primitives. Source line refs to `~/Downloads/handoff/design-source/`.

### 1. `<Section>` — `home.jsx:155` + `progress.jsx:61` + `ui.jsx:144`

```ts
type SectionProps = {
  eyebrow?: string;
  title?: string;
  action?: ReactNode;
  hideHr?: boolean;
  children?: ReactNode;
};
```

Header row `flex-direction: row; justify-content: space-between; align-items: flex-end`. Eyebrow `$text3` with `eyebrow` letterSpacing. Title `$display.lg` (24pt). Optional 1pt `$border` divider before children (unless `hideHr`).

### 2. `<DrawerRow>` — `extra.jsx:119`

```ts
type DrawerRowProps = {
  icon: ReactNode;
  title: string;
  sub?: string;
  trailing?: ReactNode;
  onPress?: () => void;
  loading?: boolean;
};
```

32×32 icon tile (`$md` radius, `$surface3` bg, `$text2` fg) + title/sub stack + trailing slot + `<IconChevronR>` 14pt. Row bg `$surface2`, border `$border` 1pt, `$md` radius, 10/12pt padding. `loading`: title/sub → animated skeleton blocks (54×12pt for title, 80×10pt for sub).

### 3. `<MicroPill>` — `home.jsx:137`

```ts
type MicroPillProps = {
  icon: ReactNode;
  value: string;
  label: string;
  tone: "primary" | "gold" | "trainer" | "ember" | "success" | "error";
};
```

Vertical stack: icon + `$mono` value + uppercase `$display.xs` label. Bg `$<tone>Dim`, border `$<tone>Dim`, 14pt padding, `$md` radius.

### 4. `<RingLegend>` — `home.jsx:122`

```ts
type RingLegendProps = {
  color: string;
  label: string;
  value: string;
  sub?: string;
  pct: number;
};
```

8pt circle dot + label + `$mono` value + percent + optional sub. Vertical stack inside TodayHero legend column.

### 5. `<PRCard>` — `home.jsx:341` + `progress.jsx:227`

```ts
type PRCardProps = {
  exerciseName: string;
  newValue: string; // e.g. "120 KG × 5"
  previousValue?: string; // strikethrough
  delta?: { value: number; unit: string };
  achievedAt: Date;
  loading?: boolean;
};
```

`<Card>` with `$goldDim` border + gold glow. `<IconMedal>` 18pt `$gold` top-right. Exercise name `$display.md`, `newValue` `$mono` 18pt, `previousValue` strikethrough `$text3` 12pt, delta `$mono` 11pt with `▲` prefix in `$success`.

### 6. `<SummaryChip>` — `extra.jsx:243`

```ts
type SummaryChipProps = {
  count: number;
  label: string;
  tone: "primary" | "gold" | "trainer" | "ember" | "success" | "error";
  onPress?: () => void;
};
```

`<Card>` `pad={12}` `$<tone>Dim` bg + border. `$mono` count 22pt `$<tone>` fg. Label `$body.xs` `$text2`. `flex: 1` so siblings share row.

### 7. `<ClientRow>` — `extra.jsx:257`

```ts
type ClientRowProps = {
  avatar: { initials: string; tone?: "primary" | "gold" | "trainer" };
  name: string;
  status?: "active" | "attention" | "pr" | "missed";
  tags?: string;
  lastSeen?: string;
  adherence?: number; // 0..100
  onPress?: () => void;
  isLast?: boolean;
  loading?: boolean;
};
```

Status badge mapping:

- `attention` → `<Pill tone="ember">2 missed</Pill>`
- `pr` → `<Pill tone="gold">NEW PR</Pill>`
- `missed` → `<Pill tone="error">{N} days idle</Pill>`
- `active` → null

Adherence bar colour: `$success` (>80), `$gold` (50–80), `$error` (<50). Trailing `<IconChevronR>` 14pt.

### 8. `<WorkoutCarouselCard>` — `home.jsx:197`

```ts
type WorkoutCarouselCardProps = {
  title: string;
  mins: number;
  sub: string;
  chips: string[];
  primary?: boolean;
  onPress?: () => void;
  loading?: boolean;
};
```

Fixed-width 260pt, 16pt padding, `$xl` radius (16). Default bg `$surface2`. `primary: true`: bg `linear-gradient(135deg, $primaryDim 0%, $surface2 60%)`, border `$primaryDim`. Header row: title `$display.h2` left + 34pt round play CTA (`$primary` bg, `$bg` fg, glow) right. Body: sub `$text2` 12.5pt min-height 36pt. Footer: timer pill + chip pills (`$xs` size, `neutral` tone).

### 9. `<HabitTile>` — `home.jsx:227 (inside HabitsGrid)`

```ts
type HabitTileProps = {
  state: "done" | "today" | "missed" | "locked";
  tone: "primary" | "gold" | "trainer" | "ember" | "success";
  label?: string;
  onPress?: () => void;
};
```

36×36 rounded square. States:

- `done` — `$<tone>` solid fill, `<IconCheck>` 14pt `$<tone>Ink`
- `today` — `$<tone>Dim` fill, dashed `$<tone>` border
- `missed` — `$surface3` fill, no border
- `locked` — `$surface3` fill, `$text4` border, no interactivity

Touch-target 44pt achieved by parent grid row padding when interactive.

### 10. `<SearchBar>` — `prototype-hubs.jsx (TrainExercisesContent)` + `extra.jsx (ClientsScreen)`

```ts
type SearchBarProps = {
  placeholder: string;
  value: string;
  onChangeText: (next: string) => void;
  onSubmit?: () => void;
  trailing?: ReactNode;
};
```

40pt height, `$surface2` bg, `$border` 1pt, `$md` radius. `<IconSearch>` 15pt `$text3` leading, `$body.sm` text. Internal padding 0/14pt.

---

## Codemod — `scripts/codemod-tokens.ts`

`jscodeshift` AST transform. Operates on `.ts`/`.tsx` under `packages/mobile/src/` excluding `theme/**` and `__tests__/fixtures/**`.

### Replacement table

| Pattern                               | Replacement      |
| ------------------------------------- | ---------------- |
| `'#00D4FF'`                           | `'$primary'`     |
| `'#FFFFFF'`, `'#FFF'`, `'white'`      | `'$text'`        |
| `'#FFD700'`, `'#FFC700'`              | `'$gold'`        |
| `'#0A0A0F'`, `'#0A0B12'`, `'#0B0B12'` | `'$bg'`          |
| `'rgba(0,212,255,A)'` where A ≤ 0.20  | `'$primaryDim'`  |
| `'rgba(0,212,255,A)'` where A > 0.20  | `'$primaryGlow'` |

Edge cases:

- Hex inside SVG `<Path fill="…">` → leave alone (icon migration handles).
- Hex inside test snapshots / fixtures → leave alone.
- Hex inside comments → leave alone.

### Execution

1. Dry-run: `bun run scripts/codemod-tokens.ts --dry > codemod-report.txt`. Review.
2. Apply: `bun run scripts/codemod-tokens.ts --apply`. One commit per top-level directory under `src/ui/`.
3. CI lint rule `no-raw-hex-colors` (custom ESLint) fails on hex literals outside `theme/` + allow-listed paths.

### Allow-list (until M11 Polish deletes them)

```
packages/mobile/src/ui/theme/legacy/{home,workouts,subscription,profile}LegacyTheme.ts
```

---

## Adoption sweep — methodology

Visit every file under `packages/mobile/src/ui/presenters/**` and `packages/mobile/src/ui/components/**` (excluding `foundation/`, `composite/`, `icons.ts`). Apply 1:1 shell replacement.

### Pattern → replacement table

| Legacy pattern                                                                       | New primitive                                                                      |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `<TouchableOpacity onPress={…}><Text>…</Text></TouchableOpacity>` (button-like)      | `<Btn variant={…} tone={…} onPress={…}>` (variant/tone inferred from legacy style) |
| `<View style={{ padding, borderRadius, borderWidth, backgroundColor }}>` (card-like) | `<Card>` with matching surface/pad/radius                                          |
| `<View><Text style={uppercase, small}>{badge}</Text></View>` (badge-like)            | `<Pill tone={…} size="xs">`                                                        |
| Circle gradient `<View>` with initials                                               | `<Avatar>`                                                                         |
| `<Ionicons name="…" />` / `<MaterialIcons />`                                        | Lucide via `~/ui/components/icons`                                                 |
| Manual stat number with `fontVariant: ['tabular-nums']`                              | `<Stat>` or `<Text variant="stat-lg">`                                             |

### Skipped

- Layout-shape changes (column → row, section reordering, hierarchy refactor). Owning spec.
- Animation refactors (Reanimated 1 → 3 worklet migration). Owning spec.
- Composite primitive composition (custom-row → DrawerRow, custom-card → PRCard, etc.). **Composite primitives are NOT force-fed** — STORY-007 AC 7.3.

### Marker comments

Each touched file gets a banner:

```ts
// [01-design-system adoption sweep YYYY-MM-DD]
// Foundation primitive shells swapped in: <Btn>, <Card>, <Pill>, <Avatar>, <Icon*>.
// Composite primitives + layout-shape changes deferred to owning spec.
```

One PR per touched top-level directory (`home/`, `workouts/`, `session/`, `subscription/`, `profile/`, presenters) to keep diffs reviewable.

---

## Lucide icon migration

Source: migration plan lines 460–513 + `design-source/icons.jsx`.

### `packages/mobile/src/ui/components/icons.ts`

```ts
import {
  Home as IconHome,
  Dumbbell as IconDumbbell,
  BarChart3 as IconChart,
  Flame as IconFlame,
  Apple as IconApple,
  User as IconUser,
  Users as IconUsers,
  BookOpen as IconBook,
  Grid3x3 as IconGrid,
  MoreHorizontal as IconMore,
  MoreVertical as IconMore_v,
  Zap as IconBolt,
  Medal as IconMedal,
  Crown as IconCrown,
  Plus as IconPlus,
  Minus as IconMinus,
  Barcode as IconBarcode,
  Camera as IconCamera,
  Droplet as IconDroplet,
  ChevronRight as IconChevronR,
  ChevronDown as IconChevronD,
  ArrowUp as IconArrowUp,
  ArrowRight as IconArrowR,
  Bell as IconBell,
  Search as IconSearch,
  Filter as IconFilter,
  Settings as IconSettings,
  LogOut as IconLogout,
  Check as IconCheck,
  Heart as IconHeart,
  Calendar as IconCalendar,
  Timer as IconTimer,
  Clipboard as IconClipboard,
  Layers as IconLayers,
  MessageCircle as IconMessage,
  ArrowLeftRight as IconSwap,
  X as IconX,
  HeartPulse as IconHealth,
  TrendingUp as IconTrending,
  Play as IconPlay,
  Pause as IconPause,
  Sparkles as IconSparkles,
  Target as IconTarget,
  Pencil as IconEdit,
  Info as IconInfo,
  ArrowLeft as IconBack,
  StickyNote as IconNote,
  Tag as IconTag,
} from "lucide-react-native";

export {
  IconHome,
  IconDumbbell,
  IconChart,
  IconFlame,
  IconApple,
  IconUser,
  IconUsers,
  IconBook,
  IconGrid,
  IconMore,
  IconMore_v,
  IconBolt,
  IconMedal,
  IconCrown,
  IconPlus,
  IconMinus,
  IconBarcode,
  IconCamera,
  IconDroplet,
  IconChevronR,
  IconChevronD,
  IconArrowUp,
  IconArrowR,
  IconBell,
  IconSearch,
  IconFilter,
  IconSettings,
  IconLogout,
  IconCheck,
  IconHeart,
  IconCalendar,
  IconTimer,
  IconClipboard,
  IconLayers,
  IconMessage,
  IconSwap,
  IconX,
  IconHealth,
  IconTrending,
  IconPlay,
  IconPause,
  IconSparkles,
  IconTarget,
  IconEdit,
  IconInfo,
  IconBack,
  IconNote,
  IconTag,
};
export { IconFlame as IconFire }; // alias per design-source/icons.jsx:51
```

### Defaults

```ts
type IconSize = 14 | 16 | 18 | 20 | 22 | 24;

// Default Lucide stroke 1.75 (matches prototype); active states 2.
<IconHome size={22} strokeWidth={1.75} color="currentColor" />
```

`color` defaults to `currentColor` so the parent (`<TabBar>`, `<Btn>`, etc.) sets the colour via Tamagui token theming.

### Sweep

All `@expo/vector-icons` and `Ionicons` references in `packages/mobile/src/ui/**` rewrite to `~/ui/components/icons`. Where Lucide has no equivalent: leave original + `TODO(01-design-system)` comment for owning spec.

---

## Smoke-test routes

Each primitive's render shape verified at `/dev/primitives/<name>`. Gated behind `__DEV__`.

### Layout

```
app/(dev)/primitives/
├── _layout.tsx
├── index.tsx            ← landing: list all 22 primitives
├── Card.tsx             ← inventory grid of every Card variant
├── Btn.tsx              ← 4 variants × 6 tones × 3 sizes = 72 buttons
├── … (one per primitive)
└── composites.tsx       ← one usage example of each composite (STORY-009 AC 9.4)
```

### Gating

```tsx
// app/(dev)/_layout.tsx
import { Redirect } from "expo-router";
export default function DevLayout() {
  if (!__DEV__) return <Redirect href="/" />;
  return <Stack />;
}
```

---

## Testing strategy

### Foundation + composite primitives

Each primitive ships with:

1. **Render tests** — every prop combination renders without throwing. Snapshot tests where reasonable.
2. **Interaction tests** — `onPress` fires, `accessibilityLabel` is set, `accessibilityState` reflects `disabled`/`active`/`loading`.
3. **A11y assertion** — every pressable variant exposes a label.

Composites additionally:

4. **Composition verification** — composite renders the expected foundation tree (e.g. `<DrawerRow>` snapshot includes `<IconBtn>` chevron).
5. **`loading: true` rendering** — skeleton blocks present.

### Codemod

1. **Unit tests** — every replacement rule + edge cases (hex in SVG, hex in test files, hex in comments).
2. **Idempotency** — running twice produces no diff on second pass.

### Adoption sweep

1. **Visual regression** — screenshots before + after per PR.
2. **Snapshot tests** on touched screens — component-tree shape preserved.

### Coverage

90% lines/branches/functions/statements per `_agent.md § Quality Gates`.

---

## Backend impact

**None.** This spec is mobile-only. No SST routes touched, no Drizzle migrations, no Supabase changes.

---

## Risks + mitigations

| Risk                                                                         | Mitigation                                                                                                                     |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Geist + Geist Mono bundle size adds ~250KB                                   | Measure after Phase 1.2. Variable-font slim build via `@expo-google-fonts/geist` variable export.                              |
| Reanimated 3 worklet API breakage                                            | Pin to known-stable version. Smoke-test routes verify `<Ring>` / `<MultiRing>` under `useReducedMotion()` both true and false. |
| `@gorhom/bottom-sheet` v4 Expo SDK 53 quirks                                 | Validate during `<BottomSheet>` PR. Fallback to Tamagui Sheet primitive if blocking.                                           |
| Adoption sweep creates a transitional clunky look                            | Owner-locked outcome (STORY-007 AC 7.4). Marker comments + screenshots in each sweep PR signal in-flight state.                |
| Codemod misses edge cases (hex in template literals, dynamic colour strings) | Dry-run report reviewed before apply. CI lint catches residuals.                                                               |
| Composite primitive discovered missing mid-implementation                    | Spec amendment here (revised-date append) + new primitive PR + screen work resumes. No deferral path (STORY-004 AC 4.7).       |

---

## Revised 2026-05-29: Lucide 1.x icon renames

The icon mapping table above (and the migration plan it mirrors) was authored against an older Lucide release. The SDK-55-compatible `lucide-react-native@1.17.0` (verified as the genuine published latest — SLSA provenance + OIDC trusted-publisher attestation, maintainer Eric Fennis, `lucide-icons/lucide` repo) renamed five icons and dropped the old-name aliases:

| Prototype alias (stable) | Old Lucide name | Lucide 1.x export |
| ------------------------ | --------------- | ----------------- |
| `IconHome`               | `Home`          | `House`           |
| `IconChart`              | `BarChart3`     | `ChartColumn`     |
| `IconMore`               | `MoreHorizontal`| `Ellipsis`        |
| `IconMore_v`             | `MoreVertical`  | `EllipsisVertical`|
| `IconFilter`             | `Filter`        | `ListFilter`      |

**Decision.** The prototype-facing `IconXxx` aliases are the contract downstream specs consume, so they stay byte-for-byte identical to the design.md table (`IconHome`, `IconChart`, `IconMore`, `IconMore_v`, `IconFilter`). Only the underlying Lucide import is updated to the 1.x export name. `icons.ts` therefore reads e.g. `import { House as IconHome } from "lucide-react-native"`. The visual result matches the prototype (these are the same glyphs, renamed upstream). All other 43 mappings are unchanged.

---

## Revised 2026-05-29: `@gorhom/bottom-sheet` v5 (not v4)

STORY-003 AC 3.6 + design.md § Foundation primitives #12 + tasks.md T-1.3.12 specify `@gorhom/bottom-sheet` **v4**. Implementation surfaced an incompatibility: v4 predates Reanimated-4 support, and this repo runs `react-native-reanimated@4.2.1` (+ `react-native-gesture-handler@2.31.1`, Expo SDK 55). The risk was already pre-flagged in design.md § Risks ("@gorhom/bottom-sheet v4 Expo SDK 53 quirks → fallback to Tamagui Sheet").

**Decision.** Use `@gorhom/bottom-sheet@5` (latest 5.2.x). Verified against the npm registry: v5 peer-declares `react-native-reanimated: ">=3.16.0 || >=4.0.0-"` and `react-native-gesture-handler: ">=2.16.1"`, both satisfied by our stack. The v4→v5 API surface the `<BottomSheet>` primitive relies on (`BottomSheet`/`BottomSheetModal`, `snapPoints`, `BottomSheetBackdrop`, `BottomSheetView`/`BottomSheetScrollView`, `enablePanDownToClose`) is unchanged. The Tamagui-Sheet fallback in the risk table is therefore not needed. The primitive's documented props (`visible`, `onClose`, `title`, `eyebrow`, `accent`, `height: 'peek' | 'default' | number`, scrolling children with a fixed header) are preserved exactly.

---

_End of `01-design-system/design.md` · 2026-05-27 (rewritten from scratch) · revised 2026-05-29 (Lucide 1.x renames; @gorhom/bottom-sheet v5)_
