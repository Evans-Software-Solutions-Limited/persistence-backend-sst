import { getEnvironment } from "../packages/api-utils/src/domains";
import {
  accountPurgeCron,
  coreAPI,
  offDeltaCron,
  reconcileCron,
  streakCron,
  volumeCron,
} from "./api";

/**
 * Production alerting. Provisioned for named stages only (production /
 * staging); dev and personal stages get nothing.
 *
 * ─── Why this exists ───
 *
 * On 2026-07-30 the App Review device hit the production API and got 26 × 503
 * out of 85 requests. Cause: the AWS account's Lambda **Concurrent executions**
 * quota is 10 (not the AWS default of 1000), shared across all three products
 * in account 465891279888 — `persistence`, `axel-saas` and
 * `evans-software-solutions`. A cold-launch fan-out of ~28 requests throttled
 * ~16 of them; API Gateway surfaced each as a 503 with
 * `integrationServiceStatus: 429`.
 *
 * It had been happening for at least a week — account-wide `Throttles` ran
 * 43–168/day — and **nothing noticed**, because `describe-alarms` returned an
 * empty list for the entire account. It surfaced via an App Store rejection
 * rather than via monitoring. That is the gap this module closes.
 *
 * The quota itself was raised to 1000 on 2026-08-01 (request
 * `189195d4f16148d2b471c1685dc350be1QsR8ivV`, CASE_CLOSED) and throttling
 * stopped, so the thresholds here assume zero throttles as the baseline. The
 * blindness, not the quota, is what this file is for — the next incident will
 * be something else.
 *
 * ─── The governing constraint: production is pre-launch and very quiet ───
 *
 * Build 1.0 (39) is sitting on an App Store rejection (`STATE.md`), so
 * production currently serves TestFlight testers and Review devices only —
 * entire hours pass with zero requests, and production is at times quieter
 * than staging. Every threshold below is chosen against THAT volume, not
 * against a launched app's. Two consequences worth knowing before editing:
 *
 *   - Anything shaped "N failures within a 5-minute window" is close to blind
 *     here, because a 5-minute window often holds only a handful of requests.
 *     Hence the deliberately patient sibling alarms.
 *   - Anything shaped "alert when traffic stops" is unusable until launch: it
 *     would fire every quiet night. One such alarm is deliberately NOT
 *     provisioned — see the closing comment at the foot of this file, which
 *     keeps the reasoning so it isn't re-litigated.
 *
 * **Revisit every threshold in this file once the app is launched and real
 * volume is known.** They are tuned for pre-launch, not for steady state.
 *
 * ─── Delivery is deliberately NOT provisioned here ───
 *
 * This creates the SNS topic and the alarms, but no subscription. An SNS email
 * subscription requires a manual confirmation click regardless, so putting the
 * address in IaC buys nothing — and it would either hard-code a personal email
 * into a PUBLIC repo or add a new required secret that an unset stage would
 * fail its deploy on. Subscribe once per stage after the first deploy. The
 * topic ARN is printed by `sst deploy` as the `alertsTopicArn` output, or look
 * it up (swap the stage prefix and profile for staging):
 *
 *   TOPIC=$(aws sns list-topics --profile ess-prod --region eu-west-2 \
 *     --query "Topics[?contains(TopicArn,'production-alerts')].TopicArn" \
 *     --output text)
 *   aws sns subscribe --profile ess-prod --region eu-west-2 \
 *     --topic-arn "$TOPIC" --protocol email --notification-endpoint you@example.com
 *
 * Then click the confirmation link AWS emails you — an unconfirmed
 * subscription silently drops every notification.
 *
 * ─── Metric-name gotcha ───
 *
 * This API is an **HTTP API** (`sst.aws.ApiGatewayV2`), and HTTP APIs publish
 * `4xx` / `5xx` in the `AWS/ApiGateway` namespace. REST APIs (v1) publish
 * `4XXError` / `5XXError`. Using the REST names against an HTTP API yields an
 * alarm that silently never fires — which is worse than no alarm, because it
 * reads as coverage.
 */

