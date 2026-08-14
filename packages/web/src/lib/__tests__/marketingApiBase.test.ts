import { afterEach, describe, expect, it, vi } from "vitest";
import { marketingApiBase } from "../marketingApiBase";

afterEach(() => vi.unstubAllEnvs());

describe("marketingApiBase", () => {
  it("prefers the WAF-fronted marketing edge when set", () => {
    vi.stubEnv("VITE_MARKETING_EDGE_URL", "https://edge.cloudfront.net");
    vi.stubEnv("VITE_CORE_API_URL", "https://api.example.com");
    expect(marketingApiBase()).toBe("https://edge.cloudfront.net");
  });

  it("falls back to the direct Core API URL when the edge is empty", () => {
    vi.stubEnv("VITE_MARKETING_EDGE_URL", "");
    vi.stubEnv("VITE_CORE_API_URL", "https://api.example.com");
    expect(marketingApiBase()).toBe("https://api.example.com");
  });

  it("strips trailing slashes so callers can append a path cleanly", () => {
    vi.stubEnv("VITE_MARKETING_EDGE_URL", "https://edge.cloudfront.net///");
    expect(marketingApiBase()).toBe("https://edge.cloudfront.net");
  });

  it("returns an empty string when neither var is set (dev/test)", () => {
    vi.stubEnv("VITE_MARKETING_EDGE_URL", "");
    vi.stubEnv("VITE_CORE_API_URL", "");
    expect(marketingApiBase()).toBe("");
  });
});
