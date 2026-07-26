import { describe, it, expect, vi } from "vitest";
import {
  classifyBedrockError,
  checkModel,
  decideExitCode,
  formatReport,
  redactArns,
  type ModelCheckResult,
} from "../check-bedrock-access";
import { AI_MODEL_IDS, distinctAiModelIds } from "../../infra/aiModels";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

// ── The two AccessDeniedException meanings ────────────────────────────────────
//
// Bedrock reuses one error NAME for "this account has no agreement for the model"
// and "your principal lacks bedrock:InvokeModel". Conflating them makes the gate
// hard-fail every deploy over its OWN permissions gap while blaming the model —
// the cry-wolf outcome the exit-2 path exists to prevent.
describe("classifyBedrockError — AccessDenied is two different problems", () => {
  // ⚠ The REAL marketplace message ALSO contains "is not authorized to perform",
  // so a naive phrase test misclassifies the actual incident as an IAM gap and
  // lets a broken deploy through. This asserts the marketplace signal wins.
  it("treats a missing model agreement as DENIED (block the deploy)", () => {
    expect(
      classifyBedrockError(
        awsError(
          "AccessDeniedException",
          "Model access is denied due to ... required AWS Marketplace actions (aws-marketplace:Subscribe) ...",
        ),
      ).status,
    ).toBe("denied");
  });

  it("treats a principal IAM gap as CHECK_FAILED (warn, never block)", () => {
    expect(
      classifyBedrockError(
        awsError(
          "AccessDeniedException",
          "User: arn:aws:sts::123456789012:assumed-role/deploy/session is not authorized to perform: bedrock:InvokeModel on resource: ...",
        ),
      ).status,
    ).toBe("check_failed");
  });

  it("fails closed — an unclassifiable AccessDenied is DENIED, not a pass", () => {
    expect(
      classifyBedrockError(awsError("AccessDeniedException", "denied")).status,
    ).toBe("denied");
  });
});

describe("decideExitCode", () => {
  const ok = (id: string): ModelCheckResult => ({
    modelId: id,
    envVars: ["A"],
    status: "ok",
  });
  const denied = (id: string): ModelCheckResult => ({
    modelId: id,
    envVars: ["A"],
    status: "denied",
  });
  const unverified = (id: string): ModelCheckResult => ({
    modelId: id,
    envVars: ["A"],
    status: "check_failed",
  });

  it("passes when every model is reachable", () => {
    expect(decideExitCode([ok("a"), ok("b")], false)).toBe(0);
  });

  it("blocks (1) on any denied model", () => {
    expect(decideExitCode([ok("a"), denied("b")], false)).toBe(1);
  });

  // Warn mode must still ANNOUNCE itself. Returning 0 would leave a denied model
  // completely silent, so an override set once for a hotfix and never unset makes
  // every later deploy quietly green — how the next incident ships.
  it("warns (2) rather than passing (0) when overridden", () => {
    expect(decideExitCode([denied("b")], true)).toBe(2);
  });

  // A throttled probe on the ONE model that matters, while the others pass, must
  // not read as a clean bill of health.
  it("warns (2) when only SOME models could not be verified", () => {
    expect(decideExitCode([ok("a"), unverified("b")], false)).toBe(2);
  });

  it("warns (2) when none could be verified", () => {
    expect(decideExitCode([unverified("a")], false)).toBe(2);
  });

  it("passes trivially when nothing is configured", () => {
    expect(decideExitCode([], false)).toBe(0);
  });
});

// This repo is PUBLIC, so Actions logs are world-readable. An IAM denial embeds
// the caller ARN, which would publish the AWS account id and the name of an
// OIDC-trusted deploy role.
describe("redactArns", () => {
  it("removes the account id and role from an IAM denial", () => {
    const out = redactArns(
      "User: arn:aws:sts::123456789012:assumed-role/prod-deploy/gha is not authorized to perform: bedrock:InvokeModel",
    );
    expect(out).not.toContain("123456789012");
    expect(out).not.toContain("prod-deploy");
    // The actionable half survives.
    expect(out).toContain("not authorized to perform");
    expect(out).toContain("<arn-redacted>");
  });

  it("leaves an ARN-free message untouched", () => {
    const msg = "Model access is denied ... aws-marketplace:Subscribe ...";
    expect(redactArns(msg)).toBe(msg);
  });
});

describe("formatReport — public-log safety", () => {
  it("redacts ARNs from the printed detail", () => {
    const out = formatReport(
      [
        {
          modelId: "m",
          envVars: ["A"],
          status: "denied",
          detail:
            "User: arn:aws:sts::999988887777:assumed-role/r/s is not authorized",
        },
      ],
      { region: "eu-west-2" },
    );
    expect(out).not.toContain("999988887777");
  });
});

/**
 * The runtime services each carry a `process.env.X ?? "<literal>"` fallback so a
 * local run or unit test works without env. Those literals CANNOT import
 * `infra/aiModels.ts` (infra is deploy-time config, the services are runtime),
 * so nothing but discipline keeps them in sync — and drift is silent in the worst
 * way: rename a key in the registry, the Lambda stops receiving that env var, the
 * service falls back to its stale literal, and the preflight reports green on an
 * id nothing actually runs.
 *
 * A test can bridge what an import cannot. Reading the source text is crude but
 * it turns a docblock warning into an actual gate.
 */
describe("runtime fallbacks stay bound to the registry", () => {
  const CONSUMERS: Array<{ file: string; envVar: keyof typeof AI_MODEL_IDS }> =
    [
      {
        file: "microservices/core/src/application/nutrition/services/aiEstimation.ts",
        envVar: "AI_PHOTO_MODEL_ID",
      },
      {
        file: "microservices/core/src/application/nutrition/services/aiEstimation.ts",
        envVar: "AI_TEXT_MODEL_ID",
      },
      {
        file: "microservices/core/src/application/nutrition/services/recipeExtraction.ts",
        envVar: "AI_RECIPE_MODEL_ID",
      },
      {
        file: "microservices/core/src/application/nutrition/services/recipeExtraction.ts",
        envVar: "AI_TEXT_MODEL_ID",
      },
      {
        file: "microservices/core/src/application/trainers/services/clientSummaryAi.ts",
        envVar: "AI_COACH_SUMMARY_MODEL_ID",
      },
    ];

  it.each(CONSUMERS)(
    "$file falls back to the registry value for $envVar",
    ({ file, envVar }) => {
      const src = readFileSync(resolve(__dirname, "../..", file), "utf8");
      const expected = AI_MODEL_IDS[envVar];
      // The fallback literal must appear alongside the env var it backs.
      const pattern = new RegExp(
        `process\\.env\\.${envVar}\\s*\\?\\?\\s*\n?\\s*"${expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
      );
      expect(
        pattern.test(src),
        `${file}: the ${envVar} fallback does not match AI_MODEL_IDS.${envVar} ("${expected}"). Update the literal or the registry — a mismatch means the preflight checks an id the service may not use.`,
      ).toBe(true);
    },
  );
});
