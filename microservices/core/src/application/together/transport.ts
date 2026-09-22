import {
  ApiGatewayManagementApiClient,
  DeleteConnectionCommand,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { asc, eq, lt, or } from "drizzle-orm";
import { getDb } from "@persistence/db";
import {
  togetherConnections,
  togetherJobs,
  togetherParticipants,
  togetherTickets,
} from "@persistence/db/schema";
import { togetherEnabled, withActors } from "./shared";
import type { TogetherRepository } from "./togetherRepository";

export interface SocketTransport {
  hint(connectionId: string): Promise<void>;
  disconnect(connectionId: string): Promise<void>;
}
function isGone(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "GoneException" ||
      ("$metadata" in error &&
        (error.$metadata as { httpStatusCode?: number })?.httpStatusCode ===
          410))
  );
}
export function awsSocketTransport(): SocketTransport {
  const endpoint = process.env.TOGETHER_MANAGEMENT_ENDPOINT;
  if (!endpoint)
    throw new Error("Together management endpoint is not configured");
  const client = new ApiGatewayManagementApiClient({ endpoint });
  return {
    async hint(connectionId) {
      await client.send(
        new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: Buffer.from('{"type":"sync_required"}'),
        }),
      );
    },
    async disconnect(connectionId) {
      try {
        await client.send(
          new DeleteConnectionCommand({ ConnectionId: connectionId }),
        );
      } catch (error) {
        if (!isGone(error)) throw error;
      }
    },
  };
}
/** Queue is a prompt wakeup only. The committed outbox/job remains authoritative on failure. */
export async function wakeTogether() {
  if (!togetherEnabled()) return;
  const QueueUrl = process.env.TOGETHER_QUEUE_URL;
  if (!QueueUrl) return;
  try {
    await new SQSClient({}).send(
      new SendMessageCommand({ QueueUrl, MessageBody: "{}" }),
    );
  } catch {
    console.warn(
      "[together] wakeup unavailable; durable recovery sweep will retry",
    );
  }
}
async function repository() {
  const { TogetherRepository } = await import("./togetherRepository");
  return new TogetherRepository();
}

/** Bounded, at-least-once drain; concurrent workers may repeat content-free hints safely. */
export async function drainTogether(injected?: {
  repository: TogetherRepository;
  socket: SocketTransport;
}) {
  if (!togetherEnabled()) return { jobs: 0, events: 0 };
  const repo = injected?.repository ?? (await repository());
  const socket = injected?.socket ?? awsSocketTransport();
  const db = getDb();
  let failures = 0,
    jobCount = 0,
    eventCount = 0;
  const pendingJobs = await db
    .select()
    .from(togetherJobs)
    .where(
      or(
        eq(togetherJobs.status, "pending"),
        eq(togetherJobs.effectsDone, false),
      ),
    )
    .orderBy(asc(togetherJobs.completedAt))
    .limit(50);
  for (const job of pendingJobs) {
    try {
      await repo.processJob(job.sessionId, job.userId);
      jobCount++;
    } catch {
      failures++;
    }
  }
  // Revoke sockets even when there are no pending workout events.
  const stale = await db
    .select()
    .from(togetherConnections)
    .where(
      or(
        eq(togetherConnections.revoked, true),
        lt(togetherConnections.expiresAt, new Date()),
      ),
    )
    .limit(100);
  for (const connection of stale) {
    try {
      await socket.disconnect(connection.connectionId);
      await repo.disconnect(connection.connectionId);
    } catch {
      failures++;
    }
  }
  const pendingEvents = await repo.listPendingEvents(100);
  for (const event of pendingEvents) {
    try {
      const peers = await db
        .select({ userId: togetherParticipants.userId })
        .from(togetherParticipants)
        .where(eq(togetherParticipants.sessionId, event.sessionId));
      const connections = await db
        .select()
        .from(togetherConnections)
        .where(eq(togetherConnections.sessionId, event.sessionId))
        .limit(100);
      for (const connection of connections) {
        const allowed =
          !connection.revoked &&
          connection.expiresAt.getTime() > Date.now() &&
          peers.length > 0 &&
          (await withActors(
            peers.map((p) => p.userId),
            (tx) =>
              repo.authorizeDelivery(tx, event.sessionId, connection.userId),
          ));
        if (!allowed) {
          await socket.disconnect(connection.connectionId);
          await repo.disconnect(connection.connectionId);
          continue;
        }
        try {
          await socket.hint(connection.connectionId);
        } catch (error) {
          if (!isGone(error)) throw error;
          await repo.disconnect(connection.connectionId);
        }
      }
      await repo.acknowledgeEvent(event.sessionId, event.revision);
      eventCount++;
    } catch {
      failures++;
    }
  }
  // Expired tickets have no recovery value; receipts/events are retained by their own contract.
  await db
    .delete(togetherTickets)
    .where(lt(togetherTickets.expiresAt, new Date()));
  if (failures)
    throw new Error(`Together recovery has ${failures} retryable failures`);
  // Continue bounded batches promptly; cron remains the backstop if this publish fails.
  if (
    pendingJobs.length === 50 ||
    pendingEvents.length === 100 ||
    stale.length === 100
  )
    await wakeTogether();
  return { jobs: jobCount, events: eventCount };
}
export async function handleTogetherSocket(event: {
  requestContext: { routeKey: string; connectionId: string };
  queryStringParameters?: Record<string, string | undefined> | null;
}) {
  if (!togetherEnabled()) return { statusCode: 404, body: "Not found" };
  const repo = await repository();
  const { routeKey, connectionId } = event.requestContext;
  if (routeKey === "$disconnect") {
    await repo.disconnect(connectionId);
    return { statusCode: 200, body: "" };
  }
  if (routeKey !== "$connect")
    return { statusCode: 400, body: "Commands require authenticated HTTP" };
  const ticket = event.queryStringParameters?.ticket;
  if (!ticket || ticket.length > 512)
    return { statusCode: 403, body: "Forbidden" };
  try {
    await repo.consumeTicket(ticket, connectionId);
    return { statusCode: 200, body: "" };
  } catch (error) {
    if (
      error instanceof Error &&
      "status" in error &&
      Number(error.status) < 500
    )
      return { statusCode: 403, body: "Forbidden" };
    throw error;
  }
}
