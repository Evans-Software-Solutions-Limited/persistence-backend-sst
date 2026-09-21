/** PER-20 executable spike only. Never mounted or imported by production API. */
import { createHash, createHmac, randomUUID } from "node:crypto";
import { and, asc, eq, gt } from "drizzle-orm";
import { boolean, integer, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import type { PgliteDatabase } from "drizzle-orm/pglite";

export type SetInput = {
  setId: string;
  reps: number;
  weightKg: number;
  completed: boolean;
};
export type Participant = {
  status: "active" | "finalizing" | "saved" | "finished_empty";
  revision: number;
  generation: number;
  delegated: boolean;
  left: boolean;
  sets: SetInput[];
  historyId?: string;
};
type State = {
  host: string;
  revision: number;
  members: Record<string, Participant>;
  paid: string[];
  severed: boolean;
  invite?: { id: string; hash: string; expires: number; consumed: boolean };
  requests: Record<string, string>;
};
export type Operation =
  | { kind: "invite" }
  | { kind: "revokeInvite" }
  | {
      kind: "request";
      token: string;
      consentVersion: "together-v1";
      consentAccepted: true;
    }
  | { kind: "approve"; requestId: string; expectedRevision: number }
  | { kind: "delegate"; allowed: boolean }
  | {
      kind: "set";
      commandId: string;
      athleteId: string;
      expectedVersion: number;
      generation?: number;
      set: SetInput;
    }
  | { kind: "finish" | "leave"; expectedOwnRevision: number };
export type Result = {
  revision: number;
  status?: Participant["status"];
  historyId?: string;
  tokenId?: string;
  requestId?: string;
  generation?: number;
};
type Event = {
  revision: number;
  actor: string;
  operation:
    | Operation
    | {
        kind: "completed";
        status: "saved" | "finished_empty";
        historyId?: string;
      };
};
const sessions = pgTable("proof_sessions", {
  id: text().primaryKey(),
  state: jsonb().$type<State>().notNull(),
});
const receipts = pgTable("proof_receipts", {
  id: text().primaryKey(),
  hash: text().notNull(),
  result: jsonb().$type<Result>().notNull(),
});
const events = pgTable("proof_events", {
  id: text().primaryKey(),
  session: text().notNull(),
  revision: integer().notNull(),
  created: text().notNull(),
  event: jsonb().$type<Event>().notNull(),
  delivered: boolean().notNull(),
});
const jobs = pgTable("proof_jobs", {
  id: text().primaryKey(),
  session: text().notNull(),
  actor: text().notNull(),
  revision: integer().notNull(),
  sets: jsonb().$type<SetInput[]>().notNull(),
  done: boolean().notNull(),
});
const recordings = pgTable("proof_recordings", {
  id: text().primaryKey(),
  actor: text().notNull(),
  sets: jsonb().$type<SetInput[]>().notNull(),
  effects: integer().notNull(),
});
export const proofSchema = { sessions, receipts, events, jobs, recordings };
/** Test fixture DDL, deliberately not a production migration. */
export const proofDdl = `
CREATE TABLE proof_sessions (id text PRIMARY KEY, state jsonb NOT NULL);
CREATE TABLE proof_receipts (id text PRIMARY KEY, hash text NOT NULL, result jsonb NOT NULL);
CREATE TABLE proof_events (id text PRIMARY KEY, session text NOT NULL REFERENCES proof_sessions(id), revision integer NOT NULL, created text NOT NULL, event jsonb NOT NULL, delivered boolean NOT NULL, UNIQUE(session,revision));
CREATE TABLE proof_jobs (id text PRIMARY KEY, session text NOT NULL REFERENCES proof_sessions(id), actor text NOT NULL, revision integer NOT NULL, sets jsonb NOT NULL, done boolean NOT NULL, UNIQUE(session,actor));
CREATE TABLE proof_recordings (id text PRIMARY KEY REFERENCES proof_jobs(id), actor text NOT NULL, sets jsonb NOT NULL, effects integer NOT NULL CHECK(effects=1));`;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function check(ok: unknown, code: string): asserts ok {
  if (!ok) throw new Error(code);
}
function uuid(value: unknown) {
  check(
    typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      ),
    "INVALID_INPUT",
  );
}
function version(value: unknown) {
  check(Number.isSafeInteger(value) && Number(value) >= 0, "INVALID_INPUT");
}
function validate(op: Operation) {
  switch (op.kind) {
    case "invite":
    case "revokeInvite":
      break;
    case "request":
      check(
        typeof op.token === "string" &&
          /^[0-9a-f]{64}$/.test(op.token) &&
          op.consentVersion === "together-v1" &&
          op.consentAccepted === true,
        "INVALID_INPUT",
      );
      break;
    case "approve":
      uuid(op.requestId);
      version(op.expectedRevision);
      break;
    case "delegate":
      check(typeof op.allowed === "boolean", "INVALID_INPUT");
      break;
    case "set":
      uuid(op.commandId);
      uuid(op.athleteId);
      version(op.expectedVersion);
      check(op.set && typeof op.set === "object", "INVALID_INPUT");
      uuid(op.set.setId);
      if (op.generation !== undefined) version(op.generation);
      check(
        Number.isInteger(op.set.reps) &&
          op.set.reps >= 0 &&
          op.set.reps <= 10000 &&
          Number.isFinite(op.set.weightKg) &&
          op.set.weightKg >= 0 &&
          typeof op.set.completed === "boolean",
        "INVALID_INPUT",
      );
      break;
    case "finish":
    case "leave":
      version(op.expectedOwnRevision);
      break;
    default:
      throw new Error("INVALID_INPUT");
  }
}
function member(): Participant {
  return {
    status: "active",
    revision: 0,
    generation: 0,
    delegated: false,
    left: false,
    sets: [],
  };
}
function collaborative(s: State) {
  return (
    !s.severed &&
    Object.keys(s.members).every((id) => s.paid.includes(id)) &&
    Object.values(s.members).every((m) => !m.left)
  );
}
function authorized(s: State, actor: string, op: Operation) {
  if (op.kind === "request") {
    check(
      collaborative(s) &&
        s.paid.includes(actor) &&
        s.members[s.host].status === "active",
      "FORBIDDEN",
    );
    return;
  }
  const own = s.members[actor];
  check(own, "FORBIDDEN");
  if (
    (op.kind === "set" && op.athleteId === actor) ||
    op.kind === "finish" ||
    op.kind === "leave" ||
    (op.kind === "delegate" && !op.allowed)
  )
    return;
  check(collaborative(s) && !own.left && s.paid.includes(actor), "FORBIDDEN");
  if (
    op.kind === "invite" ||
    op.kind === "revokeInvite" ||
    op.kind === "approve"
  )
    check(actor === s.host && own.status === "active", "FORBIDDEN");
  if (op.kind === "set") {
    const target = s.members[op.athleteId];
    check(
      target &&
        target.status === "active" &&
        target.delegated &&
        target.generation === op.generation,
      "DELEGATION_REVOKED",
    );
  }
}

