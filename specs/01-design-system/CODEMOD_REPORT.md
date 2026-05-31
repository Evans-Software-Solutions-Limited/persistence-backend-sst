# 01 — Design System: Codemod dry-run report (STORY-006 AC 6.5)

> Deliverable for `requirements.md` STORY-006 AC 6.5 ("codemod run output committed
> with a count of replacements per file"). Generated 2026-05-31.

## Run

```
bun run scripts/codemod-tokens.ts --dry --dir packages/mobile/src
```

```
# codemod-tokens report (dry-run)
# dir: packages/mobile/src
# files scanned: 255
# files changed: 0
# total replacements: 0
```

## Why 0 replacements is the correct, expected result

The codemod only rewrites a hard-coded colour string when it sits in a
**token-resolvable position** — a Tamagui style prop where `$primary` / `$bg` /
`$gold` actually resolves at runtime. After auditing the tree, every remaining
hard-coded hex/rgba lives in a **concrete-colour consumer position** where a
Tamagui `$token` string would NOT resolve and would break rendering:

- React Native `StyleSheet.create({ ... })` bodies
- `expo-linear-gradient` `colors={[...]}` arrays
- `react-native-svg` `fill` / `stroke`
- lucide / Ionicons / `ActivityIndicator` `color`
- RN inline-style `shadowColor` / `backgroundColor` / `borderColor` object keys
- the `foundation/**` + `composite/**` RN/SVG colour-bridge constants
- the three lint-allow-listed legacy-screen files

The `no-raw-hex-colors` ESLint rule deliberately exempts exactly these positions
(see `packages/mobile/eslint-rules/no-raw-hex-colors.js`), and the codemod's skip
logic is kept in lockstep with it. So the codemod rewriting 0 strings is the
designed outcome, not a miss — rewriting any of them would emit an unparseable
`$token` into a non-Tamagui consumer and break the UI at runtime.

## How colour adoption was actually achieved

Palette adoption did NOT come from a hex→token sweep. It came from the
**theme-bridge** (STORY-007 Lever 1): `homeLegacyTheme.Colors` was re-pointed to
the new handoff palette, and the other three `*LegacyTheme` shims funnel through
it — so every legacy screen's colours refreshed to the V2 palette with zero
per-screen edits. See `packages/mobile/src/ui/theme/homeLegacyTheme.ts`.

## What the codemod + lint rule are for going forward

They ship as the permanent **guard-rail**: any NEW raw hex added in a
token-resolvable position fails `bun run lint`, and the codemod can migrate it in
one pass if a future change introduces tokenisable hex. They are not a one-time
sweep — they are standing enforcement.

## Retirement

The four `*LegacyTheme` files (the only remaining sanctioned home for legacy hex,
allow-listed in the lint config) are deleted in `12-production-readiness`
Phase 12.1, at which point the allow-list entries are removed too.
