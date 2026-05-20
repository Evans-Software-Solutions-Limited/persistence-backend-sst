/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Stripe SDK's webhook verifier. The handler imports a singleton
// via `getStripe()` and calls `.webhooks.constructEventAsync(...)` on it —
// we intercept that call so tests can assert on signature-verification
// behaviour without a real Stripe account or webhook secret.
const constructEventAsyncMock = vi.fn();

vi.mock("../stripeClient", () => ({
  getStripe: vi.fn(() => ({
    webhooks: {
      constructEventAsync: constructEventAsyncMock,
    },
  })),
  getStripeWebhookSecret: vi.fn(() => "whsec_test"),
  __resetStripeClientForTests: vi.fn(),
}));

// Repository is the dedup boundary — by mocking we can drive the
// duplicate-delivery path without standing up Postgres.
const repoClaimMock = vi.fn();
const repoReleaseMock = vi.fn();

vi.mock("../../repositories/stripeWebhookEventsRepository", () => ({
  StripeWebhookEventsRepository: vi.fn().mockImplementation(() => ({
    claim: repoClaimMock,
    release: repoReleaseMock,
  })),
}));

// Dispatch table — mock so tests can swap in throwing / spying handlers
// per-case. The real handlers are stubs in Phase 1; the next commit
// replaces them with subscriptionRepository-backed handlers.
const stubHandlerMock = vi.fn();
const resolveEventHandlerMock = vi.fn();

vi.mock("../eventHandlers", () => ({
  resolveEventHandler: (...args: unknown[]) => resolveEventHandlerMock(...args),
}));

function buildRequest({
  body = JSON.stringify({
    id: "evt_test",
    type: "customer.subscription.updated",
  }),
  signature = "t=1234,v1=abc",
}: {
  body?: string;
  signature?: string | null;
} = {}): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (signature !== null) headers["stripe-signature"] = signature;
  return new Request("http://localhost/stripe/webhook", {
    method: "POST",
    headers,
    body,
  });
}

const fakeEvent = {
  id: "evt_test",
  type: "customer.subscription.updated",
  data: { object: { id: "sub_123" } },
};

describe("handleStripeWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    constructEventAsyncMock.mockResolvedValue(fakeEvent);
    repoClaimMock.mockResolvedValue(true);
    repoReleaseMock.mockResolvedValue(undefined);
    resolveEventHandlerMock.mockReturnValue(stubHandlerMock);
    stubHandlerMock.mockResolvedValue(undefined);
  });

  describe("signature verification", () => {
    it("returns 400 when stripe-signature header is missing", async () => {
      const { handleStripeWebhook } = await import("../stripeWebhookHandler");
      const response = await handleStripeWebhook(
        buildRequest({ signature: null }),
      );
      expect(response.status).toBe(400);
      expect(constructEventAsyncMock).not.toHaveBeenCalled();
      expect(repoClaimMock).not.toHaveBeenCalled();
    });

    it("returns 400 when Stripe SDK throws on signature verification", async () => {
      constructEventAsyncMock.mockRejectedValueOnce(
        new Error("Invalid signature"),
      );
      const { handleStripeWebhook } = await import("../stripeWebhookHandler");
      const response = await handleStripeWebhook(buildRequest());
      expect(response.status).toBe(400);
      expect(repoClaimMock).not.toHaveBeenCalled();
    });

    it("passes the raw body + signature header + secret to constructEventAsync", async () => {
      const rawBody =
        '{"id":"evt_test","type":"customer.subscription.updated"}';
      const { handleStripeWebhook } = await import("../stripeWebhookHandler");
      await handleStripeWebhook(
        buildRequest({ body: rawBody, signature: "t=1234,v1=abc" }),
      );
      expect(constructEventAsyncMock).toHaveBeenCalledWith(
        rawBody,
        "t=1234,v1=abc",
        "whsec_test",
      );
    });
  });

  describe("idempotency", () => {
    it("inserts the event into the dedup log with event_id + type + payload", async () => {
      const { handleStripeWebhook } = await import("../stripeWebhookHandler");
      await handleStripeWebhook(buildRequest());
      expect(repoClaimMock).toHaveBeenCalledWith(
        "evt_test",
        "customer.subscription.updated",
        expect.objectContaining({ id: "evt_test" }),
      );
    });

    it("short-circuits with 200 + duplicate:true when the event was already processed", async () => {
      repoClaimMock.mockResolvedValueOnce(false);
      const { handleStripeWebhook } = await import("../stripeWebhookHandler");
      const response = await handleStripeWebhook(buildRequest());
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        received: boolean;
        duplicate?: boolean;
      };
      expect(body).toEqual({ received: true, duplicate: true });
      expect(stubHandlerMock).not.toHaveBeenCalled();
    });
  });

  describe("dispatch", () => {
    it("invokes the resolved handler with the verified event", async () => {
      const { handleStripeWebhook } = await import("../stripeWebhookHandler");
      await handleStripeWebhook(buildRequest());
      expect(resolveEventHandlerMock).toHaveBeenCalledWith(
        "customer.subscription.updated",
      );
      expect(stubHandlerMock).toHaveBeenCalledWith(fakeEvent);
    });

    it("returns 200 + received:true on successful dispatch", async () => {
      const { handleStripeWebhook } = await import("../stripeWebhookHandler");
      const response = await handleStripeWebhook(buildRequest());
      expect(response.status).toBe(200);
      const body = (await response.json()) as { received: boolean };
      expect(body.received).toBe(true);
    });

    it("returns 200 + handled:false when no handler is registered for the event type", async () => {
      resolveEventHandlerMock.mockReturnValueOnce(null);
      const { handleStripeWebhook } = await import("../stripeWebhookHandler");
      const response = await handleStripeWebhook(buildRequest());
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        received: boolean;
        handled?: boolean;
        reason?: string;
      };
      expect(body.handled).toBe(false);
      expect(body.reason).toBe("no_handler");
      // Important: we DO leave the claim in the dedup log — the row
      // doubles as an audit trail and prevents Stripe from retrying an
      // event we'll never act on.
      expect(repoReleaseMock).not.toHaveBeenCalled();
    });

    it("releases the dedup claim and returns 500 when the handler throws", async () => {
      stubHandlerMock.mockRejectedValueOnce(new Error("handler exploded"));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { handleStripeWebhook } = await import("../stripeWebhookHandler");
      const response = await handleStripeWebhook(buildRequest());

      expect(response.status).toBe(500);
      expect(repoReleaseMock).toHaveBeenCalledWith("evt_test");
      errorSpy.mockRestore();
    });

    it("returns 500 even when releasing the claim ALSO fails (best-effort release)", async () => {
      stubHandlerMock.mockRejectedValueOnce(new Error("handler exploded"));
      repoReleaseMock.mockRejectedValueOnce(new Error("db gone"));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { handleStripeWebhook } = await import("../stripeWebhookHandler");
      const response = await handleStripeWebhook(buildRequest());

      expect(response.status).toBe(500);
      // The handler should have logged both the release failure AND the
      // original dispatch failure — neither swallowed.
      const errorLogs = errorSpy.mock.calls.map((c) => String(c[0]));
      expect(errorLogs.some((m) => m.includes("failed to release"))).toBe(true);
      expect(errorLogs.some((m) => m.includes("handler"))).toBe(true);
      errorSpy.mockRestore();
    });
  });
});