export class RecoveryProof {
  constructor(
    readonly db: PgliteDatabase<typeof proofSchema>,
    private readonly secret: string,
    private readonly now: () => number = Date.now,
  ) {}
  /** Trusted fixture setup: production promotion / catalog adapters are outside this proof. */
  async seed(host: string, paid: string[]) {
    uuid(host);
    paid.forEach(uuid);
    const id = randomUUID();
    await this.db.insert(sessions).values({
      id,
      state: {
        host,
        revision: 1,
        members: { [host]: member() },
        paid,
        severed: false,
        requests: {},
      },
    });
    return id;
  }
  token(session: string, tokenId: string) {
    return createHmac("sha256", this.secret)
      .update(`${session}:${tokenId}`)
      .digest("hex");
  }
  /** Policy is trusted fixture input, never client data. Block/expiry severance is sticky. */
  async policy(session: string, paid: string[], blocked = false) {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(sessions)
        .where(eq(sessions.id, session))
        .for("update");
      check(row, "FORBIDDEN");
      row.state.paid = paid;
      row.state.severed ||=
        blocked ||
        !Object.keys(row.state.members).every((id) => paid.includes(id));
      await tx
        .update(sessions)
        .set({ state: row.state })
        .where(eq(sessions.id, session));
    });
  }
  /** Actor is supplied by a trusted authentication adapter, never copied from the body. */
  async execute(
    actor: string,
    session: string,
    key: string,
    op: Operation,
    fault?: "beforeCommit",
  ): Promise<Result> {
    uuid(actor);
    uuid(session);
    uuid(key);
    validate(op);
    // Explicit projection canonicalizes key order while preserving every semantic field.
    const requestHash = hash(
      JSON.stringify(
        op,
        Object.keys(op).concat("setId", "reps", "weightKg", "completed").sort(),
      ),
    );
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(sessions)
        .where(eq(sessions.id, session))
        .for("update");
      check(row, "FORBIDDEN");
      const s = row.state;
      authorized(s, actor, op); // Current access/generation always precedes receipt reads.
      if (op.kind === "request") {
        check(
          s.invite && !s.invite.consumed && s.invite.hash === hash(op.token),
          "FORBIDDEN",
        );
        check(s.invite.expires > this.now(), "INVITE_EXPIRED");
      }
      const receiptId = `${session}:${actor}:${op.kind}:${key}`;
      const [receipt] = await tx
        .select()
        .from(receipts)
        .where(eq(receipts.id, receiptId));
      if (receipt) {
        check(receipt.hash === requestHash, "IDEMPOTENCY_MISMATCH");
        return op.kind === "finish" || op.kind === "leave"
          ? {
              ...receipt.result,
              status: s.members[actor].status,
              historyId: s.members[actor].historyId,
            }
          : receipt.result;
      }
      const commandReceiptId =
        op.kind === "set"
          ? `${session}:${actor}:command:${op.commandId}`
          : null;
      if (commandReceiptId) {
        const [commandReceipt] = await tx
          .select()
          .from(receipts)
          .where(eq(receipts.id, commandReceiptId));
        if (commandReceipt) {
          check(commandReceipt.hash === requestHash, "IDEMPOTENCY_MISMATCH");
          await tx.insert(receipts).values({
            id: receiptId,
            hash: requestHash,
            result: commandReceipt.result,
          });
          return commandReceipt.result;
        }
      }
      const result: Result = { revision: s.revision + 1 };
      switch (op.kind) {
        case "invite": {
          check(
            !s.invite || s.invite.consumed || s.invite.expires <= this.now(),
            "INVALID_STATE",
          );
          const id = randomUUID();
          s.requests = {};
          s.invite = {
            id,
            hash: hash(this.token(session, id)),
            expires: this.now() + 900000,
            consumed: false,
          };
          result.tokenId = id;
          break;
        }
        case "revokeInvite":
          delete s.invite;
          s.requests = {};
          break;
        case "request": {
          check(!s.members[actor], "INVALID_STATE");
          check(
            s.invite && !s.invite.consumed && s.invite.hash === hash(op.token),
            "FORBIDDEN",
          );
          check(s.invite.expires > this.now(), "INVITE_EXPIRED");
          const id = randomUUID();
          s.requests[id] = actor;
          result.requestId = id;
          break;
        }
        case "approve": {
          check(Object.keys(s.members).length < 2, "SESSION_FULL");
          check(s.revision === op.expectedRevision, "VERSION_CONFLICT");
          const applicant = s.requests[op.requestId];
          check(applicant && s.paid.includes(applicant), "FORBIDDEN");
          check(
            s.invite && !s.invite.consumed && s.invite.expires > this.now(),
            "INVITE_EXPIRED",
          );
          s.members[applicant] = member();
          s.invite.consumed = true;
          s.requests = {};
          break;
        }
        case "delegate": {
          const own = s.members[actor];
          check(own.status === "active", "INVALID_STATE");
          own.delegated = op.allowed;
          result.generation = ++own.generation;
          break;
        }
        case "set": {
          const target = s.members[op.athleteId];
          check(target.status === "active", "INVALID_STATE");
          check(target.revision === op.expectedVersion, "VERSION_CONFLICT");
          const index = target.sets.findIndex(
            (set) => set.setId === op.set.setId,
          );
          check(index >= 0 || target.sets.length < 100, "INVALID_INPUT");
          if (index >= 0) target.sets[index] = op.set;
          else target.sets.push(op.set);
          target.revision++;
          break;
        }
        case "finish":
        case "leave": {
          const own = s.members[actor];
          check(own.revision === op.expectedOwnRevision, "VERSION_CONFLICT");
          if (own.status === "active") {
            own.status = "finalizing";
            await tx.insert(jobs).values({
              id: randomUUID(),
              session,
              actor,
              revision: own.revision,
              sets: own.sets,
              done: false,
            });
          }
          if (op.kind === "leave") {
            own.left = true;
            own.delegated = false;
            own.generation++;
            s.severed = true;
          }
          if (actor === s.host) delete s.invite;
          result.status = own.status;
          result.historyId = own.historyId;
          break;
        }
      }
      s.revision++;
      await tx
        .update(sessions)
        .set({ state: s })
        .where(eq(sessions.id, session));
      await tx
        .insert(receipts)
        .values({ id: receiptId, hash: requestHash, result });
      if (commandReceiptId)
        await tx
          .insert(receipts)
          .values({ id: commandReceiptId, hash: requestHash, result });
      // Invitation secrets never enter receipts or ordered protocol events.
      const event: Event = {
        revision: s.revision,
        actor,
        operation:
          op.kind === "request"
            ? {
                kind: "request",
                token: "[redacted]",
                consentVersion: "together-v1",
                consentAccepted: true,
              }
            : op,
      };
      await tx.insert(events).values({
        id: randomUUID(),
        session,
        revision: s.revision,
        created: String(this.now()),
        event,
        delivered: false,
      });
      if (fault) throw new Error("INJECTED_BEFORE_COMMIT");
      return result;
    });
  }
  async snapshot(actor: string, session: string) {
    uuid(actor);
    uuid(session);
    const [row] = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, session));
    check(row && row.state.members[actor], "FORBIDDEN");
    const s = row.state;
    return {
      revision: s.revision,
      members: collaborative(s) ? s.members : { [actor]: s.members[actor] },
    };
  }
  async replay(actor: string, session: string, afterRevision: number) {
    uuid(actor);
    uuid(session);
    version(afterRevision);
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(sessions)
        .where(eq(sessions.id, session))
        .for("update");
      check(
        row && row.state.members[actor] && collaborative(row.state),
        "FORBIDDEN",
      );
      check(afterRevision <= row.state.revision, "VERSION_CONFLICT");
      const pending = await tx
        .select()
        .from(events)
        .where(
          and(eq(events.session, session), gt(events.revision, afterRevision)),
        )
        .orderBy(asc(events.revision))
        .limit(500);
      check(
        !pending.length || Number(pending[0].created) > this.now() - 86400000,
        "CURSOR_EXPIRED",
      );
      return pending.map((row) => row.event);
    });
  }
  /** At-least-once, content-free hints; authorization is on subsequent HTTP replay. */
  async dispatch(
    send: (sessionId: string, hint: { type: "sync_required" }) => Promise<void>,
  ) {
    const pending = await this.db
      .select()
      .from(events)
      .where(eq(events.delivered, false))
      .orderBy(asc(events.revision));
    for (const row of pending) {
      await send(row.session, { type: "sync_required" });
      await this.db
        .update(events)
        .set({ delivered: true })
        .where(eq(events.id, row.id));
    }
  }
  /** Recording FIXTURE: effect marker is not production statistics/PR integration. */
  async complete(
    session: string,
    actor: string,
    fault?: "afterRecord" | "beforeMapping",
  ) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(sessions)
        .where(eq(sessions.id, session))
        .for("update");
      check(row && row.state.members[actor], "FORBIDDEN");
      const [job] = await tx
        .select()
        .from(jobs)
        .where(and(eq(jobs.session, session), eq(jobs.actor, actor)));
      check(job, "INVALID_STATE");
      if (job.done) return row.state.members[actor];
      const own = row.state.members[actor];
      const performed = job.sets.filter((set) => set.completed);
      if (performed.length) {
        await tx
          .insert(recordings)
          .values({ id: job.id, actor, sets: performed, effects: 1 })
          .onConflictDoNothing();
        if (fault === "afterRecord") throw new Error("INJECTED_AFTER_RECORD");
        own.historyId = job.id;
      }
      own.status = performed.length ? "saved" : "finished_empty";
      row.state.revision++;
      await tx.insert(events).values({
        id: randomUUID(),
        session,
        revision: row.state.revision,
        created: String(this.now()),
        event: {
          revision: row.state.revision,
          actor,
          operation: {
            kind: "completed",
            status: own.status,
            historyId: own.historyId,
          },
        },
        delivered: false,
      });
      if (fault === "beforeMapping") throw new Error("INJECTED_BEFORE_MAPPING");
      await tx
        .update(sessions)
        .set({ state: row.state })
        .where(eq(sessions.id, session));
      await tx.update(jobs).set({ done: true }).where(eq(jobs.id, job.id));
      return own;
    });
  }
}
