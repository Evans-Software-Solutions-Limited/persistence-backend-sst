import {
  activityDistanceFromMeters,
  activityDistanceToMeters,
  activityDistanceUnit,
  formatDurationInput,
  jumpDistanceFromMeters,
  jumpDistanceToMeters,
  jumpDistanceUnit,
  parseDurationInput,
} from "../activityUnits";

describe("activity units", () => {
  it("selects display labels for each unit system", () => {
    expect(activityDistanceUnit("metric")).toBe("km");
    expect(activityDistanceUnit("imperial")).toBe("mi");
    expect(jumpDistanceUnit("metric")).toBe("cm");
    expect(jumpDistanceUnit("imperial")).toBe("in");
  });

  it("round-trips metric and imperial activity distances", () => {
    expect(activityDistanceFromMeters(5000, "metric")).toBe(5);
    expect(activityDistanceToMeters(5, "metric")).toBe(5000);
    expect(activityDistanceFromMeters(1609.344, "imperial")).toBeCloseTo(1);
    expect(activityDistanceToMeters(1, "imperial")).toBeCloseTo(1609.344);
  });

  it("round-trips centimetres and inches for jumps", () => {
    expect(jumpDistanceFromMeters(0.6, "metric")).toBe(60);
    expect(jumpDistanceToMeters(60, "metric")).toBeCloseTo(0.6);
    expect(jumpDistanceFromMeters(0.6096, "imperial")).toBeCloseTo(24);
    expect(jumpDistanceToMeters(24, "imperial")).toBeCloseTo(0.6096);
  });

  it("parses minutes or mm:ss and rejects malformed time", () => {
    expect(parseDurationInput("25")).toBe(1500);
    expect(parseDurationInput("25:30")).toBe(1530);
    expect(parseDurationInput("25:99")).toBeNull();
    expect(parseDurationInput("")).toBeNull();
    expect(formatDurationInput(1530)).toBe("25:30");
  });
});
