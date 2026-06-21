import { RECORD_TYPES, unitForRecordType } from "../record";

describe("unitForRecordType", () => {
  it("maps the weight record types to kg", () => {
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

  it("maps count/time/distance types to their own unit", () => {
    expect(unitForRecordType("max_reps")).toBe("reps");
    expect(unitForRecordType("best_time")).toBe("s");
    expect(unitForRecordType("longest_distance")).toBe("m");
  });

  it("returns a unit for every known record type", () => {
    for (const t of RECORD_TYPES) {
      expect(unitForRecordType(t)).toMatch(/^(kg|reps|s|m)$/);
    }
  });
});
