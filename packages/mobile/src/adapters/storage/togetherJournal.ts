/** Durable owner journal. Network adapters must authenticate receipts first. */
export interface TogetherJournalDatabase {
  execSync(sql: string): void;
  runSync(sql: string, params: (string | number | null)[]): unknown;
  getFirstSync<T>(sql: string, params: (string | number | null)[]): T | null;
  getAllSync<T>(sql: string, params: (string | number | null)[]): T[];
  withTransactionSync(action: () => void): void;
}

export interface TogetherJournalCommand {
  commandId: string;
  sessionId: string;
  executionId: string;
  /** Exact immutable serialized wire command, including version/consent fields. */
  payload: string;
}

export type TogetherServerOutcome = "accepted" | "rejected" | "review";

export interface TogetherJournalEntry extends TogetherJournalCommand {
  sequence: number;
  serverOutcome: TogetherServerOutcome | null;
  peerReceipts: string[];
}

type Row = TogetherJournalCommand & {
  sequence: number;
  serverOutcome: TogetherServerOutcome | null;
};

const identifier = (value: string) => {
  if (!value.trim() || value.length > 200)
    throw new Error("Invalid Together journal identifier");
};

/**
 * Account-bound even when several accounts have journals in the same database.
 * The caller persists the local operation BEFORE sending it to any transport.
 * Receipts never delete payloads or turn peer receipt into cloud acceptance.
 * This is storage only: it does not authenticate peers or mount Together UI.
 */
export class TogetherJournal {
  constructor(
    private readonly db: TogetherJournalDatabase,
    private readonly accountId: string,
  ) {
    identifier(accountId);
    db.execSync(`
      CREATE TABLE IF NOT EXISTS together_owner_journal (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id TEXT NOT NULL,
        command_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        execution_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        server_outcome TEXT CHECK(server_outcome IN ('accepted','rejected','review')),
        UNIQUE(account_id, command_id)
      );
      CREATE INDEX IF NOT EXISTS together_journal_execution
        ON together_owner_journal(account_id, session_id, execution_id, sequence);
      CREATE TABLE IF NOT EXISTS together_peer_receipts (
        account_id TEXT NOT NULL,
        command_id TEXT NOT NULL,
        peer_id TEXT NOT NULL,
        PRIMARY KEY(account_id, command_id, peer_id)
      );
    `);
  }

  append(command: TogetherJournalCommand): TogetherJournalEntry {
    identifier(command.commandId);
    identifier(command.sessionId);
    identifier(command.executionId);
    // Reject invalid/oversized wire messages before any durable mutation.
    if (command.payload.length > 262144)
      throw new Error("Together journal payload exceeds limit");
    const parsed: unknown = JSON.parse(command.payload);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("Together journal payload must be an object");
    this.db.withTransactionSync(() => {
      const existing = this.row(command.commandId);
      if (existing) {
        this.match(existing, command);
        return;
      }
      this.db.runSync(
        `INSERT INTO together_owner_journal
          (account_id, command_id, session_id, execution_id, payload)
         VALUES (?, ?, ?, ?, ?)`,
        [
          this.accountId,
          command.commandId,
          command.sessionId,
          command.executionId,
          command.payload,
        ],
      );
    });
    return this.entry(this.required(command.commandId));
  }

  recordPeerReceipt(command: TogetherJournalCommand, peerId: string): void {
    identifier(peerId);
    if (peerId === this.accountId)
      throw new Error("Own device receipt is not a partner receipt");
    this.db.withTransactionSync(() => {
      this.match(this.required(command.commandId), command);
      this.db.runSync(
        `INSERT OR IGNORE INTO together_peer_receipts
          (account_id, command_id, peer_id) VALUES (?, ?, ?)`,
        [this.accountId, command.commandId, peerId],
      );
    });
  }

  recordServerOutcome(
    command: TogetherJournalCommand,
    outcome: TogetherServerOutcome,
  ): void {
    if (!["accepted", "rejected", "review"].includes(outcome))
      throw new Error("Invalid Together server outcome");
    this.db.withTransactionSync(() => {
      const row = this.required(command.commandId);
      this.match(row, command);
      // A terminal receipt cannot be overwritten by delayed/out-of-order data.
      if (
        row.serverOutcome &&
        row.serverOutcome !== "review" &&
        row.serverOutcome !== outcome
      )
        throw new Error("Conflicting Together server receipt");
      this.db.runSync(
        `UPDATE together_owner_journal SET server_outcome = ?
         WHERE account_id = ? AND command_id = ?`,
        [outcome, this.accountId, command.commandId],
      );
    });
  }

  list(sessionId: string, executionId: string): TogetherJournalEntry[] {
    return this.db
      .getAllSync<Row>(
        `SELECT sequence, command_id AS commandId, session_id AS sessionId,
          execution_id AS executionId, payload, server_outcome AS serverOutcome
         FROM together_owner_journal
         WHERE account_id = ? AND session_id = ? AND execution_id = ?
         ORDER BY sequence`,
        [this.accountId, sessionId, executionId],
      )
      .map((row) => this.entry(row));
  }

  private row(commandId: string): Row | null {
    return this.db.getFirstSync<Row>(
      `SELECT sequence, command_id AS commandId, session_id AS sessionId,
        execution_id AS executionId, payload, server_outcome AS serverOutcome
       FROM together_owner_journal WHERE account_id = ? AND command_id = ?`,
      [this.accountId, commandId],
    );
  }

  private required(commandId: string): Row {
    const row = this.row(commandId);
    if (!row) throw new Error("Unknown Together journal command");
    return row;
  }

  private match(row: Row, command: TogetherJournalCommand): void {
    if (
      row.sessionId !== command.sessionId ||
      row.executionId !== command.executionId ||
      row.payload !== command.payload
    )
      throw new Error(
        "Together command identity reused with different content",
      );
  }

  private entry(row: Row): TogetherJournalEntry {
    return {
      ...row,
      peerReceipts: this.db
        .getAllSync<{ peerId: string }>(
          `SELECT peer_id AS peerId FROM together_peer_receipts
           WHERE account_id = ? AND command_id = ? ORDER BY peer_id`,
          [this.accountId, row.commandId],
        )
        .map(({ peerId }) => peerId),
    };
  }
}
