import type { TogetherJournalDatabase } from "../storage/togetherJournal";
import {
  requestHash,
  verifyRoster,
  type OfflineRoster,
  type Signed,
  type TrustedKeys,
} from "./security/identity";

export interface HostPin {
  sessionId: string;
  hostUserId: string;
  hostDeviceId: string;
}

export interface LocalCommand {
  commandId: string;
  sessionId: string;
  executionId: string;
  payload: string;
}

/** Immutable, account-scoped peer storage. Nothing here materializes history. */
export class TogetherLocalStore {
  constructor(
    private readonly db: TogetherJournalDatabase,
    readonly accountId: string,
  ) {
    if (!accountId || accountId.length > 200)
      throw new Error("Invalid account");
    db.execSync(`
      CREATE TABLE IF NOT EXISTS together_shared_suspensions (
        account_id TEXT NOT NULL, session_id TEXT NOT NULL, owner_id TEXT NOT NULL,
        recipient_id TEXT NOT NULL, revision INTEGER NOT NULL,
        PRIMARY KEY(account_id,session_id,owner_id,recipient_id)
      );
      CREATE TABLE IF NOT EXISTS together_shared_events (
        account_id TEXT NOT NULL, session_id TEXT NOT NULL, event_id TEXT NOT NULL,
        envelope TEXT NOT NULL, PRIMARY KEY(account_id, session_id, event_id)
      );
      CREATE TABLE IF NOT EXISTS together_local_rosters (
        account_id TEXT NOT NULL, session_id TEXT NOT NULL,
        revision INTEGER NOT NULL, envelope TEXT NOT NULL,
        PRIMARY KEY(account_id, session_id, revision)
      );
      CREATE TABLE IF NOT EXISTS together_local_closed (
        account_id TEXT NOT NULL, session_id TEXT NOT NULL,
        PRIMARY KEY(account_id, session_id)
      );
      CREATE TABLE IF NOT EXISTS together_local_policy (
        account_id TEXT NOT NULL, session_id TEXT NOT NULL, policy TEXT NOT NULL,
        PRIMARY KEY(account_id, session_id)
      );
      CREATE TABLE IF NOT EXISTS together_local_inbox (
        account_id TEXT NOT NULL, session_id TEXT NOT NULL,
        owner_id TEXT NOT NULL, command_id TEXT NOT NULL,
        execution_id TEXT NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY(account_id, session_id, owner_id, command_id)
      );
    `);
  }

  sharedSuspensions(
    sessionId: string,
  ): { ownerId: string; recipientId: string; revision: number }[] {
    return this.db.getAllSync(
      "SELECT owner_id AS ownerId,recipient_id AS recipientId,revision FROM together_shared_suspensions WHERE account_id = ? AND session_id = ?",
      [this.accountId, sessionId],
    );
  }
  suspendShared(
    sessionId: string,
    ownerId: string,
    recipientId: string,
    revision: number,
  ): void {
    this.db.runSync(
      "INSERT INTO together_shared_suspensions(account_id,session_id,owner_id,recipient_id,revision) VALUES (?,?,?,?,?) ON CONFLICT(account_id,session_id,owner_id,recipient_id) DO UPDATE SET revision = MAX(revision,excluded.revision)",
      [this.accountId, sessionId, ownerId, recipientId, revision],
    );
  }

  sharedEvents(sessionId: string): string[] {
    return this.db
      .getAllSync<{
        envelope: string;
      }>(
        "SELECT envelope FROM together_shared_events WHERE account_id = ? AND session_id = ? ORDER BY rowid",
        [this.accountId, sessionId],
      )
      .map((row) => row.envelope);
  }
  saveShared(sessionId: string, eventId: string, envelope: string): void {
    this.db.withTransactionSync(() => {
      const previous = this.db.getFirstSync<{ envelope: string }>(
        "SELECT envelope FROM together_shared_events WHERE account_id = ? AND session_id = ? AND event_id = ?",
        [this.accountId, sessionId, eventId],
      );
      if (previous) {
        if (previous.envelope !== envelope)
          throw new Error("Conflicting shared event");
        return;
      }
      const count = this.db.getFirstSync<{ total: number }>(
        "SELECT COUNT(*) AS total FROM together_shared_events WHERE account_id = ? AND session_id = ?",
        [this.accountId, sessionId],
      )!.total;
      if (count >= 4096) throw new Error("Shared event journal full");
      this.db.runSync(
        "INSERT INTO together_shared_events(account_id,session_id,event_id,envelope) VALUES (?,?,?,?)",
        [this.accountId, sessionId, eventId, envelope],
      );
    });
  }
  deleteShared(sessionId: string, ids: readonly string[]): void {
    this.db.withTransactionSync(() => {
      for (const id of ids)
        this.db.runSync(
          "DELETE FROM together_shared_events WHERE account_id = ? AND session_id = ? AND event_id = ?",
          [this.accountId, sessionId, id],
        );
    });
  }

