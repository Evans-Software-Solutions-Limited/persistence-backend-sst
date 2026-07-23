// Utility functions will be added per-feature

export { computeAge } from "./age";
export { initialsOf } from "./initials";
export {
  isIsoDateString,
  localDayISO,
  weekStartMondayISO,
  timeGreeting,
  addDaysISO,
  previousDayISO,
  loggedAtNoonUtc,
  dayLabel,
} from "./date";
export { newIdempotencyKey } from "./idempotency";
export {
  type VolumeUnit,
  ML_PER_CUP,
  LITRES_PER_CUP,
  cupsToLitres,
  litresToCups,
  formatLitres,
  preferredVolumeUnit,
} from "./water";
export {
  type WeightUnit,
  type HeightUnit,
  KG_PER_LB,
  CM_PER_INCH,
  kgToLb,
  lbToKg,
  weightInUnit,
  formatWeight,
  volumeInUnit,
  formatVolumeParts,
  formatVolume,
  cmToFeetInches,
  formatHeight,
} from "./units";
