import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { JobMessage } from "./types";

/**
 * The queue PORT — `specs/_shared/async-jobs/design.md` § 1, AC-6.1.
 *
 * Consuming code depends on this interface, never on the AWS SDK. Swapping SQS
 * for another substrate must not touch a feature handler.
 */
export interface JobQueue {
  send(message: JobMessage): Promise<void>;
}

/**
 * Thrown when the queue publish fails. The enqueue path turns this into a
 * `503` AND marks the job `failed` (AC-1.2) — it must never return `202` for
 * work nothing will ever pick up, which is the one outcome a client cannot
 * recover from: it would poll a `queued` job forever.
 */
export class JobQueueUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobQueueUnavailableError";
    Object.setPrototypeOf(this, JobQueueUnavailableError.prototype);
  }
}

/**
 * Resolve the queue URL from the SST-linked resource, falling back to an env
 * var. Same shape as `packages/db/src/client.ts`'s `getDatabaseUrl()` — SST
 * injects `Resource` at runtime, and tests/scripts set the env var.
 */
function getQueueUrl(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Resource } = require("sst");
    if (Resource.AiJobQueue?.url) {
      return Resource.AiJobQueue.url as string;
    }
  } catch {
    // Resource not available (tests, scripts) — fall through to the env var.
  }

  const url = process.env.AI_JOB_QUEUE_URL;
  if (!url) {
    throw new JobQueueUnavailableError(
      "AI job queue is not configured (no linked AiJobQueue resource and no AI_JOB_QUEUE_URL)",
    );
  }
  return url;
}

let cachedClient: SQSClient | null = null;

/**
 * Cached across calls within a warm Lambda, for the same reason
 * `aiBedrockClient` caches its client: rebuilding the credential provider
 * chain on every invocation is pure cold-path cost on a hot path.
 */
function getClient(): SQSClient {
  if (!cachedClient) {
    cachedClient = new SQSClient({});
  }
  return cachedClient;
}

/** Test-only reset of the module-level client cache. */
export function __resetJobQueueClient(): void {
  cachedClient = null;
}

/**
 * The production adapter.
 *
 * The message body is deliberately just `{ jobId }`. The job ROW is the state;
 * putting the input on the queue too would create a second copy that can
 * disagree with it, and SQS's 256 KB body limit is a bound a generated
 * programme would eventually cross.
 */
export const sqsJobQueue: JobQueue = {
  async send(message: JobMessage): Promise<void> {
    const queueUrl = getQueueUrl();
    try {
      await getClient().send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(message),
        }),
      );
    } catch (error) {
      throw new JobQueueUnavailableError(
        `failed to publish job ${message.jobId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  },
};
