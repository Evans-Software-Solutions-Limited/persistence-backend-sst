import type { TogetherJournalDatabase } from "../../storage/togetherJournal";
import type {
  Credential,
  Signed,
  TrustedKeys,
  FriendshipEvidence,
} from "../../../domain/models/togetherIdentity";
export interface Snapshot {
  deviceId: string | null;
  blocked: boolean;
  observedAt: number;
  trustedKeys: TrustedKeys;
  credential: Signed<Credential> | null;
  friends: Record<string, Signed<FriendshipEvidence>>;
}
export class ProvisioningCache {
  constructor(private db: TogetherJournalDatabase) {
    db.execSync(
      `CREATE TABLE IF NOT EXISTS together_provisioning (scope TEXT PRIMARY KEY, snapshot TEXT NOT NULL)`,
    );
  }
  read(scope: string): Snapshot {
    const row = this.db.getFirstSync<{ snapshot: string }>(
      "SELECT snapshot FROM together_provisioning WHERE scope = ?",
      [scope],
    );
    if (!row)
      return {
        deviceId: null,
        blocked: false,
        observedAt: 0,
        trustedKeys: {},
        credential: null,
        friends: {},
      };
    const value = JSON.parse(row.snapshot) as Snapshot;
    if (
      !value ||
      typeof value.blocked !== "boolean" ||
      !Number.isSafeInteger(value.observedAt) ||
      value.observedAt < 0 ||
      !value.friends ||
      typeof value.friends !== "object" ||
      Object.keys(value.friends).length > 100
    )
      throw new Error("storage");
    return value;
  }
  write(scope: string, snapshot: Snapshot): void {
    this.db.withTransactionSync(() =>
      this.db.runSync(
        "INSERT INTO together_provisioning(scope,snapshot) VALUES(?,?) ON CONFLICT(scope) DO UPDATE SET snapshot=excluded.snapshot",
        [scope, JSON.stringify(snapshot)],
      ),
    );
  }
  block(scope: string): void {
    const value = this.read(scope);
    value.blocked = true;
    this.write(scope, value);
  }
}
