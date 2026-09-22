import {
  databaseUrl,
  sentryDsn,
  togetherTokenSecret,
  geoapifyApiKey,
} from "./secrets";
import { supabaseUrl } from "./domains";

// Explicit stage rollout. Defining this code does not activate a provider or deploy.
const enabled = process.env.TOGETHER_ENABLED === "true";
export const togetherSocket = enabled
  ? new sst.aws.ApiGatewayWebSocket("TogetherSocket", {
      accessLog: { retention: "1 week" },
      transform: {
        stage: {
          defaultRouteSettings: {
            throttlingBurstLimit: 50,
            throttlingRateLimit: 25,
          },
        },
      },
    })
  : undefined;
export const togetherDlq = enabled
  ? new sst.aws.Queue("TogetherRecoveryDlq")
  : undefined;
export const togetherQueue = enabled
  ? new sst.aws.Queue("TogetherRecoveryQueue", {
      visibilityTimeout: "3 minutes",
      dlq: { queue: togetherDlq!.arn, retry: 5 },
    })
  : undefined;
export const togetherEnvironment = {
  TOGETHER_ENABLED: enabled ? "true" : "false",
  TOGETHER_DISCOVERY_ENABLED:
    enabled && process.env.TOGETHER_DISCOVERY_ENABLED === "true"
      ? "true"
      : "false",
  TOGETHER_WEBSOCKET_URL: togetherSocket?.url ?? "",
  TOGETHER_MANAGEMENT_ENDPOINT: togetherSocket?.managementEndpoint ?? "",
  TOGETHER_QUEUE_URL: togetherQueue?.url ?? "",
  TOGETHER_TOKEN_SECRET: togetherTokenSecret.value,
  GEOAPIFY_API_KEY: geoapifyApiKey.value,
};
const environment = {
  DATABASE_URL: databaseUrl.value,
  SUPABASE_URL: supabaseUrl,
  SENTRY_DSN: sentryDsn.value,
  ...togetherEnvironment,
};
if (togetherSocket) {
  // Ticket consumed transactionally during $connect. HTTP JWT is required to mint it.
  for (const route of ["$connect", "$disconnect", "$default"]) {
    togetherSocket.route(route, {
      handler: "microservices/core/src/togetherSocket.handler",
      timeout: "20 seconds",
      environment,
    });
  }
}
export const togetherWorker =
  togetherQueue && togetherSocket
    ? togetherQueue.subscribe(
        {
          handler: "microservices/core/src/togetherWorker.handler",
          timeout: "120 seconds",
          environment,
          link: [togetherSocket, togetherQueue],
        },
        {
          batch: { size: 1 },
          transform: {
            eventSourceMapping: { scalingConfig: { maximumConcurrency: 2 } },
          },
        },
      )
    : undefined;
// This sweep is a recovery backstop; SQS wakes dispatch promptly after commit.
export const togetherRecoveryCron =
  togetherQueue && togetherSocket
    ? new sst.aws.Cron("TogetherRecoverySweep", {
        schedule: "rate(1 minute)",
        job: {
          handler: "microservices/core/src/togetherWorker.handler",
          timeout: "120 seconds",
          environment,
          link: [togetherSocket, togetherQueue],
        },
      })
    : undefined;
