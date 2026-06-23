import { describe, it, expect, vi } from "vitest";
import { parseNdjson, runOffDeltaRefresh } from "../offDelta";

const product = (code: string) =>
  JSON.stringify({
    code,
    product_name: `P${code}`,
    nutriments: {
      "energy-kcal_100g": 100,
      proteins_100g: 5,
      carbohydrates_100g: 10,
      fat_100g: 2,
    },
  });

describe("parseNdjson", () => {
  it("parses one-object-per-line, skipping blanks + malformed tail", () => {
    const text = `${product("1")}\n\n${product("2")}\n{ broken`;
    expect(parseNdjson(text)).toHaveLength(2);
  });
});

describe("runOffDeltaRefresh", () => {
  it("processes only the most-recent maxFiles, maps + batches the upserts", async () => {
    const upsert = vi.fn(async (rows: unknown[]) => rows.length);
    const summary = await runOffDeltaRefresh({
      listDeltaFiles: async () => ["old.jsonl.gz", "new.jsonl.gz"],
      fetchDeltaNdjson: async (f) =>
        f === "new.jsonl.gz" ? `${product("1")}\n${product("2")}` : "",
      upsert,
      maxFiles: 1,
      batchSize: 1,
    });
    expect(summary.files).toBe(1);
    expect(summary.parsed).toBe(2);
    expect(summary.mapped).toBe(2);
    expect(summary.upserted).toBe(2);
    // batchSize 1 → two upsert calls
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it("drops products that fail the mapper filter", async () => {
    const upsert = vi.fn(async (rows: unknown[]) => rows.length);
    const summary = await runOffDeltaRefresh({
      listDeltaFiles: async () => ["d.jsonl.gz"],
      fetchDeltaNdjson: async () =>
        `${product("1")}\n${JSON.stringify({ product_name: "no barcode" })}`,
      upsert,
    });
    expect(summary.parsed).toBe(2);
    expect(summary.mapped).toBe(1);
    expect(summary.upserted).toBe(1);
  });
});
