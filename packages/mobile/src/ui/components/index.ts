// ─────────────────────────────────────────────────────────────────────────
// LEGACY UI COMPONENTS
//
// These are the pre-design-system components. The 01-design-system spec ships
// replacements under `@/ui/components/foundation/*` (Card, Btn, Pill, IconBtn,
// Avatar, Bar, Ring, Stat, Segmented, TabBar, HeaderBar, BottomSheet) and
// `@/ui/components/composite/*` (Section, DrawerRow, MicroPill, RingLegend,
// PRCard, SummaryChip, ClientRow, WorkoutCarouselCard, HabitTile, SearchBar).
//
// NEW screen work should compose the foundation/composite primitives, NOT
// these. Direct 1:1 replacements:
//   Button → foundation/Btn      Card → foundation/Card
//   Avatar → foundation/Avatar   Badge → foundation/Pill
//   Input (search) / ExerciseFilterBar → composite/SearchBar
//   Skeleton stays (used by the primitives' loading states).
//
// These legacy components + the `*LegacyTheme` shims are retired in M11 Polish
// (12-production-readiness) once no screen imports them. See each file's
// @deprecated JSDoc for its specific replacement.
// ─────────────────────────────────────────────────────────────────────────

export { ErrorBoundary } from "./ErrorBoundary";
export { Screen } from "./Screen";
export { Row } from "./Row";
export { Column } from "./Column";
export { Spacer } from "./Spacer";
export { Text } from "./Text";
export { Button } from "./Button";
export { Card } from "./Card";
export { Input } from "./Input";
export { LoadingSpinner } from "./LoadingSpinner";
export { Skeleton } from "./Skeleton";
export { EmptyState } from "./EmptyState";
export { ErrorState } from "./ErrorState";
export { Badge } from "./Badge";
export { Divider } from "./Divider";
export { Avatar } from "./Avatar";
export { OAuthButton } from "./OAuthButton";
export { PLogoDrawLoader } from "./PLogoDrawLoader";
export { ExerciseCard } from "./ExerciseCard";
export { ExerciseFilterBar } from "./ExerciseFilterBar";
export { MuscleGroupPicker } from "./MuscleGroupPicker";
export { ComingSoon } from "./ComingSoon";
