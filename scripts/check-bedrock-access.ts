/**
 * Bedrock model-access preflight — run before `sst deploy`.
 *
 * ## Why
 *
 * Bedrock model access is granted **per AWS account and per model**. Staging and
 * production are different accounts with independently-granted models, so a
 * model that works in staging can be completely unavailable in production. On
 * 2026-07-26 that is exactly what happened: `AI_TEXT_MODEL_ID` (Haiku 4.5) was
 * never granted in the production account, so free-text meal estimation and the
 * coach AI client summary returned 503 on EVERY production request for 30 days
 * while passing every test and working perfectly in staging.
 *
 * It was invisible because of a chain of correct-looking behaviour: Bedrock's
 * `AccessDeniedException` is a 403 → `isRetryable` declines to retry a 4xx →
 * the adapter raises `AiUnavailableError` → the handler RETURNS a 503 body
 * rather than throwing → `coreErrorHandler`, which only logs uncaught throws,
 * logged nothing at all. No test can catch this (tests inject a fake Bedrock
 * client, by design — CI has no AWS credentials), and no code review can
 * either, because the code is right and the ACCOUNT is wrong.
 *
 * A deploy-time gate is the only place this is catchable before a user hits it.
 *
 * ## What it does
 *
 * For each distinct model id in `infra/aiModels.ts` — the same object `api.ts`
 * spreads into the Lambda environment, so this cannot check a stale list — send
 * the smallest possible real inference (`max_tokens: 1`).
 *
 * An INVOKE rather than a metadata query is deliberate. `GetFoundationModelAvailability`
 * reports the marketplace agreement but proves nothing about IAM, about whether
 * the inference profile is ACTIVE, or about the profile's cross-region routing.
 * Invoking exercises the whole path the app actually uses. The cost is ~1 output
 * token per model per deploy — far below rounding error, and cheap insurance
 * against shipping a feature that cannot work.
 *
 * ## Exit codes
 *
 *   0  every model reachable (or `--warn`, or no models configured)
 *   1  at least one model is DENIED / MISSING — the deploy should not proceed
 *   2  the check itself could not run (bad credentials, missing IAM permission)
 *
 * Exit 2 is separated from exit 1 on purpose: "I cannot check" and "the model is
 * not accessible" demand completely different responses, and conflating them
 * would make the preflight cry wolf the first time the CI role lacks
 * `bedrock:InvokeModel` — which would train everyone to ignore it.
 *
 * ## Usage
 *
 *   bun run --cwd scripts check-bedrock-access
 *   bun run --cwd scripts check-bedrock-access -- --warn   # report, never fail
 *
 * Honours `AWS_REGION` (default `eu-west-2`) and the standard credential chain,
 * so `AWS_PROFILE=ess-prod bun run ... check-bedrock-access` checks production.
 * Set `AI_MODEL_PREFLIGHT=warn` to downgrade failures without editing the
 * workflow — the escape hatch for shipping an unrelated hotfix while a grant is
 * still pending.
 */
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { AI_MODEL_IDS, distinctAiModelIds } from "../infra/aiModels";

const DEFAULT_REGION = "eu-west-2";

/** Outcome for one model id. */
export type CheckStatus = "ok" | "denied" | "missing" | "check_failed";

export interface ModelCheckResult {
  modelId: string;
  envVars: string[];
  status: CheckStatus;
  detail?: string;
}

/**
 * Classify a thrown Bedrock error.
 *
 * - `denied`   — the account has no agreement for this model, or IAM forbids the
 *                call. Actionable: grant model access / fix the policy.
 * - `missing`  — the model id does not exist or is not usable in this region
 *                (`ValidationException` also covers an inference-profile-only
 *                model addressed by its bare foundation-model id).
 * - `check_failed` — throttling, credentials, connectivity. NOT the model's
 *                fault; must not fail a deploy on its own.
 *
 * Exported for unit testing: the whole value of this script is that it
 * classifies correctly, and asserting on real AWS errors is not possible in CI.
 */
export function classifyBedrockError(error: unknown): {
  status: CheckStatus;
  detail: string;
} {
  const name =
    (typeof error === "object" && error !== null && "name" in error
      ? String((error as { name?: unknown }).name)
      : "") || "";
  const message = error instanceof Error ? error.message : String(error);

  if (name === "AccessDeniedException") {
    return { status: "denied", detail: message };
  }
  if (
    name === "ResourceNotFoundException" ||
    name === "ValidationException" ||
    name === "ModelNotReadyException"
  ) {
    return { status: "missing", detail: message };
  }
  // Throttling means the model IS reachable — we simply could not confirm it
  // right now. Treating it as a denial would fail deploys at random.
  if (
    name === "ThrottlingException" ||
    name === "ServiceQuotaExceededException"
  ) {
    return { status: "check_failed", detail: `throttled: ${message}` };
  }
  return { status: "check_failed", detail: `${name || "unknown"}: ${message}` };
}

