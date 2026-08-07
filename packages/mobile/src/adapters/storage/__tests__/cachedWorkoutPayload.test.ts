import { parseCachedWorkoutPayload } from "@/adapters/storage/sqlite.adapter";

describe("parseCachedWorkoutPayload", () => {
  it("returns a valid cached workout payload", () => {
    const workout = { id: "workout-1", name: "Push" };

    expect(parseCachedWorkoutPayload(JSON.stringify(workout))).toEqual(workout);
  });

  it("returns null instead of throwing for malformed cache data", () => {
    expect(parseCachedWorkoutPayload("{not-json")).toBeNull();
  });
});
