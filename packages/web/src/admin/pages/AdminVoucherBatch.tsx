import { membershipTierLabel, isCoachMembership } from "@/lib/membershipTier";
import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { IconArrowLeft, IconDownload } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { voucherApi, type Assignment, type Voucher } from "../voucherApi";
import {
  auditCsv,
  downloadCsv,
  normaliseEmployeeEmail,
  parseAssignments,
  toCsv,
} from "../voucherCsv";
import { formatDate } from "../adminApi";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  Stat,
  StatusBadge,
  Table,
  selectClass,
} from "../ui";

type Action =
  | { kind: "assign"; voucher: Voucher }
  | { kind: "revoke"; voucher?: Voucher }
  | { kind: "import" };
export function AdminVoucherBatch() {
  const { batchId = "" } = useParams();
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ["admin", "voucher-batch", batchId],
    queryFn: () => voucherApi.detail(batchId),
  });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [action, setAction] = useState<Action | null>(null);
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<Assignment[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const batch = detail.data?.batch;
  const vouchers = detail.data?.vouchers ?? [];
  function open(next: Action) {
    setAction(next);
    setError(null);
    setNotice("");
    setEmail(next.kind === "assign" ? (next.voucher.employeeEmail ?? "") : "");
    setReason("");
    setCsv("");
    setPreview(null);
  }
  async function run(operation: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      await operation();
      setAction(null);
      setNotice(message);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["admin", "voucher-batch", batchId] }),
        qc.invalidateQueries({ queryKey: ["admin", "voucher-batches"] }),
      ]);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  function submitAssignment(e: FormEvent) {
    e.preventDefault();
    try {
      if (action?.kind !== "assign" || !batch) return;
      const normalized = normaliseEmployeeEmail(email, batch.allowedDomains);
      if (
        normalized &&
        vouchers.some(
          (v) => v.id !== action.voucher.id && v.employeeEmail === normalized,
        )
      )
        throw new Error(
          "This employee email is already assigned in the batch.",
        );
      void run(
        () => voucherApi.assign(batchId, action.voucher.id, normalized),
        "Employee assignment saved.",
      );
    } catch (err) {
      setError(err);
    }
  }
  function validateImport() {
    setError(null);
    try {
      setPreview(parseAssignments(csv, vouchers, batch?.allowedDomains ?? []));
    } catch (e) {
      setPreview(null);
      setError(e);
    }
  }
  async function exportRecords() {
    setBusy(true);
    setError(null);
    try {
      await voucherApi.exportAudit(batchId);
      downloadCsv(
        auditCsv(vouchers),
        `persistence-voucher-audit-${batchId}.csv`,
      );
      setNotice(
        "Audit CSV download requested. Full voucher codes are not included.",
      );
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const filtered = vouchers.filter(
    (v) =>
      (!status || v.status === status) &&
      [
        v.id,
        v.codeHint,
        v.employeeEmail,
        v.eligibilityEmail,
        v.accountEmail,
      ].some((value) =>
        value?.toLowerCase().includes(search.toLowerCase().trim()),
      ),
  );
  return (
    <>
      <Button asChild variant="link" className="mb-4">
        <Link to="/admin/vouchers">
          <IconArrowLeft size={16} />
          All business vouchers
        </Link>
      </Button>
      <PageHeader title={batch?.businessName ?? "Membership batch"}>
        {batch && (
          <Button
            variant="outline"
            onClick={() => void exportRecords()}
            disabled={busy}
          >
            <IconDownload size={16} />
            Export audit CSV
          </Button>
        )}
      </PageHeader>
      {detail.isPending ? <EmptyState>Loading batch…</EmptyState> : null}
      {detail.isError ? <ErrorState error={detail.error} /> : null}
      {batch ? (
        <div className="space-y-6">
          <Panel title="Batch details">
            <dl className="admin-definition-grid">
              <dt>Membership</dt>
              <dd>
                {membershipTierLabel(batch.tierName)} · {batch.months} months
                from redemption
              </dd>
              <dt>Reference</dt>
              <dd>{batch.reference ?? "Not set"}</dd>
              <dt>Eligible domains</dt>
              <dd>
                {batch.allowedDomains.length
                  ? batch.allowedDomains.join(", ")
                  : "Open — any valid email domain"}
              </dd>
              <dt>Redeem before</dt>
              <dd>
                {batch.redeemBy ? formatDate(batch.redeemBy) : "No deadline"}
              </dd>
              <dt>Created</dt>
              <dd>{formatDate(batch.createdAt)}</dd>
            </dl>
            <p className="admin-field-hint mt-4">
              Restrictions apply to the verified eligibility email. The
              membership account email may be different. Redeemed codes are
              permanently used.
            </p>
            <p className="admin-field-hint mt-3">
              Redeem any code in this batch on the{" "}
              <Link
                to="/redeem"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                employee redemption page
              </Link>
              .
              {isCoachMembership(batch.tierName)
                ? " Coach access is provisioned automatically for the verified membership account."
                : " Sign in to the membership account you want to receive access."}
            </p>
          </Panel>
          <div className="admin-stats-grid admin-stats-five">
            {(
              ["issued", "unused", "redeemed", "expired", "revoked"] as const
            ).map((s) => (
              <Stat key={s} label={s} value={batch.counts[s]} />
            ))}
          </div>
          <div className="admin-actions">
            <Button
              variant="outline"
              disabled={busy || !batch.counts.unused}
              onClick={() => open({ kind: "import" })}
            >
              Import employee assignments
            </Button>
            <Button
              variant="destructive"
              disabled={busy || !batch.counts.unused}
              onClick={() => open({ kind: "revoke" })}
            >
              Revoke unused codes
            </Button>
          </div>
          {notice ? (
            <p role="status" className="admin-notice">
              {notice}
            </p>
          ) : null}
          {error ? <ErrorState error={error} /> : null}
          {action?.kind === "assign" ? (
            <Panel title={`Assign employee · ${action.voucher.codeHint}`}>
              <form onSubmit={submitAssignment} className="space-y-4">
                <label className="admin-field">
                  Eligible employee email{" "}
                  <span className="admin-optional">Optional</span>
                  <Input
                    type="email"
                    maxLength={254}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <p className="admin-field-hint">
                  Leave empty to remove the individual restriction. Batch domain
                  restrictions still apply. This is not the destination
                  membership account.
                </p>
                <div className="admin-actions">
                  <Button type="submit" disabled={busy}>
                    {busy ? "Saving…" : "Save assignment"}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => setAction(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </Panel>
          ) : null}
          {action?.kind === "revoke" ? (
            <Panel
              title={
                action.voucher
                  ? `Revoke unused code · ${action.voucher.codeHint}`
                  : "Revoke all unused codes"
              }
            >
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (reason.trim().length < 3) {
                    setError(
                      new Error(
                        "Enter an audit reason of at least 3 characters.",
                      ),
                    );
                    return;
                  }
                  void run(
                    () =>
                      voucherApi.revoke(
                        batchId,
                        reason.trim(),
                        action.voucher?.id,
                      ),
                    "Unused code revocation completed. Existing memberships are unchanged.",
                  );
                }}
              >
                <div className="admin-notice">
                  This permanently prevents{" "}
                  {action.voucher
                    ? "this unused code"
                    : "every currently unused code in this batch"}{" "}
                  from being redeemed. It does not cancel memberships already
                  granted or make redeemed codes reusable.
                </div>
                <label className="admin-field">
                  Audit reason
                  <Input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    minLength={3}
                    maxLength={500}
                    required
                  />
                </label>
                <div className="admin-actions">
                  <Button type="submit" variant="destructive" disabled={busy}>
                    {busy ? "Revoking…" : "Confirm revocation"}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => setAction(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </Panel>
          ) : null}
          {action?.kind === "import" ? (
            <Panel title="Import employee assignments">
              <div className="space-y-4">
                <p className="admin-field-hint">
                  CSV columns: voucherId,employeeEmail. Each ID must identify an
                  unused code in this batch. Empty email cells remove an
                  assignment. All rows are validated and applied together; any
                  conflict rejects the entire import.
                </p>
                <Button
                  variant="outline"
                  onClick={() =>
                    downloadCsv(
                      toCsv([
                        ["voucherId", "employeeEmail"],
                        ...vouchers
                          .filter((v) => v.status === "unused")
                          .map((v) => [v.id, v.employeeEmail]),
                      ]),
                      `persistence-assignments-${batchId}.csv`,
                    )
                  }
                >
                  Download assignment template
                </Button>
                <label className="admin-field">
                  CSV file
                  <Input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setPreview(null);
                      setError(null);
                      if (file.size > 1024 * 1024) {
                        setError(new Error("CSV must be smaller than 1 MB."));
                        return;
                      }
                      try {
                        setCsv(await file.text());
                      } catch (err) {
                        setError(err);
                      }
                    }}
                  />
                </label>
                <label className="admin-field">
                  Or paste CSV
                  <textarea
                    rows={6}
                    value={csv}
                    onChange={(e) => {
                      setCsv(e.target.value);
                      setPreview(null);
                    }}
                    placeholder={"voucherId,employeeEmail\n"}
                  />
                </label>
                {preview ? (
                  <div className="admin-notice" role="status">
                    {preview.length} assignments validated;{" "}
                    {preview.filter((a) => !a.employeeEmail).length} will remove
                    an individual email restriction. Confirm to apply all rows.
                  </div>
                ) : null}
                <div className="admin-actions">
                  {preview ? (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => voucherApi.importAssignments(batchId, preview),
                          `${preview.length} assignments imported.`,
                        )
                      }
                    >
                      {busy ? "Importing…" : "Apply assignments"}
                    </Button>
                  ) : (
                    <Button onClick={validateImport} disabled={!csv.trim()}>
                      Validate CSV
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => setAction(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </Panel>
          ) : null}
          <Panel title="Voucher activity">
            <div className="admin-toolbar">
              <Input
                aria-label="Search vouchers"
                placeholder="Search ID, code hint or email"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                className={selectClass}
                aria-label="Voucher status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">All statuses</option>
                {["unused", "redeemed", "expired", "revoked"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
            {!filtered.length ? (
              <EmptyState>No vouchers match these filters.</EmptyState>
            ) : (
              <Table
                head={[
                  "Code / ID",
                  "Assigned eligibility email",
                  "Status",
                  "Verified eligibility email",
                  "Membership account",
                  "Redeemed",
                  "Access until",
                  "Actions",
                ]}
              >
                {filtered.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <strong>{v.codeHint}</strong>
                      <span className="admin-cell-note font-mono">{v.id}</span>
                    </td>
                    <td>{v.employeeEmail ?? "Unassigned"}</td>
                    <td>
                      <StatusBadge status={v.status} />
                    </td>
                    <td>{v.eligibilityEmail ?? "—"}</td>
                    <td>
                      {v.accountEmail ?? "—"}
                      {v.accountId ? (
                        <span className="admin-cell-note font-mono">
                          {v.accountId}
                        </span>
                      ) : null}
                    </td>
                    <td>{formatDate(v.redeemedAt)}</td>
                    <td>{formatDate(v.expiresAt)}</td>
                    <td>
                      {v.status === "unused" ? (
                        <div className="admin-actions">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => open({ kind: "assign", voucher: v })}
                            aria-label={`Assign ${v.codeHint}`}
                          >
                            Assign
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={busy}
                            onClick={() => open({ kind: "revoke", voucher: v })}
                            aria-label={`Revoke ${v.codeHint}`}
                          >
                            Revoke
                          </Button>
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Panel>
        </div>
      ) : null}
    </>
  );
}
