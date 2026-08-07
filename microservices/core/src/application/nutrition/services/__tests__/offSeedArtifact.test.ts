import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mapOffProductToFood, type OffProduct } from "../offMapper";

function findFromRoot(relativePath: string): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    const candidate = resolve(dir, relativePath);
    if (existsSync(candidate)) return candidate;
    dir = resolve(dir, "..");
  }
  throw new Error(`Could not locate ${relativePath}`);
}

describe("committed OFF seed trust boundary", () => {
  it("projects kJ and quality signals from the Parquet schema", () => {
    const script = readFileSync(
      findFromRoot("packages/seed/src/refreshOffDump.sh"),
      "utf8",
    )
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");

    expect(script).toContain("'energy-kj_100g'");
    expect(script).toContain("data_quality_info_tags AS data_quality_tags");
    expect(script).toContain("data_quality_errors_tags");
    expect(script).toContain("data_quality_warnings_tags");
  });

  it("contains the audited products with corrected, quarantined energy", async () => {
    const expected = new Map([
      ["01851960", 203.3],
      ["5018605966459", 357.1],
      ["9555387101471", 291.7],
    ]);
    const found = new Map<string, ReturnType<typeof mapOffProductToFood>>();
    const input = createReadStream(
      findFromRoot("packages/seed/data/off-uk.jsonl.gz"),
    ).pipe(createGunzip());
    const lines = createInterface({ input, crlfDelay: Infinity });

    for await (const line of lines) {
      const product = JSON.parse(line) as OffProduct;
      if (!product.code || !expected.has(product.code)) continue;
      found.set(product.code, mapOffProductToFood(product));
      if (found.size === expected.size) {
        lines.close();
        input.destroy();
        break;
      }
    }

    for (const [barcode, kcal] of expected) {
      expect(found.get(barcode)).toMatchObject({
        barcode,
        kcal,
        nutritionDataValid: false,
        nutritionDataIssue: "energy_mismatch",
      });
    }
  });
});
