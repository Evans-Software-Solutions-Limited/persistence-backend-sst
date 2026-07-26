import { aiEstimateErrorMessage } from "../aiErrorMessage";
import type { ApiError } from "@/shared/errors";

/**
 * These assertions encode the 2026-07-26 lesson: the copy must match the CAUSE.
 * A 30-day production outage (Bedrock model ungranted → 503) rendered as "try
 * rephrasing", so users were told to reword input that was never the problem —
 * and the real reason was invisible to everyone including the developer.
 */

function err(over: Partial<ApiError>): Pick<ApiError, "code" | "status"> {
  return { code: "server", ...over } as Pick<ApiError, "code" | "status">;
}

describe("aiEstimateErrorMessage", () => {
  // ── The regression that mattered ─────────────────────────────────────────
  describe("503 ai_unavailable (the outage case)", () => {
    it.each(["text", "photo"] as const)(
      "does NOT blame the user's %s input",
      (surface) => {
        const msg = aiEstimateErrorMessage(err({ status: 503 }), surface);
        expect(msg).toContain("temporarily unavailable");
        // The exact words that misled for a day.
        expect(msg).not.toMatch(/rephras/i);
        expect(msg).not.toMatch(/lighting|closer shot/i);
      },
    );
  });

  describe('422 ai_unreadable — the ONLY case where "try again differently" is true', () => {
    it("asks the user to reword, for text", () => {
      const msg = aiEstimateErrorMessage(err({ status: 422 }), "text");
      expect(msg).toMatch(/naming the foods and portions/i);
      // Concrete example beats abstract advice.
      expect(msg).toContain("2 fried eggs");
    });

    it("asks for a better photo, for photo", () => {
      expect(aiEstimateErrorMessage(err({ status: 422 }), "photo")).toMatch(
        /lighting|closer shot/i,
      );
    });
  });

  describe("statuses that are nothing to do with the input", () => {
    it("names the daily ceiling on 429 and does not say 'try again'", () => {
      const msg = aiEstimateErrorMessage(err({ status: 429 }), "text");
      expect(msg).toContain("Daily AI limit");
      expect(msg).toContain("resets tomorrow");
      // "Try again shortly" would be wrong for the rest of the day.
      expect(msg).not.toMatch(/try again/i);
    });

    // A 402 means the client gate and the server disagreed. Hiding it behind
    // generic copy is how an entitlement bug becomes unreportable.
    it("names the paywall on 402", () => {
      expect(aiEstimateErrorMessage(err({ status: 402 }), "text")).toMatch(
        /paid feature|upgrade/i,
      );
    });

    it("names an expired session on 401", () => {
      expect(aiEstimateErrorMessage(err({ status: 401 }), "photo")).toMatch(
        /session expired|sign in again/i,
      );
    });
  });

  describe("offline", () => {
    // Checked by `code`, not status: a request that never left the device has no
    // status at all, so a status-only switch would fall through to the generic
    // message and hide the one cause the user can actually fix.
    it.each(["network", "timeout"] as const)(
      "tells the user they are offline for code=%s, even with no status",
      (code) => {
        expect(aiEstimateErrorMessage({ code }, "text")).toMatch(
          /No connection/i,
        );
      },
    );

    it("prefers the offline message over a stale status", () => {
      expect(
        aiEstimateErrorMessage({ code: "network", status: 503 }, "text"),
      ).toMatch(/No connection/i);
    });
  });

  describe("fallback", () => {
    it.each([500, 418, undefined])(
      "stays non-committal about the cause for status=%s",
      (status) => {
        const msg = aiEstimateErrorMessage(err({ status }), "text");
        expect(msg).toContain("Something went wrong");
        // Must not invent a cause or blame the input.
        expect(msg).not.toMatch(/rephras|limit|upgrade|session/i);
      },
    );
  });

  // Both AI entry points live INSIDE the Quick Add sheet, so "use Quick Add
  // instead" told users to go where they already were. Every message must point
  // somewhere reachable.
  it("never advises using Quick Add, on any status or surface", () => {
    const statuses = [401, 402, 422, 429, 500, 503, undefined];
    for (const surface of ["text", "photo"] as const) {
      for (const status of statuses) {
        expect(aiEstimateErrorMessage(err({ status }), surface)).not.toMatch(
          /Quick Add/i,
        );
      }
      expect(aiEstimateErrorMessage({ code: "network" }, surface)).not.toMatch(
        /Quick Add/i,
      );
    }
  });
});
