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
 * ─── Delivery is deliberately NOT provisioned here ───
 *
 * This creates the SNS topic and the alarms, but no subscription. An SNS email
 * subscription requires a manual confirmation click regardless, so putting the
 * address in IaC buys nothing — and it would either hard-code a personal email
 * into a PUBLIC repo or add a new required secret that an unset stage would
 * fail its deploy on. Subscribe once, per stage, after the first deploy. The
 * topic ARN is printed by `sst deploy` as the `alertsTopicArn` output, or:
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
 * Concurrency headroom warning, set against the **target** quota of 1000 (an
 * increase to that was requested 2026-08-01, request
 * `189195d4f16148d2b471c1685dc350be1QsR8ivV`). While the quota is still 10
 * this cannot fire — `lambdaThrottlesAlarm` covers the interim, because
 * throttling is defined relative to whatever the quota currently is.
 *
 * ⚠ Update this if the quota is ever set to something other than 1000.
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
    // Correct for every alarm below EXCEPT `apiTrafficAlarm`, which overrides
    // it deliberately — see that alarm.
    treatMissingData: "notBreaching",
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
 * ⚠ The threshold is an INTERIM value. The steady state we want is zero
 * throttles, i.e. `threshold: 0`. But at the current quota of 10 production
 * throttles 43–168 times a day, and `threshold: 0` over a 5-minute window
 * would page on every cluster — an ALARM/OK pair per day, indefinitely, until
 * the quota request lands. That is exactly the alert-fatigue this module's
 * docstring exists to avoid. So: a wider window and a small floor for now.
 * **Once the quota is 1000 and steady-state throttles are genuinely zero, set
 * `period: 300, threshold: 0`** — a single throttle is worth knowing about.
 */
export const lambdaThrottlesAlarm = alarm("lambda-throttles", {
  alarmDescription:
    "Lambda throttling (account-wide). Requests are being refused before they reach any handler — check the Concurrent executions quota (L-B99A9384) and per-function reserved concurrency. Threshold is interim; tighten to >0 once the quota increase lands.",
  namespace: "AWS/Lambda",
  metricName: "Throttles",
  statistic: "Sum",
  period: 900,
  evaluationPeriods: 1,
  threshold: 5,
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
 * Edge-observed 5xx on the core API. Catches everything the Lambda alarms
 * cannot see — throttles, authorizer rejections and integration failures all
 * surface here as a 5xx without ever producing a Lambda `Errors` datapoint.
 */
export const api5xxAlarm = alarm("api-5xx", {
  alarmDescription:
    "5+ 5xx responses from the core API in 5 minutes. NOTE: a throttled request appears here as a 503 with integrationServiceStatus 429 and produces NO Lambda error metric — cross-check the throttles alarm.",
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
 * enough to cross a `>= 5` account-wide threshold. So a nightly cron could
 * fail every single night, indefinitely, with every alarm green. That is not
 * hypothetical for `account-purge-sweep`: it discharges the App Store
 * 5.1.1(v) 30-day deletion obligation, and accounts the user asked to delete
 * would quietly stop being deleted.
 *
 * One error is the signal — these run once a day, so there is no volume to
 * threshold against. The period is an hour so a single failure can't produce
 * more than one notification.
 */
const CRONS = [
  { name: "reconcile-stripe-drift", cron: reconcileCron },
  { name: "streak-sweep", cron: streakCron },
  { name: "volume-aggregation", cron: volumeCron },
  { name: "off-delta-refresh", cron: offDeltaCron },
  { name: "account-purge-sweep", cron: accountPurgeCron },
];

export const cronErrorAlarms = CRONS.map(({ name, cron }) =>
  alarm(`cron-errors-${name}`, {
    alarmDescription: `The ${name} scheduled job failed. These run once daily and are invisible to the account-wide error alarm (a failing cron produces at most 3 errors), so this is the only thing watching them.`,
    namespace: "AWS/Lambda",
    metricName: "Errors",
    // `nodes.function`, not the deprecated `nodes.job` — both resolve to the
    // same `aws.lambda.Function`, but `job` carries a @deprecated tag in
    // SST 3.19's `cron.ts`. Pulumi lifts `.name` through the Output.
    dimensions: { FunctionName: cron.nodes.function.name },
    statistic: "Sum",
    period: 3600,
    evaluationPeriods: 1,
    threshold: 1,
    comparisonOperator: "GreaterThanOrEqualToThreshold",
  }),
);

/**
 * Traffic-presence check — the only alarm here that fires on the ABSENCE of
 * data, and the only one that can catch a failure upstream of the integration.
 *
 * Every other alarm in this file is downstream of a request actually reaching
 * Lambda. If the ACM certificate for the custom domain fails renewal, the
 * domain mapping is dropped, or the delegated-zone NS records regress, clients
 * fail at TLS/DNS: `Count` goes to zero, `5xx` publishes nothing, and every
 * other alarm sits green through a total outage. Hence
 * `treatMissingData: "breaching"` — here, missing data IS the outage.
 *
 * Production only. Staging legitimately goes hours without a request, so this
 * shape would be pure noise there.
 */
export const apiTrafficAlarm =
  alertsTopic && environment === "production"
    ? new aws.cloudwatch.MetricAlarm(`${$app.stage}-api-no-traffic`, {
        alarmDescription:
          "The core API served no requests for an hour. Every other alarm is downstream of a request reaching Lambda, so a DNS/TLS/domain-mapping failure would leave them all green — this is the one that catches it.",
        namespace: "AWS/ApiGateway",
        metricName: "Count",
        dimensions: { ApiId: coreAPI.nodes.api.id },
        statistic: "Sum",
        period: 3600,
        evaluationPeriods: 1,
        threshold: 1,
        comparisonOperator: "LessThanThreshold",
        treatMissingData: "breaching",
        alarmActions: [alertsTopic.arn],
        okActions: [alertsTopic.arn],
      })
    : undefined;
