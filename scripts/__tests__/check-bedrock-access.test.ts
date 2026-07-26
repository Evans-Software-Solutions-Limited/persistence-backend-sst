import { describe, it, expect, vi } from "vitest";
import {
  classifyBedrockError,
  checkModel,
  formatReport,
  type ModelCheckResult,
} from "../check-bedrock-access";
import { AI_MODEL_IDS, distinctAiModelIds } from "../../infra/aiModels";

/**
 * The preflight's whole value is that it CLASSIFIES correctly: "the model is
 * unavailable" must fail a deploy, and "I could not check" must not. Getting
 * that backwards either ships a broken feature or blocks deploys at random, and
 * neither is observable without exercising the real AWS errors — which CI cannot
 * do. Hence these tests build the error shapes the SDK actually throws.
 */

/** The AWS SDK sets `name` on service errors; that's what we classify on. */
function awsError(name: string, message = "boom") {
  return Object.assign(new Error(message), { name });
}

describe("classifyBedrockError", () => {
  // The exact error that took production down for 30 days.
  it("classifies a missing model agreement as DENIED", () => {
    const real = awsError(
      "AccessDeniedException",
      "Model access is denied due to IAM user or service role is not authorized to perform the required AWS Marketplace actions (aws-marketplace:ViewSubscriptions, aws-marketplace:Subscribe) to enable access to this model.",
    );
    const { status, detail } = classifyBedrockError(real);
    expect(status).toBe("denied");
    // The AWS message is the actionable part — it must reach the operator, not
    // be swallowed and replaced with our own paraphrase.
    expect(detail).toContain("aws-marketplace:Subscribe");
  });

  it.each([
    "ResourceNotFoundException",
    "ValidationException",
    "ModelNotReadyException",
  ])(
    "classifies %s as MISSING (bad id / not usable in this region)",
    (name) => {
      expect(classifyBedrockError(awsError(name)).status).toBe("missing");
    },
  );

  // Throttling means the model IS reachable. Calling it a denial would fail
  // deploys at random and train everyone to ignore the gate.
  it.each(["ThrottlingException", "ServiceQuotaExceededException"])(
    "classifies %s as CHECK_FAILED, never denied",
    (name) => {
      expect(classifyBedrockError(awsError(name)).status).toBe("check_failed");
    },
  );

  it("classifies credential/network errors as CHECK_FAILED", () => {
    expect(
      classifyBedrockError(awsError("CredentialsProviderError")).status,
    ).toBe("check_failed");
    expect(classifyBedrockError(new Error("socket hang up")).status).toBe(
      "check_failed",
    );
  });

  it("does not throw on a non-Error throw", () => {
    expect(classifyBedrockError("kaboom").status).toBe("check_failed");
    expect(classifyBedrockError(null).status).toBe("check_failed");
  });
});

describe("checkModel", () => {
  const entry = { modelId: "eu.anthropic.test-v1:0", envVars: ["AI_TEST"] };

  it("returns ok and sends a minimal 1-token probe", async () => {
    const send = vi.fn().mockResolvedValue({});
    const result = await checkModel({ send } as never, entry);

    expect(result.status).toBe("ok");
    expect(send).toHaveBeenCalledTimes(1);
    // Cost discipline: the probe must stay at max_tokens 1. A preflight that got
    // expensive would be the first thing removed from the pipeline.
    const body = JSON.parse(send.mock.calls[0][0].input.body as string);
    expect(body.max_tokens).toBe(1);
    expect(send.mock.calls[0][0].input.modelId).toBe(entry.modelId);
  });

  it("maps a thrown AccessDenied onto the entry without throwing", async () => {
    const send = vi.fn().mockRejectedValue(awsError("AccessDeniedException"));
    const result = await checkModel({ send } as never, entry);

    // Must resolve, not reject — one bad model shouldn't abort the whole sweep,
    // or the report would only ever name the first failure.
    expect(result).toMatchObject({
      status: "denied",
      modelId: entry.modelId,
      envVars: ["AI_TEST"],
    });
  });
});

describe("distinctAiModelIds", () => {
  it("dedupes shared ids and names every env var that references one", () => {
    const entries = distinctAiModelIds({
      A_MODEL_ID: "model-x",
      B_MODEL_ID: "model-x",
      C_MODEL_ID: "model-y",
    });

    expect(entries).toEqual([
      { modelId: "model-x", envVars: ["A_MODEL_ID", "B_MODEL_ID"] },
      { modelId: "model-y", envVars: ["C_MODEL_ID"] },
    ]);
  });

  // This is the property that made the real incident two bugs instead of one:
  // AI_TEXT_MODEL_ID and AI_COACH_SUMMARY_MODEL_ID share a model, so one missing
  // grant broke free-text estimation AND the coach AI summary. A report naming
  // only one of them would understate the blast radius.
  it("reports both features sharing the Haiku id in the real config", () => {
    const entries = distinctAiModelIds(AI_MODEL_IDS);
    const shared = entries.find((e) => e.modelId.includes("haiku"));
    expect(shared?.envVars).toEqual(
      expect.arrayContaining(["AI_TEXT_MODEL_ID", "AI_COACH_SUMMARY_MODEL_ID"]),
    );
  });

  it("covers every configured model id exactly once", () => {
    const entries = distinctAiModelIds(AI_MODEL_IDS);
    const configured = new Set(Object.values(AI_MODEL_IDS));
    expect(new Set(entries.map((e) => e.modelId))).toEqual(configured);
  });
});

describe("formatReport", () => {
  const denied: ModelCheckResult = {
    modelId: "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
    envVars: ["AI_TEXT_MODEL_ID", "AI_COACH_SUMMARY_MODEL_ID"],
    status: "denied",
    detail: "Model access is denied ...",
  };

  it("names the blocked model, its env vars and the per-account fix", () => {
    const out = formatReport([denied], { region: "eu-west-2" });
    expect(out).toContain("DENIED");
    expect(out).toContain("AI_TEXT_MODEL_ID");
    expect(out).toContain("AI_COACH_SUMMARY_MODEL_ID");
    // The single most important sentence: granting in staging is not granting in
    // production, which is why this shipped.
    expect(out).toContain("per-account");
    // And the workaround that must NOT be taken.
    expect(out).toContain("global.");
  });

  it("stays quiet about remediation when everything passes", () => {
    const out = formatReport([{ modelId: "m", envVars: ["A"], status: "ok" }], {
      region: "eu-west-2",
    });
    expect(out).toContain("OK");
    expect(out).not.toContain("unreachable");
    expect(out).not.toContain("Model access");
  });
});
