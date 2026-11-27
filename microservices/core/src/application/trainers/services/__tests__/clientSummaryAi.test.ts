/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  generateClientSummary,
  reportSummaryTool,
  resolveSummaryModelId,
  ClientSummaryUnavailableError,
  type MinimalBedrockClient,
  getDefaultClient,
  resetDefaultClientForTests,
} from "../clientSummaryAi";
import type { SummaryArea, WeeklySummaryEvidence } from "../weeklySummary";

const EVIDENCE: WeeklySummaryEvidence = {
  training: { done: 3, target: 4, state: "behind" },
  calories: {
    daysOnTarget: 4,
    daysCounted: 7,
    daysNotLogged: 1,
    daysOver: 1,
    daysUnder: 1,
  },
  programme: { week: 3, of: 8 },
};
const ALLOWED: SummaryArea[] = ["training", "calories"];

const GOOD = {
  headline: "  Steady week, one session short.  ",
  areas: [
    { area: "training", status: "check", text: "3 of 4 sessions." },
    { area: "calories", status: "good", text: "4 of 7 days on target." },
  ],
  ask: "Ask what got in the way of the fourth session.",
};

function toolResponse(input: unknown) {
  return {
    stop_reason: "tool_use",
    content: [{ type: "tool_use", name: "report_summary", input }],
  };
}

function fakeClient(
  create: MinimalBedrockClient["messages"]["create"],
): MinimalBedrockClient {
  return { messages: { create } };
}

const run = (create: unknown, allowed: SummaryArea[] = ALLOWED) =>
  generateClientSummary(EVIDENCE, allowed, {
    client: fakeClient(create as any),
  });

describe("generateClientSummary", () => {
  it("returns the strictly parsed summary by area from the forced tool block", async () => {
    const create = vi.fn(async () => toolResponse(GOOD));
    const out = await run(create);
    expect(out).toEqual({
      headline: "Steady week, one session short.",
      areas: [
        { area: "training", status: "check", text: "3 of 4 sessions." },
        { area: "calories", status: "good", text: "4 of 7 days on target." },
      ],
      ask: "Ask what got in the way of the fourth session.",
    });
  });

  it("forces tool use, offers only the areas with evidence, and sends compact facts", async () => {
    const create = vi.fn(async () => toolResponse(GOOD));
    await run(create);
    const params = (create as any).mock.calls[0][0];
    expect(params.tool_choice).toEqual({
      type: "tool",
      name: "report_summary",
    });
    expect(params.tools[0]).toEqual(reportSummaryTool(ALLOWED));
    expect(
      params.tools[0].input_schema.properties.areas.items.properties.area.enum,
    ).toEqual(["training", "calories"]);
    expect(params.model).toBe(resolveSummaryModelId());
    const facts = params.messages[0].content[1].text;
    expect(facts).toBe(JSON.stringify(EVIDENCE)); // no indentation
    expect(JSON.parse(facts).programme).toEqual({ week: 3, of: 8 });
  });

  it("drops an area the evidence doesn't cover instead of failing", async () => {
    const create = vi.fn(async () => toolResponse(GOOD));
    const out = await run(create, ["calories"]);
    expect(out.areas.map((a) => a.area)).toEqual(["calories"]);
  });

  it("throws ClientSummaryUnavailableError on a refusal", async () => {
    const create = vi.fn(async () => ({ stop_reason: "refusal", content: [] }));
    await expect(run(create)).rejects.toBeInstanceOf(
      ClientSummaryUnavailableError,
    );
  });

  it("throws when the model returns no report_summary tool block", async () => {
    const create = vi.fn(async () => ({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "here is your summary" }],
    }));
    await expect(run(create)).rejects.toBeInstanceOf(
      ClientSummaryUnavailableError,
    );
  });

  it.each([
    ["the input is not an object", null],
    ["the old single-paragraph shape", { summary: "Solid week." }],
    ["an empty headline", { ...GOOD, headline: "   " }],
    ["a missing ask", { headline: "x", areas: [] }],
    [
      "an unknown status",
      { ...GOOD, areas: [{ area: "training", status: "great", text: "x" }] },
    ],
  ])(
    "throws ai_summary_shape_invalid on %s — never invented text",
    async (_label, input) => {
      const create = vi.fn(async () => toolResponse(input));
      await expect(run(create)).rejects.toThrow("ai_summary_shape_invalid");
    },
  );

  it("retries once on a 5xx and succeeds on the second attempt", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValueOnce(toolResponse(GOOD));
    const out = await run(create);
    expect(out.headline).toBe("Steady week, one session short.");
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("retries once on a network error (no status) then gives up as unavailable", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockRejectedValueOnce(new Error("socket hang up again"));
    await expect(run(create)).rejects.toBeInstanceOf(
      ClientSummaryUnavailableError,
    );
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a 4xx client error — fails fast as unavailable", async () => {
    const create = vi.fn().mockRejectedValue({ status: 400 });
    await expect(run(create)).rejects.toBeInstanceOf(
      ClientSummaryUnavailableError,
    );
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

describe("clientSummaryAi — retry policy", () => {
  it("RETRIES a Bedrock throttle", async () => {
    // ⚠ This module keeps its own copy of `isRetryable`, and the 408/409/429
    // line added alongside `maxRetries: 0` had no test — deleting it left all
    // 11 tests green. Given the docstring explicitly warns that the two copies
    // drift apart, the untested one is the one that will.
    //
    // 429 is `< 500`, so before that line a routine Bedrock ThrottlingException
    // failed on the first attempt with the SDK's own retries switched off.
    const create = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("throttled"), { status: 429 }),
      )
      .mockResolvedValueOnce(toolResponse(GOOD));

    const out = await run(create);

    expect(out.ask).toBe(GOOD.ask);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a client error", async () => {
    const create = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("bad"), { status: 400 }));

    await expect(run(create)).rejects.toBeInstanceOf(
      ClientSummaryUnavailableError,
    );
    expect(create).toHaveBeenCalledTimes(1);
  });
});