  purgePeerCommands(sessionId: string, ownerId: string): void {
    this.db.runSync(
      "DELETE FROM together_local_inbox WHERE account_id = ? AND session_id = ? AND owner_id = ?",
      [this.accountId, sessionId, ownerId],
    );
  }

  bindPolicy(sessionId: string, policy: unknown): void {
    const serialized = JSON.stringify(policy);
    this.db.withTransactionSync(() => {
      const row = this.db.getFirstSync<{ policy: string }>(
        `SELECT policy FROM together_local_policy WHERE account_id = ? AND session_id = ?`,
        [this.accountId, sessionId],
      );
      if (row && row.policy !== serialized)
        throw new Error("Lobby policy changed");
      this.db.runSync(
        `INSERT OR IGNORE INTO together_local_policy(account_id, session_id, policy) VALUES (?, ?, ?)`,
        [this.accountId, sessionId, serialized],
      );
    });
  }

  rosters(sessionId: string): Signed<OfflineRoster>[] {
    return this.db
      .getAllSync<{ envelope: string }>(
        `SELECT envelope FROM together_local_rosters
         WHERE account_id = ? AND session_id = ? ORDER BY revision`,
        [this.accountId, sessionId],
      )
      .map(({ envelope }) => JSON.parse(envelope) as Signed<OfflineRoster>);
  }

  current(sessionId: string): Signed<OfflineRoster> | null {
    return this.rosters(sessionId).at(-1) ?? null;
  }

  /** Accept exact retries, never rollback/fork/skip a persisted roster revision. */
  commitRoster(
    envelope: Signed<OfflineRoster>,
    pin: HostPin,
    trusted: TrustedKeys,
    denied: readonly (readonly [string, string])[],
    now: number,
  ): void {
    this.db.withTransactionSync(() => {
      this.assertOpen(pin.sessionId);
      const p = envelope.payload;
      if (
        p.sessionId !== pin.sessionId ||
        p.hostUserId !== pin.hostUserId ||
        p.hostDeviceId !== pin.hostDeviceId
      )
        throw new Error("Wrong lobby authority");
      const chain = this.rosters(pin.sessionId);
      const existing = chain.find((r) => r.payload.revision === p.revision);
      if (existing) {
        if (requestHash(existing) !== requestHash(envelope))
          throw new Error("Conflicting roster revision");
        // Revalidate expiry/block knowledge even on an immutable duplicate.
        verifyRoster(
          envelope,
          trusted,
          chain[p.revision - 2] ?? null,
          denied,
          now,
        );
        return;
      }
      verifyRoster(envelope, trusted, chain.at(-1) ?? null, denied, now);
      this.db.runSync(
        `INSERT INTO together_local_rosters
         (account_id, session_id, revision, envelope) VALUES (?, ?, ?, ?)`,
        [this.accountId, pin.sessionId, p.revision, JSON.stringify(envelope)],
      );
    });
  }

  assertOpen(sessionId: string): void {
    if (
      this.db.getFirstSync(
        `SELECT 1 FROM together_local_closed WHERE account_id = ? AND session_id = ?`,
        [this.accountId, sessionId],
      )
    )
      throw new Error("Local sharing closed");
  }

  /** Local user exit is terminal for this session; no implicit resume on restart. */
  close(sessionId: string): void {
    this.db.runSync(
      `INSERT OR IGNORE INTO together_local_closed(account_id, session_id) VALUES (?, ?)`,
      [this.accountId, sessionId],
    );
  }

  receive(ownerId: string, command: LocalCommand): void {
    this.db.withTransactionSync(() => {
      this.assertOpen(command.sessionId);
      const previous = this.db.getFirstSync<{
        executionId: string;
        payload: string;
      }>(
        `SELECT execution_id AS executionId, payload FROM together_local_inbox
         WHERE account_id = ? AND session_id = ? AND owner_id = ? AND command_id = ?`,
        [this.accountId, command.sessionId, ownerId, command.commandId],
      );
      if (previous) {
        if (
          previous.executionId !== command.executionId ||
          previous.payload !== command.payload
        )
          throw new Error("Conflicting peer command");
        return;
      }
      const count = this.db.getFirstSync<{ total: number }>(
        `SELECT COUNT(*) AS total FROM together_local_inbox
         WHERE account_id = ? AND session_id = ? AND owner_id = ?`,
        [this.accountId, command.sessionId, ownerId],
      )!.total;
      if (count >= 4096) throw new Error("Peer inbox full");
      this.db.runSync(
        `INSERT INTO together_local_inbox
         (account_id, session_id, owner_id, command_id, execution_id, payload)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          this.accountId,
          command.sessionId,
          ownerId,
          command.commandId,
          command.executionId,
          command.payload,
        ],
      );
    });
  }

  received(ownerId: string, sessionId: string): LocalCommand[] {
    return this.db.getAllSync<LocalCommand>(
      `SELECT command_id AS commandId, session_id AS sessionId,
       execution_id AS executionId, payload FROM together_local_inbox
       WHERE account_id = ? AND session_id = ? AND owner_id = ? ORDER BY rowid`,
      [this.accountId, sessionId, ownerId],
    );
  }
}
