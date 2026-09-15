import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IssuedBatch } from "./IssuedBatch";
import { ErrorState, Panel } from "./ui";
import { voucherApi, type VoucherBatch } from "./voucherApi";
import { normaliseEmployeeEmail } from "./voucherCsv";
import {
  ISSUED_VOUCHERS_CHANGED,
  loadIssuedVouchers,
  prepareIssuedStorage,
  saveIssuedVouchers,
  type IssuedVouchers,
} from "./issuedVouchers";

export function BatchIssuance({
  batch,
  onIssued,
}: {
  batch: VoucherBatch;
  onIssued: (batch: VoucherBatch) => void;
}) {
  const [issued, setIssued] = useState<IssuedVouchers | null>(() =>
    loadIssuedVouchers(batch.id),
  );
  const [quantity, setQuantity] = useState("10");
  const [emails, setEmails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [openedAt] = useState(() => Date.now());
  const expired =
    !!batch.redeemBy && new Date(batch.redeemBy).getTime() <= openedAt;
  useEffect(() => {
    const resume = () =>
      setIssued((current) => current ?? loadIssuedVouchers(batch.id));
    window.addEventListener(ISSUED_VOUCHERS_CHANGED, resume);
    return () => window.removeEventListener(ISSUED_VOUCHERS_CHANGED, resume);
  }, [batch.id]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (busy || issued) return;
    try {
      const count = Number(quantity);
      if (!Number.isInteger(count) || count < 1 || count > 500)
        throw new Error("Choose between 1 and 500 new codes.");
      const assignments = emails.trim()
        ? emails
            .replace(/\r/g, "")
            .split("\n")
            .map(
              (email) =>
                normaliseEmployeeEmail(email, batch.allowedDomains) ?? "",
            )
        : undefined;
      if (assignments && assignments.length !== count)
        throw new Error(
          "Provide one email line per new code, or leave the entire field empty.",
        );
      const assigned = assignments?.filter(Boolean) ?? [];
      if (new Set(assigned).size !== assigned.length)
        throw new Error(
          "Each employee email can be assigned only once in a batch.",
        );
      const owner = prepareIssuedStorage();
      setBusy(true);
      const result = await voucherApi.issue(batch.id, {
        quantity: count,
        employeeEmails: assignments,
      });
      try {
        saveIssuedVouchers(owner, result);
        setIssued(result);
      } catch {
        setIssued({
          ...result,
          storageWarning:
            "New codes were generated, but browser recovery storage failed. Download the CSV now and keep this page open until it is saved.",
        });
      }
      setEmails("");
      onIssued(result.batch);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (issued)
    return (
      <IssuedBatch
        key={issued.codes[0].id}
        issued={issued}
        onClose={() => setIssued(loadIssuedVouchers(batch.id))}
      />
    );

  return (
    <Panel title="Generate more codes">
      <p className="admin-field-hint mb-4">
        Add a fresh set to this batch with the same membership, duration,
        domains and redemption deadline. Previously exported codes stay hidden;
        the totals above include every set. Each employee can still redeem only
        once in this batch.
      </p>
      {expired ? (
        <p className="admin-notice">
          This batch's redemption deadline has passed. Create a new batch to
          issue more codes.
        </p>
      ) : (
        <form onSubmit={submit} className="admin-form-grid">
          <label>
            Number of new codes
            <Input
              type="number"
              min={1}
              max={500}
              required
              value={quantity}
              disabled={busy}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
          <label className="admin-full">
            Assigned employee emails{" "}
            <span className="admin-optional">Optional</span>
            <textarea
              rows={3}
              value={emails}
              disabled={busy}
              onChange={(e) => setEmails(e.target.value)}
              placeholder="One email per new code"
            />
            <span className="admin-field-hint">
              Leave empty for unassigned codes. Existing batch restrictions
              still apply.
            </span>
          </label>
          {error ? (
            <div className="admin-full">
              <ErrorState error={error} />
            </div>
          ) : null}
          <div className="admin-full admin-actions">
            <Button type="submit" disabled={busy}>
              {busy ? "Generating…" : "Generate new codes"}
            </Button>
          </div>
        </form>
      )}
    </Panel>
  );
}
