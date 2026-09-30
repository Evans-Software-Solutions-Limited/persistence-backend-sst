/** @jest-environment node */
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TogetherJournal,
  type TogetherJournalCommand,
  type TogetherJournalDatabase,
} from "../togetherJournal";

function adapter(db: DatabaseSync): TogetherJournalDatabase {
  return {
    execSync: (sql) => db.exec(sql),
    runSync: (sql, params) => db.prepare(sql).run(...params),
    getFirstSync: <T>(sql: string, params: (string | number | null)[]) =>
      (db.prepare(sql).get(...params) as T | undefined) ?? null,
    getAllSync: <T>(sql: string, params: (string | number | null)[]) =>
      db.prepare(sql).all(...params) as T[],
    withTransactionSync(action) {
      db.exec("BEGIN IMMEDIATE");
      try {
        action();
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

const command: TogetherJournalCommand = {
  commandId: "command-1",
  sessionId: "session-1",
  executionId: "execution-1",
  payload: JSON.stringify({ operation: "upsertSet", reps: 8, weightKg: 40 }),
};

describe("Together durable owner journal (real SQLite)", () => {
  let directory: string;
  let path: string;
  let db: DatabaseSync;
  let journal: TogetherJournal;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "together-journal-"));
    path = join(directory, "journal.db");
    db = new DatabaseSync(path);
    journal = new TogetherJournal(adapter(db), "athlete-a");
  });
  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("reopens durable commands and peer receipts without claiming server acceptance", () => {
    const saved = journal.append(command);
    expect(saved.serverOutcome).toBeNull();
    expect(saved.peerReceipts).toEqual([]);
    journal.recordPeerReceipt(command, "athlete-b");
    db.close();
    db = new DatabaseSync(path);
    journal = new TogetherJournal(adapter(db), "athlete-a");
    expect(journal.list(command.sessionId, command.executionId)).toEqual([
      { ...saved, peerReceipts: ["athlete-b"] },
    ]);
    expect(journal.append(command)).toEqual({
      ...saved,
      peerReceipts: ["athlete-b"],
    });
  });

  it("deduplicates receipt retries and retains all payloads after server sync", () => {
    const saved = journal.append(command);
    journal.recordPeerReceipt(command, "athlete-c");
    journal.recordPeerReceipt(command, "athlete-b");
    journal.recordPeerReceipt(command, "athlete-b");
    journal.recordServerOutcome(command, "review");
    journal.recordServerOutcome(command, "accepted");
    journal.recordServerOutcome(command, "accepted");
    const second = { ...command, commandId: "command-2" };
    journal.append(second);
    expect(journal.list(command.sessionId, command.executionId)).toEqual([
      {
        ...saved,
        serverOutcome: "accepted",
        peerReceipts: ["athlete-b", "athlete-c"],
      },
      expect.objectContaining({ ...second, serverOutcome: null }),
    ]);
    expect(() => journal.recordServerOutcome(command, "review")).toThrow(
      "Conflicting",
    );
    expect(() => journal.recordServerOutcome(command, "rejected")).toThrow(
      "Conflicting",
    );
  });

  it("isolates accounts, sessions and executions even when command IDs collide", () => {
    journal.append(command);
    const other = new TogetherJournal(adapter(db), "athlete-b");
    expect(other.list(command.sessionId, command.executionId)).toEqual([]);
    expect(() => other.recordPeerReceipt(command, "athlete-c")).toThrow(
      "Unknown",
    );
    expect(() => other.recordServerOutcome(command, "accepted")).toThrow(
      "Unknown",
    );
    other.append({ ...command, payload: '{"reps":10}' });
    expect(journal.list(command.sessionId, "different-execution")).toEqual([]);
    expect(journal.list("different-session", command.executionId)).toEqual([]);
    expect(
      journal.list(command.sessionId, command.executionId)[0].payload,
    ).toBe(command.payload);
  });

  it.each([
    { sessionId: "other" },
    { executionId: "other" },
    { payload: '{"reps":9}' },
  ])("rejects conflicting command identity atomically: %j", (change) => {
    journal.append(command);
    const conflicting = { ...command, ...change };
    expect(() => journal.append(conflicting)).toThrow("different content");
    expect(() => journal.recordPeerReceipt(conflicting, "athlete-b")).toThrow(
      "different content",
    );
    expect(() => journal.recordServerOutcome(conflicting, "accepted")).toThrow(
      "different content",
    );
    expect(journal.list(command.sessionId, command.executionId)).toEqual([
      expect.objectContaining({
        ...command,
        peerReceipts: [],
        serverOutcome: null,
      }),
    ]);
  });

  it("preserves rejected operations for explicit recovery", () => {
    journal.append(command);
    journal.recordServerOutcome(command, "rejected");
    journal.recordServerOutcome(command, "rejected");
    expect(() => journal.recordServerOutcome(command, "accepted")).toThrow();
    expect(
      journal.list(command.sessionId, command.executionId)[0],
    ).toMatchObject({
      payload: command.payload,
      serverOutcome: "rejected",
    });
  });

  it("rolls back a failed disk write and never returns a saved acknowledgement", () => {
    db.exec(`CREATE TRIGGER fail_write BEFORE INSERT ON together_owner_journal
      BEGIN SELECT RAISE(ABORT, 'disk write failure'); END;`);
    expect(() => journal.append(command)).toThrow("disk write failure");
    expect(journal.list(command.sessionId, command.executionId)).toEqual([]);
  });

  it("rejects malformed or oversized commands and invalid receipts", () => {
    expect(() => new TogetherJournal(adapter(db), " ")).toThrow("identifier");
    for (const change of [
      { commandId: "" },
      { sessionId: "x".repeat(201) },
      { executionId: " " },
      { payload: "x".repeat(262145) },
      { payload: "not json" },
      { payload: "null" },
      { payload: "[]" },
      { payload: "1" },
    ])
      expect(() => journal.append({ ...command, ...change })).toThrow();
    journal.append(command);
    expect(() => journal.recordPeerReceipt(command, "")).toThrow("identifier");
    expect(() => journal.recordPeerReceipt(command, "athlete-a")).toThrow(
      "Own device",
    );
    expect(() =>
      // @ts-expect-error Runtime boundary must also reject malformed values.
      journal.recordServerOutcome(command, "lost"),
    ).toThrow("Invalid");
  });
});
