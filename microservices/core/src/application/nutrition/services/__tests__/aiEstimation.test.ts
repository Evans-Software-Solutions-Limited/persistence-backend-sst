import { describe, it, expect, vi } from "vitest";
import {
  estimateFromPhoto,
  estimateFromText,
  AiUnreadableError,
  AiUnavailableError,
  type MinimalBedrockClient,
} from "../aiEstimation";

const VALID_ESTIMATE_INPUT = {
  foods: [
    {
      name: "Grilled chicken breast",
      quantity: 1,
      unit: "piece",
      estimatedGrams: 150,
      kcal: 250,
      proteinG: 45,
      carbsG: 0,
      fatG: 6,
      confidence: 0.85,
    },
  ],
  overallConfidence: 0.8,
  notes: "Portion estimated from plate size.",
};

function toolUseResponse(input: unknown) {
  return {
    stop_reason: "tool_use" as const,
    content: [
      {
        type: "tool_use" as const,
        name: "report_estimate",
        input,
      },
    ],
  };
}

function fakeClient(
  createImpl: MinimalBedrockClient["messages"]["create"],
): MinimalBedrockClient {
  return { messages: { create: vi.fn(createImpl) } };
}

describe("estimateFromPhoto", () => {
  it("sends forced tool_choice + tool schema + an image content block", async () => {
    const create = vi.fn<MinimalBedrockClient["messages"]["create"]>(async () =>
      toolUseResponse(VALID_ESTIMATE_INPUT),
    );
    const client: MinimalBedrockClient = { messages: { create } };

    await estimateFromPhoto(
      { imageBase64: "ZmFrZQ==", mediaType: "image/jpeg", mealType: "lunch" },
      { client },
    );

    expect(create).toHaveBeenCalledTimes(1);
    const [params] = create.mock.calls[0];
    expect(params.tool_choice).toEqual({
      type: "tool",
      name: "report_estimate",
    });
    expect(params.tools).toHaveLength(1);
    expect(params.tools[0].name).toBe("report_estimate");
    expect(params.max_tokens).toBe(1500);

    const content = params.messages[0].content;
    const imageBlock = content.find((b) => b.type === "image");
    expect(imageBlock).toMatchObject({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: "ZmFrZQ==",
      },
    });
    const textBlock = content.find((b) => b.type === "text");
    expect(
      textBlock && "text" in textBlock ? textBlock.text : undefined,
    ).toContain("lunch");
  });

  it("returns a well-typed AiEstimate on a happy parse", async () => {
    const client = fakeClient(async () =>
      toolUseResponse(VALID_ESTIMATE_INPUT),
    );

    const result = await estimateFromPhoto(
      { imageBase64: "ZmFrZQ==", mediaType: "image/png" },
      { client },
    );

    expect(result).toEqual(VALID_ESTIMATE_INPUT);
  });

  it("throws AiUnreadableError when no tool_use block is present", async () => {
    const client = fakeClient(async () => ({
      stop_reason: "end_turn" as const,
      content: [{ type: "text" as const, text: "I cannot help with that." }],
    }));

    await expect(
      estimateFromPhoto(
        { imageBase64: "ZmFrZQ==", mediaType: "image/jpeg" },
        { client },
      ),
    ).rejects.toThrow(AiUnreadableError);
  });

  it("throws AiUnreadableError on an explicit refusal stop_reason", async () => {
    const client = fakeClient(async () => ({
      stop_reason: "refusal" as const,
      content: [],
    }));

    await expect(
      estimateFromPhoto(
        { imageBase64: "ZmFrZQ==", mediaType: "image/jpeg" },
        { client },
      ),
    ).rejects.toThrow(AiUnreadableError);
  });

  it("throws AiUnreadableError when the tool input doesn't match the AiEstimate shape", async () => {
    const client = fakeClient(async () =>
      toolUseResponse({ foods: "not-an-array", overallConfidence: 0.5 }),
    );

    await expect(
      estimateFromPhoto(
        { imageBase64: "ZmFrZQ==", mediaType: "image/jpeg" },
        { client },
      ),
    ).rejects.toThrow(AiUnreadableError);
  });

  it("throws AiUnreadableError when a food item is missing a required numeric field", async () => {
    const client = fakeClient(async () =>
      toolUseResponse({
        foods: [{ ...VALID_ESTIMATE_INPUT.foods[0], kcal: "250" }],
        overallConfidence: 0.8,
        notes: "n",
      }),
    );

    await expect(
      estimateFromPhoto(
        { imageBase64: "ZmFrZQ==", mediaType: "image/jpeg" },
        { client },
      ),
    ).rejects.toThrow(AiUnreadableError);
  });

  it("retries once on a 5xx error and succeeds on the second attempt", async () => {
    const serverError = Object.assign(new Error("internal error"), {
      status: 500,
    });
    const create = vi
      .fn()
      .mockRejectedValueOnce(serverError)
      .mockResolvedValueOnce(toolUseResponse(VALID_ESTIMATE_INPUT));
    const client: MinimalBedrockClient = { messages: { create } };

    const result = await estimateFromPhoto(
      { imageBase64: "ZmFrZQ==", mediaType: "image/jpeg" },
      { client },
    );

    expect(create).toHaveBeenCalledTimes(2);
    expect(result).toEqual(VALID_ESTIMATE_INPUT);
  });

  it("retries once on a timeout-shaped error (no status) and succeeds", async () => {
    const timeoutError = new Error("The operation was aborted");
    const create = vi
      .fn()
      .mockRejectedValueOnce(timeoutError)
      .mockResolvedValueOnce(toolUseResponse(VALID_ESTIMATE_INPUT));
    const client: MinimalBedrockClient = { messages: { create } };

    const result = await estimateFromPhoto(
      { imageBase64: "ZmFrZQ==", mediaType: "image/jpeg" },
      { client },
    );

    expect(create).toHaveBeenCalledTimes(2);
    expect(result).toEqual(VALID_ESTIMATE_INPUT);
  });

  it("throws AiUnavailableError when both attempts fail", async () => {
    const serverError = Object.assign(new Error("still down"), {
      status: 503,
    });
    const create = vi.fn().mockRejectedValue(serverError);
    const client: MinimalBedrockClient = { messages: { create } };

    await expect(
      estimateFromPhoto(
        { imageBase64: "ZmFrZQ==", mediaType: "image/jpeg" },
        { client },
      ),
    ).rejects.toThrow(AiUnavailableError);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-5xx client error and surfaces AiUnavailableError immediately", async () => {
    const clientError = Object.assign(new Error("bad request"), {
      status: 400,
    });
    const create = vi.fn().mockRejectedValue(clientError);
    const client: MinimalBedrockClient = { messages: { create } };

    await expect(
      estimateFromPhoto(
        { imageBase64: "ZmFrZQ==", mediaType: "image/jpeg" },
        { client },
      ),
    ).rejects.toThrow(AiUnavailableError);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("estimateFromText", () => {
  it("sends the description in a text-only content block with forced tool use", async () => {
    const create = vi
      .fn()
      .mockResolvedValue(toolUseResponse(VALID_ESTIMATE_INPUT));
    const client: MinimalBedrockClient = { messages: { create } };

    await estimateFromText(
      { description: "a bowl of porridge with banana" },
      { client },
    );

    expect(create).toHaveBeenCalledTimes(1);
    const [params] = create.mock.calls[0];
    expect(params.tool_choice).toEqual({
      type: "tool",
      name: "report_estimate",
    });
    expect(params.messages[0].content).toHaveLength(1);
    expect(params.messages[0].content[0].type).toBe("text");
    expect(params.messages[0].content[0].text).toContain(
      "a bowl of porridge with banana",
    );
  });

  it("returns a well-typed AiEstimate on a happy parse", async () => {
    const client = fakeClient(async () =>
      toolUseResponse(VALID_ESTIMATE_INPUT),
    );

    const result = await estimateFromText(
      { description: "two eggs on toast" },
      { client },
    );

    expect(result).toEqual(VALID_ESTIMATE_INPUT);
  });

  it("throws AiUnreadableError when no tool_use block is present", async () => {
    const client = fakeClient(async () => ({
      stop_reason: "end_turn" as const,
      content: [{ type: "text" as const, text: "unable to parse" }],
    }));

    await expect(
      estimateFromText({ description: "something" }, { client }),
    ).rejects.toThrow(AiUnreadableError);
  });
});
