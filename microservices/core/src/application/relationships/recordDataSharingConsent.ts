import { dataSharingConsents } from "@persistence/db";
import type { DbTransaction } from "./auditTrainerAction";
import type { ConsentSource } from "./consent";

export interface RecordDataSharingConsentArgs {
  trainerId: string;
  clientId: string;
  action: "grant" | "withdraw";
  consentVersion: string;
  source: ConsentSource;
  /**
   * MUST be the same transaction handle as the `pt_client_relationships`
   * stamp write (consent_given_at/consent_version set on grant, cleared to
   * NULL on withdraw) — the append-only log and the current-state stamp must
   * land together or not at all.
   */
  tx: DbTransaction;
}

/**
 * Write one `data_sharing_consents` row inside the caller's transaction —
 * the append-only accountability log for UK GDPR Art 9(2)(a) explicit
 * consent (spec 26). Mirrors `auditTrainerAction`'s "write in the same tx as
 * the target row" convention: call this AFTER the `pt_client_relationships`
 * stamp write, before the transaction commits.
 */
export async function recordDataSharingConsent(
  args: RecordDataSharingConsentArgs,
): Promise<void> {
  await args.tx.insert(dataSharingConsents).values({
    trainerId: args.trainerId,
    clientId: args.clientId,
    action: args.action,
    consentVersion: args.consentVersion,
    source: args.source,
  });
}