/**
 * Guarded on the same tested authority the domain/SES wiring uses
 * (`getEnvironment`, unit-tested in `domain-config.test.ts`) rather than a
 * parallel hardcoded stage list — otherwise a future named stage would get a
 * domain and an SES identity from the tested path and no alarms from this
 * one, silently.
 */
const environment = getEnvironment($app.stage);
const isMonitoredStage = environment !== "dev";

/**
 * Concurrency headroom warning — 80% of the account's Lambda **Concurrent
 * executions** quota, which is 1000 as of 2026-08-01 (raised from 10 that
 * evening; request `189195d4f16148d2b471c1685dc350be1QsR8ivV`, CASE_CLOSED).
 *
 * ⚠ Update this if the quota ever changes. Nothing enforces the relationship —
 * it is a hardcoded 80% of a number that lives in AWS, not in this repo. Read
 * the live value with:
 *
 *   aws lambda get-account-settings --profile ess-prod --region eu-west-2 \
 *     --query AccountLimit.ConcurrentExecutions
 */
const CONCURRENCY_ALARM_THRESHOLD = 800;

export const alertsTopic = isMonitoredStage
  ? new sst.aws.SnsTopic(`${$app.stage}-alerts`)
  : undefined;

function alarm(name: string, args: aws.cloudwatch.MetricAlarmArgs) {
  if (!alertsTopic) return undefined;
  return new aws.cloudwatch.MetricAlarm(`${$app.stage}-${name}`, {
    ...args,
    alarmActions: [alertsTopic.arn],
    okActions: [alertsTopic.arn],
    // Low-traffic periods produce metric gaps. Without this, a quiet night
    // flips every alarm to INSUFFICIENT_DATA and trains you to ignore them.
    // Overridable: the sparsely-invoked cron alarms need `"missing"` (retain
    // last state across gaps) and the dead-man's switch needs `"breaching"`.
    treatMissingData: args.treatMissingData ?? "notBreaching",
  });
}

/**
 * THE alarm — the one whose absence cost an App Store submission.
 *
 * Deliberately account-wide (no `FunctionName` dimension): the concurrency
 * quota is an ACCOUNT limit shared with the other two products in this
 * account, so a sibling product exhausting it throttles `persistence` and a
 * function-scoped alarm would miss the cause.
 *
 * `threshold: 0` over 5 minutes — any throttle at all, detected fast.
 *
 * An earlier revision of this file carried a deliberately blunt interim
 * shape (24h / >200) because at the old quota of **10** production throttled
 * 43–168 times a day in bursts — a single cold-launch fan-out throttled ~16
 * requests in under a second, so no short-window threshold could be both quiet
 * and useful. **That is history**: the quota increase to 1000 was applied
 * 2026-08-01 19:55 BST (request `189195d4f16148d2b471c1685dc350be1QsR8ivV`,
 * CASE_CLOSED), throttles went to zero, and zero is now the correct baseline.
 *
 * ⚠ This alarm and `api5xxAlarm` are COUPLED, and it matters when tuning
 * either. A throttled request is surfaced at the edge as a 503 with
 * `integrationServiceStatus: 429`, so a throttle storm trips both. That is
 * intentional redundancy — this one names the cause, the 5xx pair measures the
 * user-visible symptom — but it means anything that makes throttling routine
 * again (a quota reduction, a new product in this account, a launch-traffic
 * surge) makes BOTH noisy, and raising the 5xx thresholds to compensate would
 * blind the only fast detector of a non-throttle failure. Fix the throttling
 * instead.
 */
export const lambdaThrottlesAlarm = alarm("lambda-throttles", {
  alarmDescription:
    "Lambda throttled at least once in 5 minutes (account-wide). Requests are being refused before they reach any handler — check the Concurrent executions quota (L-B99A9384) and per-function reserved concurrency. Expect the api-5xx alarms to trip alongside this: a throttled request is a 503 at the edge.",
  namespace: "AWS/Lambda",
  metricName: "Throttles",
  statistic: "Sum",
  period: 300,
  evaluationPeriods: 1,
  threshold: 0,
  comparisonOperator: "GreaterThanThreshold",
});

