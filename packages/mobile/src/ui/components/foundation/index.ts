// Foundation primitives barrel (01-design-system STORY-003).
// Primitives are added here as each lands in its own PR (port order:
// Card -> Btn -> Pill -> IconBtn -> Avatar -> Bar -> Ring/MultiRing -> Stat
// -> Segmented -> TabBar -> HeaderBar -> BottomSheet).

export { Card } from "./Card";
export type { CardProps, CardAccent, CardGlow } from "./Card";
export { Btn } from "./Btn";
export type { BtnProps, BtnVariant, BtnTone, BtnSize } from "./Btn";
export { Pill } from "./Pill";
export type { PillProps, PillSize } from "./Pill";
export { IconBtn, iconBtnForeground } from "./IconBtn";
export type { IconBtnProps, IconBtnTone } from "./IconBtn";
export { Avatar } from "./Avatar";
export type { AvatarProps, AvatarTone, AvatarDot } from "./Avatar";
export { Bar } from "./Bar";
export type { BarProps } from "./Bar";
export { Ring, MultiRing } from "./Ring";
export type { RingProps, MultiRingProps, MultiRingSpec } from "./Ring";
export { Stat } from "./Stat";
export type { StatProps, StatTone, StatSize, StatAlign } from "./Stat";
export { Segmented } from "./Segmented";
export type {
  SegmentedProps,
  SegmentedOption,
  SegmentedAccent,
  SegmentedSize,
} from "./Segmented";
export { TabBar } from "./TabBar";
export type { TabBarProps, TabSpec, TabBarMode, TabBarIcon } from "./TabBar";
export { HeaderBar } from "./HeaderBar";
export type { HeaderBarProps } from "./HeaderBar";
export { BottomSheet } from "./BottomSheet";
export type {
  BottomSheetProps,
  BottomSheetAccent,
  BottomSheetHeight,
} from "./BottomSheet";
export { Field } from "./Field";
export type { FieldProps } from "./Field";
export { Stepper } from "./Stepper";
export type { StepperProps } from "./Stepper";
export { RepRange } from "./RepRange";
export type { RepRangeProps } from "./RepRange";
export {
  toneTokens,
  TONE_TOKENS,
  toneHex,
  TONE_HEX,
  NEUTRAL_HEX,
} from "./tones";
export type { Tone, PillTone } from "./tones";
