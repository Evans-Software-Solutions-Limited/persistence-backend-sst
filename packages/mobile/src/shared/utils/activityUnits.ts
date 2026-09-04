export type PreferredUnits = "metric" | "imperial";

const METERS_PER_MILE = 1609.344;
const METERS_PER_INCH = 0.0254;

export function activityDistanceUnit(units: PreferredUnits): "km" | "mi" {
  return units === "imperial" ? "mi" : "km";
}

export function jumpDistanceUnit(units: PreferredUnits): "cm" | "in" {
  return units === "imperial" ? "in" : "cm";
}

export function activityDistanceFromMeters(
  meters: number,
  units: PreferredUnits,
): number {
  return units === "imperial" ? meters / METERS_PER_MILE : meters / 1000;
}

export function activityDistanceToMeters(
  value: number,
  units: PreferredUnits,
): number {
  return units === "imperial" ? value * METERS_PER_MILE : value * 1000;
}

export function jumpDistanceFromMeters(
  meters: number,
  units: PreferredUnits,
): number {
  return units === "imperial" ? meters / METERS_PER_INCH : meters * 100;
}

export function jumpDistanceToMeters(
  value: number,
  units: PreferredUnits,
): number {
  return units === "imperial" ? value * METERS_PER_INCH : value / 100;
}

export function formatDurationInput(seconds: number | null): string {
  if (seconds == null) return "";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

export function parseDurationInput(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10) * 60;
  const match = /^(\d+):([0-5]\d)$/.exec(trimmed);
  if (!match) return null;
  return Number.parseInt(match[1], 10) * 60 + Number.parseInt(match[2], 10);
}
