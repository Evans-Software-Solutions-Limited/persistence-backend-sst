/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  generateClientSummary,
  resolveSummaryModelId,
  ClientSummaryUnavailableError,
  type ClientSummaryInput,
  type MinimalBedrockClient,
  getDefaultClient,
  resetDefaultClientForTests,
} from "../clientSummaryAi";

const INPUT: ClientSummaryInput = {
  clientName: "Jane Doe",
  coversDate: "2026-07-07",
  adherence: { overall: 82, band: "strong" },
  prs: [{ exerciseName: "Bench", type: "1rm", value: 100, unit: "kg" }],
  volume: { weekKg: 12400 },
  calorieHit: { targetKcal: 2000, daysHit: 4, daysLogged: 6, todayKcal: 500 },
  goal: {
    title: "Lose weight",
    assignedByCoach: true,
    startKg: 90,
    nowKg: 85,
    targetKg: 80,
    pct: 0.5,
  },
  habits: {
    collectionStreak: 3,
    collectionSatisfied: false,
    items: [{ label: "Water", met: true }],
  },
  thisWeek: { workoutsCompleted: 3, workoutsPlanned: 4, prs: 1 },
};

function toolResponse(summary: unknown) {
  return {
    stop_reason: "tool_use",
    content: [{ type: "tool_use", name: "report_summary", input: { summary } }],
  };
}

function fakeClient(
  create: MinimalBedrockClient["messages"]["create"],
): MinimalBedrockClient {
  return { messages: { create } };
}

describe("generateClientSummary", () => {
  it("returns the trimmed summary text from the forced tool block", async () => {
    const create = vi.fn(async () =>
      toolResponse("  Solid week. Focus: protein.  "),
    );
    const out = await generateClientSummary(INPUT, {
      client: fakeClient(create as any),
    });
    expect(out).toBe("Solid week. Focus: protein.");
  });

  it("forces tool use and passes the resolved model + summary tool", async () => {
    const create = vi.fn(async () => toolResponse("ok"));
    await generateClientSummary(INPUT, { client: fakeClient(create as any) });
    const params = (create as any).mock.calls[0][0];
    expect(params.tool_choice).toEqual({
      type: "tool",
      name: "report_summary",
    });
    expect(params.tools[0].name).toBe("report_summary");
    expect(params.model).toBe(resolveSummaryModelId());
    // The client's structured data is serialised into the prompt (grounding).
    const userText = params.messages[0].content
      .map((c: any) => c.text)
      .join("\n");
    expect(userText).toContain("Jane Doe");
    expect(userText).toContain("2026-07-07");
  });

  it("throws ClientSummaryUnavailableError on a refusal", async () => {
    const create = vi.fn(async () => ({
      stop_reason: "refusal",
      content: [],
    }));
    await expect(
      generateClientSummary(INPUT, { client: fakeClient(create as any) }),
    ).rejects.toBeInstanceOf(ClientSummaryUnavailableError);
  });

  it("throws when the model returns no report_summary tool block", async () => {
    const create = vi.fn(async () => ({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "here is your summary" }],
    }));
    await expect(
      generateClientSummary(INPUT, { client: fakeClient(create as any) }),
    ).rejects.toBeInstanceOf(ClientSummaryUnavailableError);
  });

  it("throws when the tool summary is empty / whitespace", async () => {
    const create = vi.fn(async () => toolResponse("   "));
    await expect(
      generateClientSummary(INPUT, { client: fakeClient(create as any) }),
    ).rejects.toBeInstanceOf(ClientSummaryUnavailableError);
  });

  it("throws when the tool input is not an object", async () => {
    const create = vi.fn(async () => ({
      stop_reason: "tool_use",
      content: [{ type: "tool_use", name: "report_summary", input: null }],
    }));
    await expect(
      generateClientSummary(INPUT, { client: fakeClient(create as any) }),
    ).rejects.toBeInstanceOf(ClientSummaryUnavailableError);
  });

  it("retries once on a 5xx and succeeds on the second attempt", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValueOnce(toolResponse("recovered"));
    const out = await generateClientSummary(INPUT, {
      client: fakeClient(create as any),
    });
    expect(out).toBe("recovered");
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("retries once on a network error (no status) then gives up as unavailable", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockRejectedValueOnce(new Error("socket hang up again"));
    await expect(
      generateClientSummary(INPUT, { client: fakeClient(create as any) }),
    ).rejects.toBeInstanceOf(ClientSummaryUnavailableError);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a 4xx client error — fails fast as unavailable", async () => {
    const create = vi.fn().mockRejectedValue({ status: 400 });
    await expect(
      generateClientSummary(INPUT, { client: fakeClient(create as any) }),
    ).rejects.toBeInstanceOf(ClientSummaryUnavailableError);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("resolveSummaryModelId returns a non-empty EU Bedrock id", () => {
    expect(resolveSummaryModelId().length).toBeGreaterThan(0);
  });
});

describe("getDefaultClient — the SDK's own retries", () => {
  afterEach(() => resetDefaultClientForTests());

  it("disables them here too, because this module keeps its OWN client", () => {
    // ⚠ This file deliberately does not import the nutrition module, so a fix
    // there does not reach here — and this is the same bug. The Anthropic SDK
    // defaults `maxRetries` to 2, which makes the private `createWithRetry`
    // below 3 x 12 s per attempt and ~72 s across both, against a 29 s Lambda.
    // The function is killed mid-attempt: no ClientSummaryUnavailableError, no
    // 503, no log line, and the `finally` that writes the usage row never runs
    // for an inference Bedrock has already billed.
    resetDefaultClientForTests();
    const client = getDefaultClient() as unknown as { maxRetries: number };

    expect(client.maxRetries).toBe(0);
  });
});
