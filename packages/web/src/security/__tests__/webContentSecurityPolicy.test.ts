import { describe, expect, it } from "vitest";
import { webConnectSrcOrigins } from "../webContentSecurityPolicy";

describe("webConnectSrcOrigins", () => {
  it("includes the configured Supabase origin used by admin auth", () => {
    expect(webConnectSrcOrigins("https://project-ref.supabase.co")).toContain(
      "https://project-ref.supabase.co",
    );
  });
});