/**
 * Early warning that the account is approaching its concurrency ceiling.
 *
 * `datapointsToAlarm: 1` of 3 is load-bearing, not laziness. The incident this
 * module was written for was a sub-second cold-launch fan-out — comfortably
 * inside a single 60s window. Requiring consecutive breaching datapoints (the
 * default when `datapointsToAlarm` is unset) would make this deaf to the only
 * traffic shape we have actually observed.
 */
export const lambdaConcurrencyAlarm = alarm("lambda-concurrency", {
  alarmDescription: `Account-wide Lambda concurrency reached ${CONCURRENCY_ALARM_THRESHOLD} in at least one minute. Approaching the quota — throttling (and 503s at the edge) begins once it is hit.`,
  namespace: "AWS/Lambda",
  metricName: "ConcurrentExecutions",
  statistic: "Maximum",
  period: 60,
  evaluationPeriods: 3,
  datapointsToAlarm: 1,
  threshold: CONCURRENCY_ALARM_THRESHOLD,
  comparisonOperator: "GreaterThanOrEqualToThreshold",
});

/**
 * Fast 5xx alarm — catches a storm. Paired deliberately with the patient one
 * below, because at pre-launch volume this one alone is blind to a sustained
 * low-rate failure: a 5-minute window often holds only a handful of requests,
 * so a webhook 500ing on every event, or `DELETE /account` broken for the one
 * user a day who tries it, would never reach five in a window.
 */
export const api5xxAlarm = alarm("api-5xx", {
  alarmDescription:
    "5+ 5xx responses from the core API in 5 minutes — a failure storm. NOTE: a throttled request appears here as a 503 with integrationServiceStatus 429 and produces NO Lambda error metric — cross-check the throttles alarm.",
  namespace: "AWS/ApiGateway",
  // HTTP API (v2) metric name — NOT the REST API's `5XXError`.
  metricName: "5xx",
  dimensions: { ApiId: coreAPI.nodes.api.id },
  statistic: "Sum",
  period: 300,
  evaluationPeriods: 1,
  threshold: 5,
  comparisonOperator: "GreaterThanOrEqualToThreshold",
});

/** The patient half of the 5xx pair — a slow bleed rather than a storm. */
export const api5xxSustainedAlarm = alarm("api-5xx-sustained", {
  alarmDescription:
    "3+ 5xx responses from the core API within 30 minutes. Catches a sustained low-rate failure that the 5-minute alarm cannot see at pre-launch traffic volume — e.g. one endpoint broken for every user who touches it.",
  namespace: "AWS/ApiGateway",
  metricName: "5xx",
  dimensions: { ApiId: coreAPI.nodes.api.id },
  statistic: "Sum",
  period: 1800,
  evaluationPeriods: 1,
  threshold: 3,
  comparisonOperator: "GreaterThanOrEqualToThreshold",
});

/**
 * Requests on course to be killed by the 29s Lambda timeout.
 *
 * ⚠ This is `Maximum` against 28s, NOT a p99 against something lower, and the
 * distinction matters: several routes on this same `$default` integration
 * SUCCEED slowly by design — `EQUIPMENT_SCAN_TIMEOUT_MS` is 20s,
 * `REMAP_TIMEOUT_MS` is 24s, and `createWithRetry` budgets 2 × 12s. At
 * production's real volume a 5-minute window holds only a handful of requests,
 * so p99 collapses onto the max and any threshold below ~24s would page on a
 * perfectly healthy equipment scan. Above 28s there is no legitimate response
 * — only requests about to hit the wall.
 */