/** The smallest valid Anthropic-on-Bedrock request: one token, one word. */
function minimalProbeBody(): string {
  return JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 1,
    messages: [{ role: "user", content: "hi" }],
  });
}

export async function checkModel(
  client: Pick<BedrockRuntimeClient, "send">,
  entry: { modelId: string; envVars: string[] },
): Promise<ModelCheckResult> {
  try {
    await client.send(
      new InvokeModelCommand({
        modelId: entry.modelId,
        contentType: "application/json",
        body: minimalProbeBody(),
      }),
    );
    return { ...entry, status: "ok" };
  } catch (error) {
    const { status, detail } = classifyBedrockError(error);
    return { ...entry, status, detail };
  }
}

/** Render the report. Pure, so the formatting is unit-testable. */
export function formatReport(
  results: ModelCheckResult[],
  ctx: { region: string; profile?: string },
): string {
  const icon: Record<CheckStatus, string> = {
    ok: "✔",
    denied: "✖",
    missing: "✖",
    check_failed: "?",
  };
  const lines = [
    `Bedrock model preflight — region ${ctx.region}${
      ctx.profile ? `, profile ${ctx.profile}` : ""
    }`,
  ];
  for (const r of results) {
    lines.push(
      `  ${icon[r.status]} ${r.status.toUpperCase().padEnd(12)} ${r.modelId}  (${r.envVars.join(", ")})`,
    );
    if (r.detail) lines.push(`      ${r.detail.split("\n")[0]}`);
  }

  const blocked = results.filter(
    (r) => r.status === "denied" || r.status === "missing",
  );
  if (blocked.length > 0) {
    lines.push(
      "",
      `${blocked.length} model(s) unreachable from this account. The features below would return 503 to every user:`,
      ...blocked.map((r) => `  • ${r.envVars.join(", ")} → ${r.modelId}`),
      "",
      "Fix: AWS console → Bedrock → Model access (in THIS account and region) →",
      "grant access to the model above, then re-run. Model access is per-account,",
      "so granting it in staging does not grant it in production.",
      "",
      "Do NOT switch to a `global.` inference profile to work around this — it",
      "routes outside the EU and breaks the DPIA's data-residency commitment.",
    );
  }
  return lines.join("\n");
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const warnOnly =
    argv.includes("--warn") || process.env.AI_MODEL_PREFLIGHT === "warn";
  const region = process.env.AWS_REGION ?? DEFAULT_REGION;

  const entries = distinctAiModelIds(AI_MODEL_IDS);
  if (entries.length === 0) {
    console.log(
      "Bedrock model preflight: no models configured — nothing to do.",
    );
    return 0;
  }

  const client = new BedrockRuntimeClient({ region });
  const results: ModelCheckResult[] = [];
  for (const entry of entries) {
    results.push(await checkModel(client, entry));
  }

  console.log(
    formatReport(results, { region, profile: process.env.AWS_PROFILE }),
  );

  const blocked = results.filter(
    (r) => r.status === "denied" || r.status === "missing",
  );
  const unverified = results.filter((r) => r.status === "check_failed");

  if (blocked.length > 0) {
    if (warnOnly) {
      console.warn(
        "\n--warn set: not failing the deploy. The features above are BROKEN in this account.",
      );
      return 0;
    }
    return 1;
  }
  if (unverified.length === results.length) {
    // Every check failed for non-model reasons — almost certainly credentials or
    // a missing `bedrock:InvokeModel` permission on the CI role. Exit 2 so the
    // workflow can tell "preflight is broken" from "a model is unavailable".
    console.error(
      "\nCould not verify ANY model — this looks like a credentials or IAM problem,\n" +
        "not a model-access problem. The CI role needs bedrock:InvokeModel on\n" +
        "arn:aws:bedrock:*:*:inference-profile/eu.anthropic.* and\n" +
        "arn:aws:bedrock:*::foundation-model/anthropic.*.",
    );
    return 2;
  }
  return 0;
}

// `import.meta.main` is true only when run directly, so the exported helpers
// above stay importable from the unit test without executing the script.
if (import.meta.main) {
  main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(
        `Bedrock model preflight crashed: ${
          error instanceof Error ? error.stack : String(error)
        }`,
      );
      process.exit(2);
    });
}
