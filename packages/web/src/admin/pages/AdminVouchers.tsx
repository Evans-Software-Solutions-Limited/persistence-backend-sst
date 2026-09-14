import { GRANTABLE_TIERS } from "@persistence/subscription-catalog";
import { membershipTierLabel } from "@/lib/membershipTier";
import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { IconDownload, IconPlus, IconArrowRight } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { voucherApi, type CreateVoucherBatch } from "../voucherApi";
import {
  distributionCsv,
  downloadCsv,
  normaliseEmployeeEmail,
  parseDomains,
} from "../voucherCsv";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  Stat,
  Table,
  selectClass,
} from "../ui";
import { formatDate } from "../adminApi";
import {
  clearIssuedVouchers,
  ISSUED_VOUCHERS_CHANGED,
  loadIssuedVouchers,
  prepareIssuedStorage,
  saveIssuedVouchers,
  voucherIssuanceOwner,
  type IssuedVouchers,
} from "../issuedVouchers";

export function NewVoucherBatch({
  onCreated,
}: {
  onCreated: (issued: IssuedVouchers) => void;
}) {
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      const domains = parseDomains(String(form.get("domains")));
      const quantity = Number(form.get("quantity"));
      const months = Number(form.get("months"));
      const deadline = String(form.get("redeemBy"));
      const raw = String(form.get("emails"));
      const emails = raw.trim()
        ? raw
            .replace(/\r/g, "")
            .split("\n")
            .map((v) => normaliseEmployeeEmail(v, domains) ?? "")
        : undefined;
      if (emails && emails.length !== quantity)
        throw new Error(
          "Provide one email line per code, or leave the entire field empty. Blank lines leave individual codes unassigned.",
        );
      const nonempty = emails?.filter(Boolean) ?? [];
      if (new Set(nonempty).size !== nonempty.length)
        throw new Error(
          "Each employee email can be assigned only once in a batch.",
        );
      if (
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > 500 ||
        !Number.isInteger(months) ||
        months < 1 ||
        months > 120
      )
        throw new Error("Choose 1–500 codes and 1–120 months.");
      if (deadline && new Date(deadline).getTime() <= Date.now())
        throw new Error("Redemption deadline must be in the future.");
      const input: CreateVoucherBatch = {
        businessName: String(form.get("businessName")).trim(),
        reference: String(form.get("reference")).trim() || undefined,
        quantity,
        months,
        tierName: form.get("tierName") as CreateVoucherBatch["tierName"],
        allowedDomains: domains,
        redeemBy: deadline ? new Date(deadline).toISOString() : null,
        employeeEmails: emails,
      };
      if (!input.businessName) throw new Error("Enter the business name.");
      const owner = prepareIssuedStorage();
      setBusy(true);
      const issued = await voucherApi.create(input);
      try {
        saveIssuedVouchers(owner, issued);
        onCreated(issued);
      } catch {
        onCreated({
          ...issued,
          storageWarning:
            "The batch was created, but browser recovery storage failed. Download the CSV now and keep this page open until it is saved.",
        });
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title="Create a membership batch">
      <form onSubmit={submit} className="admin-form-grid">
        <label>
          Business name
          <Input
            name="businessName"
            required
            maxLength={200}
            placeholder="Company or organisation"
          />
        </label>
        <label>
          Order / reference <span className="admin-optional">Optional</span>
          <Input name="reference" maxLength={200} />
        </label>
        <label>
          Number of codes
          <Input
            name="quantity"
            type="number"
            min={1}
            max={500}
            defaultValue={10}
            required
          />
        </label>
        <label>
          Membership
          <select name="tierName" className={selectClass}>
            {GRANTABLE_TIERS.map((tier) => (
              <option key={tier.id} value={tier.id}>
                {tier.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Months of access
          <Input
            name="months"
            type="number"
            min={1}
            max={120}
            defaultValue={12}
            required
          />
          <span className="admin-field-hint">
            Starts when each employee redeems.
          </span>
        </label>
        <label>
          Redeem before <span className="admin-optional">Optional</span>
          <Input name="redeemBy" type="datetime-local" />
          <span className="admin-field-hint">
            Your local time. Empty means no deadline.
          </span>
        </label>
        <label className="admin-full">
          Allowed eligibility domains{" "}
          <span className="admin-optional">Optional</span>
          <Input name="domains" placeholder="company.com, company.co.uk" />
          <span className="admin-field-hint">
            Empty allows any domain. Exact domains only; subdomains must be
            listed separately.
          </span>
        </label>
        <label className="admin-full">
          Assigned employee emails{" "}
          <span className="admin-optional">Optional</span>
          <textarea
            name="emails"
            rows={4}
            placeholder="One email per code; blank lines leave codes unassigned"
          />
          <span className="admin-field-hint">
            These restrict the verified eligibility email. Employees may
            activate membership on a different account they own.
          </span>
        </label>
        <div className="admin-notice admin-full">
          Codes are random and permanently single-use. Download them immediately
          after creation: full codes cannot be retrieved later.
        </div>
        {error ? (
          <div className="admin-full">
            <ErrorState error={error} />
          </div>
        ) : null}
        <Button type="submit" disabled={busy}>
          {busy ? "Creating…" : "Generate codes"}
          <IconPlus size={16} />
        </Button>
      </form>
    </Panel>
  );
}

function IssuedBatch({
  issued,
  onClose,
}: {
  issued: IssuedVouchers;
  onClose: () => void;
}) {
  const [downloaded, setDownloaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const protectCodes = (e: MouseEvent) => {
      const anchor =
        e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (
        !anchor ||
        anchor.hasAttribute("download") ||
        anchor.getAttribute("target") === "_blank"
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      setError(
        new Error(
          "Download and save the codes, then select ‘I have saved the codes’ before leaving this page.",
        ),
      );
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", protectCodes, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", protectCodes, true);
    };
  }, []);
  async function download() {
    setBusy(true);
    setError(null);
    try {
      // Best effort retry if storage became unavailable after creation.
      try {
        saveIssuedVouchers(voucherIssuanceOwner(), issued);
      } catch {
        /* Keep the direct download available. */
      }
      await voucherApi.exportAudit(issued.batch.id);
      downloadCsv(
        distributionCsv(issued.batch, issued.codes),
        `persistence-vouchers-${issued.batch.id}.csv`,
      );
      setDownloaded(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel
      title={`${issued.codes.length} codes generated for ${issued.batch.businessName}`}
    >
      <div className="space-y-4">
        <p role="status">
          Your batch is ready. Download and securely save the distribution CSV
          now. This admin account can recover pending codes in this browser tab
          for up to 24 hours, until you confirm they are saved.
        </p>
        <div className="admin-notice">
          This file contains one-time membership codes and any assigned employee
          emails. Share each code only with its intended recipient. The CSV
          includes the redemption website.
        </div>
        {issued.storageWarning ? (
          <ErrorState error={new Error(issued.storageWarning)} />
        ) : null}
        {error ? <ErrorState error={error} /> : null}
        <div className="admin-actions">
          <Button onClick={() => void download()} disabled={busy}>
            <IconDownload size={16} />
            {busy ? "Preparing download…" : "Download codes CSV"}
          </Button>
          {downloaded ? (
            <Button
              variant="outline"
              onClick={() => {
                try {
                  clearIssuedVouchers(issued.batch.id);
                  onClose();
                } catch {
                  setError(
                    new Error(
                      "Could not clear pending codes from browser storage. Keep this page open and retry after storage is available.",
                    ),
                  );
                }
              }}
            >
              I have saved the codes
            </Button>
          ) : null}
        </div>
        {downloaded ? (
          <p className="admin-field-hint">
            Download requested. Check the file is saved before continuing; this
            acknowledgement permanently removes this tab's recovery copy.
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

export function AdminVouchers() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [issued, setIssued] = useState<IssuedVouchers | null>(
    loadIssuedVouchers,
  );
  useEffect(() => {
    const resume = () =>
      setIssued((current) => current ?? loadIssuedVouchers());
    window.addEventListener(ISSUED_VOUCHERS_CHANGED, resume);
    return () => window.removeEventListener(ISSUED_VOUCHERS_CHANGED, resume);
  }, []);
  const qc = useQueryClient();
  const batches = useQuery({
    queryKey: ["admin", "voucher-batches", q],
    queryFn: () => voucherApi.batches(q),
  });
  const filtered = batches.data?.filter(
    (b) =>
      !status ||
      b.counts[status as "unused" | "redeemed" | "expired" | "revoked"] > 0,
  );
  return (
    <>
      <PageHeader title="Business vouchers">
        {!issued && (
          <Button
            onClick={() => setCreating(!creating)}
            variant={creating ? "outline" : "default"}
          >
            {creating ? "Close form" : "Create batch"}
            <IconPlus size={16} />
          </Button>
        )}
      </PageHeader>
      <p className="admin-page-description">
        Prepaid memberships for teams. Issue once, verify the employee, and
        track every redemption.
      </p>
      <div className="admin-notice mb-6">
        Employees and coaches redeem these codes on the{" "}
        <Link
          to="/redeem"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          employee redemption page
        </Link>
        . Coach plans activate coaching capabilities on the verified membership
        account. Individual access grants use the recipient's account email
        directly and do not require a voucher code.
      </div>
      <div className="space-y-6">
        {issued ? (
          <IssuedBatch
            key={issued.batch.id}
            issued={issued}
            onClose={() => setIssued(loadIssuedVouchers())}
          />
        ) : creating ? (
          <NewVoucherBatch
            onCreated={(result) => {
              setIssued(result);
              setCreating(false);
              void qc.invalidateQueries({
                queryKey: ["admin", "voucher-batches"],
              });
            }}
          />
        ) : null}
        <div className="admin-stats-grid">
          <Stat
            label="Batches in this search"
            value={batches.data?.length ?? "—"}
          />
          <Stat
            label="Unused codes"
            value={
              batches.data?.reduce((a, b) => a + b.counts.unused, 0) ?? "—"
            }
          />
          <Stat
            label="Memberships redeemed"
            value={
              batches.data?.reduce((a, b) => a + b.counts.redeemed, 0) ?? "—"
            }
          />
        </div>
        <Panel title="Membership batches">
          <div className="admin-toolbar">
            <Input
              aria-label="Search voucher batches"
              placeholder="Search business or reference"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select
              className={selectClass}
              aria-label="Batch code status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">All batches</option>
              <option value="unused">With unused codes</option>
              <option value="redeemed">With redemptions</option>
              <option value="expired">With expired codes</option>
              <option value="revoked">With revoked codes</option>
            </select>
          </div>
          {batches.isPending ? (
            <EmptyState>Loading batches…</EmptyState>
          ) : batches.isError ? (
            <ErrorState error={batches.error} />
          ) : !filtered?.length ? (
            <EmptyState>
              No matching batches. Create a batch to offer a team access to
              Persistence.
            </EmptyState>
          ) : (
            <Table
              head={[
                "Business / reference",
                "Membership",
                "Issued",
                "Unused",
                "Redeemed",
                "Expired",
                "Revoked",
                "Redeem before",
                "Details",
              ]}
            >
              {filtered.map((b) => (
                <tr key={b.id}>
                  <td>
                    <strong>{b.businessName}</strong>
                    <span className="admin-cell-note">
                      {b.reference ?? "No reference"}
                    </span>
                  </td>
                  <td>
                    {membershipTierLabel(b.tierName)}
                    <span className="admin-cell-note">{b.months} months</span>
                  </td>
                  <td>{b.counts.issued}</td>
                  <td>{b.counts.unused}</td>
                  <td>{b.counts.redeemed}</td>
                  <td>{b.counts.expired}</td>
                  <td>{b.counts.revoked}</td>
                  <td>{b.redeemBy ? formatDate(b.redeemBy) : "No deadline"}</td>
                  <td>
                    <Button asChild variant="outline" size="sm">
                      <Link
                        to={`/admin/vouchers/${b.id}`}
                        aria-label={`View ${b.businessName}`}
                      >
                        View
                        <IconArrowRight size={14} />
                      </Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Panel>
      </div>
    </>
  );
}