export const apiLatencyAlarm = alarm("api-latency", {
  alarmDescription:
    "A core API request took over 28s — the route's Lambda timeout is 29s, so these are being killed mid-flight (no `finally`, so no ai_usage_log row is written). Not mere slowness.",
  namespace: "AWS/ApiGateway",
  metricName: "IntegrationLatency",
  dimensions: { ApiId: coreAPI.nodes.api.id },
  statistic: "Maximum",
  period: 300,
  evaluationPeriods: 1,
  threshold: 28_000,
  comparisonOperator: "GreaterThanThreshold",
});

/**
 * Per-cron failure alarms.
 *
 * ⚠ Deliberately NOT covered by an account-wide `Errors` alarm. A scheduled
 * Lambda that throws produces 1 error plus at most 2 async retries — never
 * enough to cross a sensible account-wide threshold. So a cron could fail
 * every single run, indefinitely, with every alarm green. That is not
 * hypothetical for `account-purge-sweep`: it discharges the App Store
 * 5.1.1(v) 30-day deletion obligation, and accounts the user asked to delete
 * would quietly stop being deleted.
 *
 * One error is the signal — these are low-frequency jobs, so there is no
 * volume to threshold against.
 *
 * `treatMissingData: "missing"` rather than the helper's `"notBreaching"`
 * default: a daily cron publishes an `Errors` datapoint only in the hour it
 * runs, so `notBreaching` would flip the alarm back to OK an hour later and a
 * job that has failed every night for a month would show ALARM for one hour
 * in twenty-four. The SNS email still arrives either way, but the console
 * should not read green. `"missing"` retains the last state across the gaps.
 */
const CRONS = [
  // ⚠ hourly, not daily — `rate(1 hour)` in infra/api.ts. An intermittent
  // Stripe failure will therefore alternate ALARM/OK hour to hour on this one.
  { name: "reconcile-stripe-drift", cron: reconcileCron },
  { name: "streak-sweep", cron: streakCron },
  { name: "volume-aggregation", cron: volumeCron },
  { name: "off-delta-refresh", cron: offDeltaCron },
  { name: "account-purge-sweep", cron: accountPurgeCron },
];

export const cronErrorAlarms = CRONS.map(({ name, cron }) =>
  alarm(`cron-errors-${name}`, {
    alarmDescription: `The ${name} scheduled job ran and failed. Low-frequency jobs are invisible to any account-wide error alarm (a failing cron produces at most 3 errors), so this is the only thing watching them.`,
    namespace: "AWS/Lambda",
    metricName: "Errors",
    // `nodes.function`, not the deprecated `nodes.job` — identical bodies in
    // SST 3.19's `cron.ts`, both resolving to the same `aws.lambda.Function`.
    // Pulumi lifts `.name` through the Output to the physical function name.
    dimensions: { FunctionName: cron.nodes.function.name },
    statistic: "Sum",
    period: 3600,
    evaluationPeriods: 1,
    threshold: 1,
    comparisonOperator: "GreaterThanOrEqualToThreshold",
    treatMissingData: "missing",
  }),
);

/**
 * Dead-man's switch for the account-purge cron — alarms when it does NOT run.
 *
 * The `Errors` alarm above only fires for a job that runs and throws. If the
 * EventBridge rule is disabled, its target permission is lost, or the
 * invocation is throttled (a throttle publishes `Throttles`, not `Errors`),
 * the function silently stops running: no datapoint at all, and an
 * error-shaped alarm stays green forever.
 *
 * All five get it. An earlier revision covered only `account-purge-sweep`, on
 * the grounds that a silent stop there breaks an App Store 5.1.1(v) obligation
 * with a 30-day clock while the others are ops annoyances. The clock argument
 * is still why this exists — but the cost framing was wrong (it is a `.map`
 * over the array above, ~$0.10/alarm/month), and `streak-sweep` is not merely
 * an annoyance either: if it stops being invoked, streaks silently never
 * break, which is user-visible data drift.
 *
 * Every cron runs at least daily (`reconcile-stripe-drift` hourly), so a 24h
 * window with a floor of 1 is exact for all five. CloudWatch buckets an
 * 86,400s period on epoch alignment and evaluates only COMPLETED periods, so
 * the evaluated window always contains a scheduled invocation — a deploy at
 * any hour cannot straddle it into a false positive. Worst-case detection of a
 * genuinely stopped cron is ~43h, fine against a 30-day clock.
 *
 * ⚠ `period × evaluationPeriods` must not exceed 86,400 — `PutMetricAlarm`
 * rejects it outright. At 86,400 × 1 these sit exactly on that ceiling, so
 * raising `evaluationPeriods` here fails AT DEPLOY. `sst diff` will NOT catch
 * it: a diff is a plan, not an apply, so the API-side validation never runs,
 * and `infra/` has neither typecheck nor tests. Widen the window instead —
 * there isn't any room.
 */
