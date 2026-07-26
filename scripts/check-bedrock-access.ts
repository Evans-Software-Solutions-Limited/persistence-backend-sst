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
 *   0  every model verified reachable (or no models configured)
 *   1  at least one model is DENIED / MISSING — the deploy should not proceed
 *   2  ANY model could not be verified (credentials, IAM, throttling), OR a
 *      denial was downgraded by `--warn`. Warn mode returns 2 rather than 0 so
 *      the annotation still fires — an override left set must never look green.
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

/** Per-probe socket timeout. Generous — a slow model is not a failure — but
 *  bounded, so the gate can never hang a deploy. */
const PROBE_TIMEOUT_MS = 15_000;

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
    // ⚠ Bedrock uses ONE error name for two completely different problems:
    //
    //   (a) the ACCOUNT has no marketplace agreement for this model — the real
    //       incident, and the thing this gate exists to block; and
    //   (b) the CALLING PRINCIPAL lacks `bedrock:InvokeModel` — an IAM gap on
    //       whoever ran the preflight.
    //
    // Only the message distinguishes them, and conflating them is worse than
    // useless: the `bedrock:InvokeModel` grant in `infra/api.ts` is on the
    // LAMBDA execution role, not the CI deploy role, so (b) is the likely
    // first-run outcome — and classifying it `denied` would hard-fail every
    // deploy over a preflight permissions gap while claiming a model is
    // unavailable. That is exactly the cry-wolf failure the exit-2 path exists
    // to avoid, so it must actually be reachable.
    //
    // ⚠ ORDER MATTERS, and not for the obvious reason. The real "model not
    // granted" message ALSO contains "is not authorized to perform" — it reads
    // "...service role is not authorized to perform the required AWS Marketplace
    // actions (aws-marketplace:Subscribe)...". Testing that phrase first
    // misclassifies the actual incident as a mere IAM gap and lets a broken
    // deploy through. The MARKETPLACE signal is the definitive marker and must
    // win; only a Bedrock-action denial with no marketplace mention is a
    // principal problem.
    const isMissingModelAgreement =
      /aws-marketplace:|Marketplace subscription/i.test(message);
    if (isMissingModelAgreement) {
      return { status: "denied", detail: message };
    }
    if (/is not authorized to perform/i.test(message)) {
      return { status: "check_failed", detail: message };
    }
    // An AccessDenied we cannot classify: treat as denied. Failing closed on the
    // gate is the safer default — a false block is a nuisance, a false pass is
    // another 30-day outage.
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

/**
 * Strip AWS ARNs from a provider message before printing.
 *
 * ⚠ THIS REPO IS PUBLIC, so GitHub Actions logs are world-readable. An IAM
 * denial's message embeds the caller identity —
 * `User: arn:aws:sts::<account-id>:assumed-role/<role>/<session> is not
 * authorized to perform: bedrock:InvokeModel` — which would publish the AWS
 * account id and the name of an OIDC-trusted deploy role to anyone reading CI
 * output. The rest of the message is the actionable part and is kept.
 */
export function redactArns(message: string): string {
  return message.replace(/arn:aws[a-z-]*:[^\s"']+/gi, "<arn-redacted>");
}

/**
 * Decide the process exit code from the results. Pure and exported so the
 * exit-code CONTRACT is testable — it encodes every operational decision here
 * (block vs warn vs pass) and previously lived inside an unexported `main()`
 * with 0% coverage, meaning the most consequential logic in the file had no test
 * at all.
 *
 *   1 — at least one model is genuinely unreachable. Block the deploy.
 *   2 — the check could not be completed. Warn; never block on our own gap.
 *   0 — everything verified reachable.
 */
export function decideExitCode(
  results: ModelCheckResult[],
  warnOnly: boolean,
): 0 | 1 | 2 {
  if (results.length === 0) return 0;

  const blocked = results.filter(
    (r) => r.status === "denied" || r.status === "missing",
  );
  const unverified = results.filter((r) => r.status === "check_failed");

  // Warn mode returns 2, NOT 0. Returning 0 would leave a genuinely denied model
  // completely silent — no annotation, just a console line buried in the step log
  // — so setting the override once for a hotfix and forgetting to unset it would
  // make every later deploy quietly green. That is how the next incident ships.
  if (blocked.length > 0) return warnOnly ? 2 : 1;

  // ANY unverified model warrants the warning, not only an all-failed sweep. A
  // throttled probe on the incident model while the others pass would otherwise
  // exit 0 with the one model that matters never actually checked.
  if (unverified.length > 0) return 2;

  return 0;
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
    if (r.detail) lines.push(`      ${redactArns(r.detail.split("\n")[0])}`);
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

  // Explicit socket timeouts: smithy's default node handler has none, so a hung
  // Bedrock endpoint would stall the deploy job indefinitely rather than failing
  // it — the preflight must never be the thing that hangs a release.
  const client = new BedrockRuntimeClient({
    region,
    requestHandler: {
      requestTimeout: PROBE_TIMEOUT_MS,
      connectionTimeout: PROBE_TIMEOUT_MS,
    },
  });

  const results: ModelCheckResult[] = [];
  for (const entry of entries) {
    results.push(await checkModel(client, entry));
  }

  console.log(
    formatReport(results, { region, profile: process.env.AWS_PROFILE }),
  );

  const code = decideExitCode(results, warnOnly);

  const blocked = results.filter(
    (r) => r.status === "denied" || r.status === "missing",
  );
  const unverified = results.filter((r) => r.status === "check_failed");

  if (blocked.length > 0 && warnOnly) {
    console.warn(
      "\nAI_MODEL_PREFLIGHT=warn — NOT failing the deploy, but the features above\n" +
        "are BROKEN in this account. Unset the override once the grant lands.",
    );
  }
  if (unverified.length > 0) {
    console.error(
      `\nCould not verify ${unverified.length} of ${results.length} model(s). This is a\n` +
        "credentials or IAM problem, not a model-access problem — the deploy is not\n" +
        "blocked, but model access was NOT confirmed. The deploy role needs\n" +
        "bedrock:InvokeModel on arn:aws:bedrock:*:*:inference-profile/eu.anthropic.*\n" +
        "and arn:aws:bedrock:*::foundation-model/anthropic.*.",
    );
  }

  return code;
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
