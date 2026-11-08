import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The Schema.org offers in index.html are what search results show as prices.
 * They are static, so nothing else updates them when the catalogue changes:
 * PER-103 found them still at the August prices (£16.99 / £29.99).
 * Keep in step with supabase/migrations/20261106120000_premium_without_ai.sql.
 */
function offers(): Record<string, string> {
  const html = readFileSync(resolve(__dirname, "../../index.html"), "utf8");
  const json = html.match(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
  );
  expect(json).not.toBeNull();
  const graph = JSON.parse(json![1]!)["@graph"] as {
    "@type": string;
    offers?: { name: string; price: string }[];
  }[];
  const app = graph.find((node) => node["@type"] === "MobileApplication");
  return Object.fromEntries(
    (app?.offers ?? []).map((offer) => [offer.name, offer.price]),
  );
}

describe("index.html structured data", () => {
  it("lists the PER-103 monthly prices", () => {
    expect(offers()).toEqual({
      Free: "0",
      Premium: "4.99",
      "Premium+": "24.99",
    });
  });
});