export const cronHeartbeatAlarms = CRONS.map(({ name, cron }) =>
  alarm(`cron-heartbeat-${name}`, {
    alarmDescription: `The ${name} cron has not been INVOKED in 24 hours — distinct from failing. Its EventBridge rule may be disabled or its invocations throttled (a throttle publishes Throttles, not Errors, so the error alarm stays green).`,
    namespace: "AWS/Lambda",
    metricName: "Invocations",
    dimensions: { FunctionName: cron.nodes.function.name },
    statistic: "Sum",
    period: 86_400,
    evaluationPeriods: 1,
    threshold: 1,
    comparisonOperator: "LessThanThreshold",
    // Here, missing data IS the failure — the whole point is to catch a
    // function that publishes nothing at all.
    treatMissingData: "breaching",
  }),
);

/**
 * ─── Deliberately NOT provisioned: an API traffic-presence alarm ───
 *
 * Every alarm above is downstream of a request reaching Lambda. A failure
 * UPSTREAM of that — an ACM renewal failure, a dropped custom-domain mapping,
 * a regression in the delegated-zone NS records — takes the API completely
 * dark: `Count` goes to zero, `5xx` publishes nothing, and every alarm here
 * sits green through a total outage. The fix for that is an alarm on
 * `AWS/ApiGateway` `Count < 1` with `treatMissingData: "breaching"`.
 *
 * The `Count` variant is not here because **it cannot work before launch**.
 * Production serves TestFlight and Review devices only, so zero-request hours
 * are normal and guaranteed overnight — it would emit an ALARM/OK pair most
 * quiet hours from the first deploy, which is precisely the alert fatigue this
 * module exists to avoid. A synthetic pinger would manufacture the floor, but
 * that is a new Lambda on a 5-minute schedule (288 invocations/day) consuming
 * the very concurrency this work is trying to protect. **Add it at launch**,
 * tuned to observed overnight volume.
 *
 * ⚠ An **external uptime check has no such traffic dependency and could be
 * added today** — that half of this deferral is a judgement call about scope,
 * not a constraint. A Route 53 health check on the API host (~$0.50/month,
 * zero Lambda concurrency) verifies DNS + TLS + HTTP from outside AWS at a
 * fixed interval and covers all three failure modes above. Gotcha if you add
 * it: `HealthCheckStatus` publishes to CloudWatch in **us-east-1 only**, so
 * the alarm needs a second, explicitly-regioned provider — which is why it
 * isn't a one-liner here.
 *
 * `AWS/CertificateManager` `DaysToExpiry` would cover the renewal case alone,
 * in-region and with no traffic dependency — but SST's `ApiGatewayV2` builds
 * the domain certificate internally (`createSsl()` in `apigatewayv2.ts`) and
 * does not expose it on `.nodes`, so wiring it means either reaching into SST
 * internals or looking the ARN up out-of-band. Not guessed at here, in a file
 * that has neither typecheck nor tests.
 *
 * Concrete risk being accepted: build 39 is pending App Review resubmission,
 * and a silent DNS/TLS failure during a review pass would produce a rejection
 * with every alarm in this file green.
 */
