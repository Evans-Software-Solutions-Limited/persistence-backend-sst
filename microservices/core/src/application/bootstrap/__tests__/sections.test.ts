import { describe, expect, it } from "vitest";
import {
  BOOTSTRAP_SECTIONS,
  isBootstrapSection,
  parseInclude,
} from "../sections";

describe("parseInclude", () => {
  it("returns every section when include is absent or blank", () => {
    expect(parseInclude(undefined)).toEqual({
      ok: true,
      sections: BOOTSTRAP_SECTIONS,
    });
    expect(parseInclude("  ")).toEqual({
      ok: true,
      sections: BOOTSTRAP_SECTIONS,
    });
  });

  it("keeps canonical order, trims and de-duplicates known keys", () => {
    expect(parseInclude("tiers, home ,home,profile")).toEqual({
      ok: true,
      sections: ["home", "profile", "tiers"],
    });
  });

  it("rejects unknown keys and names them", () => {
    expect(parseInclude("home,nope,also")).toEqual({
      ok: false,
      unknown: ["nope", "also"],
    });
    expect(isBootstrapSection("home")).toBe(true);
    expect(isBootstrapSection("Home")).toBe(false);
  });
});
