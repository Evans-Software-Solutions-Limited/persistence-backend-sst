import { newIdempotencyKey } from "../idempotency";

describe("newIdempotencyKey", () => {
  it("prefixes the key with the given scope", () => {
    expect(newIdempotencyKey("sub-create")).toMatch(/^sub-create-/);
    expect(newIdempotencyKey("sub-cancel")).toMatch(/^sub-cancel-/);
  });

  it("produces a distinct key on each call (one token per attempt)", () => {
    const keys = new Set(
      Array.from({ length: 200 }, () => newIdempotencyKey("sub-create")),
    );
    expect(keys.size).toBe(200);
  });

  it("embeds a timestamp segment so keys are roughly ordered + traceable", () => {
    const before = Date.now();
    const key = newIdempotencyKey("sub-create");
    const after = Date.now();
    // Shape: `${scope}-${epochMillis}-${rand}` → the numeric middle segment.
    const ts = Number(key.split("-")[2]);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});
