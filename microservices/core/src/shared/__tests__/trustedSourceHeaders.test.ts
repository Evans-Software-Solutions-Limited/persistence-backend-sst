import { describe, expect, it } from "vitest";
import { trustedSourceHeaders } from "../trustedSourceHeaders";
describe("trusted Lambda client address", () => {
  it("replaces spoofed headers using HTTP API source IP", () => {
    expect(
      trustedSourceHeaders({
        headers: {
          "X-Persistence-Source-IP": "spoof",
          authorization: "Bearer test",
        },
        requestContext: { http: { sourceIp: "203.0.113.5" } },
      }).headers,
    ).toEqual({
      authorization: "Bearer test",
      "x-persistence-source-ip": "203.0.113.5",
    });
  });
  it("strips multi-value spoofed headers while preserving unrelated values", () => {
    const result = trustedSourceHeaders({
      headers: {},
      multiValueHeaders: {
        "X-Persistence-Source-IP": ["spoof"],
        accept: ["application/json"],
      },
      requestContext: { identity: { sourceIp: "203.0.113.8" } },
    });
    expect(result.multiValueHeaders).toEqual({ accept: ["application/json"] });
    expect(result.headers["x-persistence-source-ip"]).toBe("203.0.113.8");
  });
  it("supports REST source IP and never trusts forwarded headers", () => {
    expect(
      trustedSourceHeaders({
        requestContext: { identity: { sourceIp: "203.0.113.6" } },
      }).headers?.["x-persistence-source-ip"],
    ).toBe("203.0.113.6");
    expect(
      trustedSourceHeaders({
        headers: {
          "x-forwarded-for": "spoof",
          "x-persistence-source-ip": "spoof",
        },
      }).headers?.["x-persistence-source-ip"],
    ).toBe("unknown");
  });
});
