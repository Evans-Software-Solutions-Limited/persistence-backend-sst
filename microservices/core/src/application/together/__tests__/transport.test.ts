import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  sqs: vi.fn(),
  client: vi.fn(),
  repo: vi.fn(),
}));
vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@aws-sdk/client-apigatewaymanagementapi", () => ({
  ApiGatewayManagementApiClient: class {
    constructor(options: unknown) {
      mocks.client(options);
    }
    send = mocks.send;
  },
  DeleteConnectionCommand: class {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
  PostToConnectionCommand: class {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
}));
vi.mock("@aws-sdk/client-sqs", () => ({
  SQSClient: class {
    send = mocks.sqs;
  },
  SendMessageCommand: class {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
}));
vi.mock("../togetherRepository", () => ({
  TogetherRepository: class {
    constructor() {
      return mocks.repo();
    }
  },
}));
import { getDb } from "@persistence/db/client";
import * as schema from "@persistence/db/schema";
import type { TogetherRepository } from "../togetherRepository";
import {
  awsSocketTransport,
  drainTogether,
  handleTogetherSocket,
  wakeTogether,
} from "../transport";
let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const session = randomUUID(),
  user = randomUUID();
const repo = {
  processJob: vi.fn(),
  disconnect: vi.fn(),
  listPendingEvents: vi.fn(),
  authorizeDelivery: vi.fn(),
  acknowledgeEvent: vi.fn(),
  consumeTicket: vi.fn(),
};
const socket = { hint: vi.fn(), disconnect: vi.fn() };
const drain = () =>
  drainTogether({ repository: repo as unknown as TogetherRepository, socket });
async function connection(
  id: string,
  options: { revoked?: boolean; expired?: boolean } = {},
) {
  await pg.query("INSERT INTO together_connections VALUES($1,$2,$3,$4,$5)", [
    id,
    session,
    user,
    options.expired ? "2000-01-01" : "2099-01-01",
    options.revoked ?? false,
  ]);
}
beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubEnv("TOGETHER_ENABLED", "true");
  vi.stubEnv("TOGETHER_QUEUE_URL", "queue");
  vi.stubEnv("TOGETHER_MANAGEMENT_ENDPOINT", "https://management.example/test");
  pg = await PGlite.create();
  await pg.exec(`CREATE TABLE profiles(id uuid PRIMARY KEY, deleted_at timestamptz); CREATE TABLE together_actors(user_id uuid PRIMARY KEY REFERENCES profiles(id));
CREATE TABLE together_jobs(session_id uuid,user_id uuid,client_record_id uuid,status text,completed_at timestamptz,effects_done boolean);
CREATE TABLE together_participants(session_id uuid,user_id uuid);
CREATE TABLE together_connections(connection_id text PRIMARY KEY,session_id uuid,user_id uuid,expires_at timestamptz,revoked boolean);
CREATE TABLE together_tickets(token_hash text PRIMARY KEY,session_id uuid,user_id uuid,expires_at timestamptz,used boolean);
INSERT INTO profiles VALUES('${user}',null); INSERT INTO together_participants VALUES('${session}','${user}');`);
  db = drizzle(pg, { schema });
  vi.mocked(getDb).mockReturnValue(db as never);
  repo.listPendingEvents.mockResolvedValue([]);
  repo.authorizeDelivery.mockResolvedValue(true);
  mocks.repo.mockReturnValue(repo);
  repo.disconnect.mockImplementation(async (id: string) => {
    await db
      .delete(schema.togetherConnections)
      .where(eq(schema.togetherConnections.connectionId, id));
  });
});
afterEach(async () => {
  await pg.close();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe("Together transport", () => {
  it("fails closed without touching recovery storage and only queues enabled configured wakeups", async () => {
    vi.stubEnv("TOGETHER_ENABLED", "");
    expect(await drainTogether()).toEqual({ jobs: 0, events: 0 });
    await wakeTogether();
    vi.stubEnv("TOGETHER_ENABLED", "true");
    vi.stubEnv("TOGETHER_QUEUE_URL", "");
    await wakeTogether();
    expect(mocks.sqs).not.toHaveBeenCalled();
    vi.stubEnv("TOGETHER_QUEUE_URL", "queue");
    await wakeTogether();
    expect(mocks.sqs.mock.calls[0][0].input).toEqual({
      QueueUrl: "queue",
      MessageBody: "{}",
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.sqs.mockRejectedValueOnce(new Error("secret"));
    await wakeTogether();
    expect(warn).toHaveBeenCalledWith(expect.not.stringContaining("secret"));
  });
  it("sends content-free AWS hints and treats already gone connections as disconnected", async () => {
    vi.stubEnv("TOGETHER_MANAGEMENT_ENDPOINT", "");
    expect(awsSocketTransport).toThrow("not configured");
    vi.stubEnv(
      "TOGETHER_MANAGEMENT_ENDPOINT",
      "https://management.example/test",
    );
    const transport = awsSocketTransport();
    await transport.hint("one");
    expect(mocks.client).toHaveBeenCalledWith({
      endpoint: "https://management.example/test",
    });
    expect(mocks.send.mock.calls[0][0].input.ConnectionId).toBe("one");
    expect(mocks.send.mock.calls[0][0].input.Data.toString()).toBe(
      '{"type":"sync_required"}',
    );
    await transport.disconnect("one");
    expect(mocks.send.mock.calls[1][0].input).toEqual({ ConnectionId: "one" });
    for (const error of [
      Object.assign(new Error(), { name: "GoneException" }),
      Object.assign(new Error(), { $metadata: { httpStatusCode: 410 } }),
    ]) {
      mocks.send.mockRejectedValueOnce(error);
      await expect(transport.disconnect("one")).resolves.toBeUndefined();
    }
    for (const error of [
      new Error("retry"),
      "network",
      Object.assign(new Error("busy"), { $metadata: { httpStatusCode: 503 } }),
      Object.assign(new Error("absent"), { $metadata: undefined }),
    ]) {
      mocks.send.mockRejectedValueOnce(error);
      await expect(transport.disconnect("one")).rejects.toBe(error);
    }
  });
  it("processes only pending jobs or incomplete effects and removes expired tickets", async () => {
    await pg.exec(
      `INSERT INTO together_jobs VALUES('${session}','${user}',gen_random_uuid(),'pending',now(),false),('${session}','${user}',gen_random_uuid(),'saved',now(),false),('${session}','${user}',gen_random_uuid(),'saved',now(),true); INSERT INTO together_tickets VALUES('old','${session}','${user}','2000-01-01',false),('new','${session}','${user}','2099-01-01',false)`,
    );
    expect(await drain()).toEqual({ jobs: 2, events: 0 });
    expect(repo.processJob).toHaveBeenCalledTimes(2);
    expect(
      (await pg.query("SELECT token_hash FROM together_tickets")).rows,
    ).toEqual([{ token_hash: "new" }]);
  });
  it("closes revoked and expired sockets even without events and retries failed cleanup/jobs", async () => {
    await connection("revoked", { revoked: true });
    await connection("expired", { expired: true });
    await connection("live");
    await pg.exec(
      `INSERT INTO together_jobs VALUES('${session}','${user}',gen_random_uuid(),'pending',now(),false)`,
    );
    repo.processJob.mockRejectedValueOnce(new Error("retry"));
    socket.disconnect.mockRejectedValueOnce(new Error("retry"));
    await expect(drain()).rejects.toThrow("2 retryable failures");
    expect(
      (
        await pg.query(
          "SELECT connection_id FROM together_connections ORDER BY connection_id",
        )
      ).rows,
    ).toEqual([{ connection_id: "live" }, { connection_id: "revoked" }]);
    await drain();
    expect(repo.disconnect).toHaveBeenCalledWith("revoked");
  });
  it("authorizes every delivery under actor locks and acknowledges after content-free hints", async () => {
    await connection("allowed");
    await connection("denied");
    repo.authorizeDelivery
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    repo.listPendingEvents.mockResolvedValue([
      { sessionId: session, revision: 3 },
    ]);
    expect(await drain()).toEqual({ jobs: 0, events: 1 });
    expect(socket.hint).toHaveBeenCalledTimes(1);
    expect(socket.hint).toHaveBeenCalledWith("allowed");
    expect(socket.disconnect).toHaveBeenCalledWith("denied");
    expect(repo.authorizeDelivery.mock.calls[0].slice(1)).toEqual([
      session,
      user,
    ]);
    expect((await pg.query("SELECT * FROM together_actors")).rows).toHaveLength(
      1,
    );
    expect(repo.acknowledgeEvent).toHaveBeenCalledWith(session, 3);
  });
  it("retains unacknowledged events on delivery failures and safely retries Gone sockets", async () => {
    await connection("live");
    repo.listPendingEvents.mockResolvedValue([
      { sessionId: session, revision: 3 },
    ]);
    socket.hint.mockRejectedValueOnce(new Error("temporary"));
    await expect(drain()).rejects.toThrow("1 retryable failures");
    expect(repo.acknowledgeEvent).not.toHaveBeenCalled();
    socket.hint.mockRejectedValueOnce(
      Object.assign(new Error(), { name: "GoneException" }),
    );
    await drain();
    expect(repo.disconnect).toHaveBeenCalledWith("live");
    expect(repo.acknowledgeEvent).toHaveBeenCalledWith(session, 3);
  });
  it("rechecks expired/revoked sockets and rejects delivery after all members disappear", async () => {
    await connection("revoked", { revoked: true });
    await connection("expired", { expired: true });
    await connection("orphan");
    await pg.exec("DELETE FROM together_participants");
    // Cleanup failure leaves rows for the per-event authorization check.
    socket.disconnect
      .mockRejectedValueOnce(new Error("retry"))
      .mockRejectedValueOnce(new Error("retry"));
    repo.listPendingEvents.mockResolvedValue([
      { sessionId: session, revision: 4 },
    ]);
    await expect(drain()).rejects.toThrow("2 retryable failures");
    expect(socket.hint).not.toHaveBeenCalled();
    expect(repo.authorizeDelivery).not.toHaveBeenCalled();
    expect(repo.disconnect).toHaveBeenCalledTimes(3);
  });
  it("uses the default repository and transport and schedules continuation for each full batch", async () => {
    expect(await drainTogether()).toEqual({ jobs: 0, events: 0 });
    expect(mocks.repo).toHaveBeenCalled();
    await pg.exec(
      `INSERT INTO together_jobs SELECT '${session}'::uuid,'${user}'::uuid,gen_random_uuid(),'pending',now(),false FROM generate_series(1,50)`,
    );
    await drain();
    expect(mocks.sqs).toHaveBeenCalledTimes(1);
    await pg.exec("DELETE FROM together_jobs");
    repo.listPendingEvents.mockResolvedValue(
      Array.from({ length: 100 }, (_, revision) => ({
        sessionId: session,
        revision,
      })),
    );
    await drain();
    expect(mocks.sqs).toHaveBeenCalledTimes(2);
    repo.listPendingEvents.mockResolvedValue([]);
    await pg.exec(
      `INSERT INTO together_connections SELECT n::text,'${session}'::uuid,'${user}'::uuid,'2000-01-01',true FROM generate_series(1,100) n`,
    );
    await drain();
    expect(mocks.sqs).toHaveBeenCalledTimes(3);
  });
  it("delegates connection ticket consumption and hides authorization failure details", async () => {
    const event = (routeKey: string, ticket?: string) => ({
      requestContext: { routeKey, connectionId: "socket" },
      queryStringParameters: { ticket },
    });
    vi.stubEnv("TOGETHER_ENABLED", "");
    expect(
      (await handleTogetherSocket(event("$connect", "ticket"))).statusCode,
    ).toBe(404);
    vi.stubEnv("TOGETHER_ENABLED", "true");
    expect((await handleTogetherSocket(event("$default"))).statusCode).toBe(
      400,
    );
    expect(
      (
        await handleTogetherSocket({
          requestContext: { routeKey: "$connect", connectionId: "socket" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await handleTogetherSocket(event("$connect", "x".repeat(513))))
        .statusCode,
    ).toBe(403);
    expect(
      (await handleTogetherSocket(event("$connect", "ticket"))).statusCode,
    ).toBe(200);
    expect(repo.consumeTicket).toHaveBeenCalledWith("ticket", "socket");
    repo.consumeTicket.mockRejectedValueOnce(
      Object.assign(new Error("private reason"), { status: 403 }),
    );
    expect(await handleTogetherSocket(event("$connect", "used"))).toEqual({
      statusCode: 403,
      body: "Forbidden",
    });
    for (const error of [
      new Error("database"),
      Object.assign(new Error("database"), { status: 503 }),
      "unknown",
    ]) {
      repo.consumeTicket.mockRejectedValueOnce(error);
      await expect(
        handleTogetherSocket(event("$connect", "ticket")),
      ).rejects.toBe(error);
    }
    expect((await handleTogetherSocket(event("$disconnect"))).statusCode).toBe(
      200,
    );
    expect(repo.disconnect).toHaveBeenCalledWith("socket");
  });
});
