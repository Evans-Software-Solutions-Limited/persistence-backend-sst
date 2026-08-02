import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendMock = vi.fn();

vi.mock("@aws-sdk/client-sqs", () => ({
  SQSClient: vi.fn().mockImplementation(() => ({ send: sendMock })),
  SendMessageCommand: vi.fn().mockImplementation((input: unknown) => ({
    input,
  })),
}));

import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import {
  JobQueueUnavailableError,
  __resetJobQueueClient,
  sqsJobQueue,
} from "../jobQueue";

describe("sqsJobQueue", () => {
  const original = process.env.AI_JOB_QUEUE_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetJobQueueClient();
    sendMock.mockResolvedValue({});
    process.env.AI_JOB_QUEUE_URL = "https://sqs.test/queue";
  });

  afterEach(() => {
    if (original === undefined) delete process.env.AI_JOB_QUEUE_URL;
    else process.env.AI_JOB_QUEUE_URL = original;
  });

  it("publishes just the jobId — the ROW is the state, not the message", async () => {
    // A second copy of the input on the queue could disagree with the row, and
    // SQS's 256 KB body limit is a bound a generated programme would cross.
    await sqsJobQueue.send({ jobId: "j1" });

    expect(SendMessageCommand).toHaveBeenCalledWith({
      QueueUrl: "https://sqs.test/queue",
      MessageBody: JSON.stringify({ jobId: "j1" }),
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("caches the SQS client across sends within a warm container", async () => {
    await sqsJobQueue.send({ jobId: "j1" });
    await sqsJobQueue.send({ jobId: "j2" });
    // Rebuilding the credential-provider chain per call is pure cold-path cost
    // on a hot path — same reason `aiBedrockClient` caches.
    expect(SQSClient).toHaveBeenCalledTimes(1);
  });

  it("throws JobQueueUnavailableError when no queue is configured", async () => {
    delete process.env.AI_JOB_QUEUE_URL;
    await expect(sqsJobQueue.send({ jobId: "j1" })).rejects.toBeInstanceOf(
      JobQueueUnavailableError,
    );
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("wraps a transport failure as JobQueueUnavailableError, naming the job", async () => {
    // The enqueue path keys off this type to mark the job failed and answer 503
    // rather than 202 (AC-1.2).
    sendMock.mockRejectedValue(new Error("network unreachable"));

    await expect(sqsJobQueue.send({ jobId: "j1" })).rejects.toThrow(
      /failed to publish job j1.*network unreachable/,
    );
  });

  it("wraps a non-Error rejection too", async () => {
    sendMock.mockRejectedValue("string failure");
    await expect(sqsJobQueue.send({ jobId: "j1" })).rejects.toThrow(
      /string failure/,
    );
  });
});
