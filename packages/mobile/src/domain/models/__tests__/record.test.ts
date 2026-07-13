import { isWeightRecordType, RECORD_TYPES, unitForRecordType } from "../record";

describe("unitForRecordType", () => {
  it("maps the weight record types to kg by default", () => {
    for (const t of [
      "1rm",
      "3rm",
      "5rm",
      "10rm",
      "max_weight",
      "max_volume",
    ] as const) {
      expect(unitForRecordType(t)).toBe("kg");
    }
  });

  it("maps the weight record types to the given weightUnit", () => {
    for (const t of [
      "1rm",
      "3rm",
      "5rm",
      "10rm",
      "max_weight",
      "max_volume",
    ] as const) {
      expect(unitForRecordType(t, "lb")).toBe("lb");
    }
  });

  it("maps count/time/distance types to their own unit regardless of weightUnit", () => {
    expect(unitForRecordType("max_reps")).toBe("reps");
    expect(unitForRecordType("best_time")).toBe("s");
    expect(unitForRecordType("longest_distance")).toBe("m");
    expect(unitForRecordType("max_reps", "lb")).toBe("reps");
    expect(unitForRecordType("best_time", "lb")).toBe("s");
    expect(unitForRecordType("longest_distance", "lb")).toBe("m");
  });

  it("returns a unit for every known record type", () => {
    for (const t of RECORD_TYPES) {
      expect(unitForRecordType(t)).toMatch(/^(kg|reps|s|m)$/);
      expect(unitForRecordType(t, "lb")).toMatch(/^(lb|reps|s|m)$/);
    }
  });
});

describe("isWeightRecordType", () => {
  it("is true for the weight record types", () => {
    for (const t of [
      "1rm",
      "3rm",
      "5rm",
      "10rm",
      "max_weight",
      "max_volume",
    ] as const) {
      expect(isWeightRecordType(t)).toBe(true);
    }
  });

  it("is false for count/time/distance types", () => {
    expect(isWeightRecordType("max_reps")).toBe(false);
    expect(isWeightRecordType("best_time")).toBe(false);
    expect(isWeightRecordType("longest_distance")).toBe(false);
  });
});
