import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adminApi, formatDate, type ReferralCodeRow } from "../adminApi";
import { shareLink, suggestCode } from "../codeHelpers";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  StatusBadge,
  Table,
  selectClass,
} from "../ui";

const KINDS: ReferralCodeRow["kind"][] = [
  "vendor",
  "campaign",
  "founding",
  "internal",
];

function CreateCodeForm({ onCreated }: { onCreated: () => void }) {
  const [label, setLabel] = useState("");
  const [code, setCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [partnerName, setPartnerName] = useState("");
  const [kind, setKind] = useState<ReferralCodeRow["kind"]>("vendor");
  const [max, setMax] = useState("");
  const [campaignSlug, setCampaignSlug] = useState("");
  const create = useMutation({
    mutationFn: adminApi.createCode,
    onSuccess: () => {
      setLabel("");
      setCode("");
      setCodeTouched(false);
      setPartnerName("");
      setMax("");
      setCampaignSlug("");
      onCreated();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate({
      code: code || suggestCode(label),
      label: label.trim(),
      partnerName: partnerName.trim() || null,
      kind,
      maxRedemptions: max.trim() === "" ? null : Number.parseInt(max, 10),
      campaignSlug: campaignSlug.trim() || null,
    });
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-3 sm:grid-cols-3"
      aria-label="New referral code"
    >
      <div className="space-y-1.5">
        <Label htmlFor="code-label">Label</Label>
        <Input
          id="code-label"
          required
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
            if (!codeTouched) setCode(suggestCode(e.target.value));
          }}
          placeholder="UoN freshers fair"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="code-code">Code</Label>
        <Input
          id="code-code"
          required
          value={code}
          onChange={(e) => {
            setCodeTouched(true);
            setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
          }}
          minLength={4}
          maxLength={24}
          autoCapitalize="characters"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="code-partner">Partner / vendor</Label>
        <Input
          id="code-partner"
          value={partnerName}
          onChange={(e) => setPartnerName(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="code-kind">Kind</Label>
        <select
          id="code-kind"
          className={selectClass}
          value={kind}
          onChange={(e) => setKind(e.target.value as ReferralCodeRow["kind"])}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="code-max">Max uses (blank = unlimited)</Label>
        <Input
          id="code-max"
          type="number"
          min="0"
          inputMode="numeric"
          value={max}
          onChange={(e) => setMax(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="code-slug">Campaign slug (optional)</Label>
        <Input
          id="code-slug"
          value={campaignSlug}
          onChange={(e) => setCampaignSlug(e.target.value)}
          placeholder="uon"
        />
      </div>
      {create.isError ? (
        <div className="sm:col-span-3">
          <ErrorState error={create.error} />
        </div>
      ) : null}
      <div className="sm:col-span-3">
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? "Creating…" : "Create code"}
        </Button>
      </div>
    </form>
  );
}

function Redemptions({ code }: { code: ReferralCodeRow }) {
  const q = useQuery({
    queryKey: ["admin", "redemptions", code.id],
    queryFn: () => adminApi.redemptions(code.id),
  });
  if (q.isError) return <ErrorState error={q.error} />;
  if (!q.data) return <EmptyState>Loading…</EmptyState>;
  if (q.data.length === 0)
    return <EmptyState>No one has used this code yet.</EmptyState>;
  return (
    <Table head={["Email", "Source", "Claimed", "Converted"]}>
      {q.data.map((r) => (
        <tr key={r.userId}>
          <td>{r.email ?? r.userId}</td>
          <td>{r.source}</td>
          <td>{formatDate(r.createdAt)}</td>
          <td>{r.lockedAt ? formatDate(r.lockedAt) : "—"}</td>
        </tr>
      ))}
    </Table>
  );
}

export function AdminCodes() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const codes = useQuery({
    queryKey: ["admin", "codes", q, status],
    queryFn: () => adminApi.codes(q, status),
  });
  const update = useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: Parameters<typeof adminApi.updateCode>[1];
    }) => adminApi.updateCode(id, patch),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["admin", "codes"] }),
  });

  async function copy(code: ReferralCodeRow) {
    try {
      await navigator.clipboard.writeText(shareLink(code));
      setCopied(code.id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      window.prompt("Copy this link", shareLink(code));
    }
  }

  return (
    <>
      <PageHeader title="Referral codes" />
      <div className="space-y-6">
        <Panel title="New code">
          <CreateCodeForm
            onCreated={() =>
              void qc.invalidateQueries({ queryKey: ["admin", "codes"] })
            }
          />
        </Panel>
        <Panel>
          <div className="mb-3 flex flex-wrap gap-2">
            <Input
              placeholder="Search code, label, partner"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="max-w-xs"
              aria-label="Search codes"
            />
            <select
              className={`${selectClass} max-w-40`}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          {codes.isError ? <ErrorState error={codes.error} /> : null}
          {update.isError ? <ErrorState error={update.error} /> : null}
          {codes.data && codes.data.length === 0 ? (
            <EmptyState>
              No codes yet — create one above for each stand, partner or
              campaign.
            </EmptyState>
          ) : null}
          {codes.data && codes.data.length > 0 ? (
            <Table
              head={[
                "Code",
                "Label",
                "Partner",
                "Kind",
                "Claims",
                "Grants",
                "Converted",
                "Status",
                "",
              ]}
            >
              {codes.data.map((c) => (
                <>
                  <tr key={c.id}>
                    <td className="font-mono">{c.displayCode}</td>
                    <td>{c.label}</td>
                    <td>{c.partnerName ?? "—"}</td>
                    <td>{c.kind}</td>
                    <td className="tabular-nums">
                      {c.redemptionCount}
                      {c.maxRedemptions !== null
                        ? ` / ${c.maxRedemptions}`
                        : ""}
                    </td>
                    <td className="tabular-nums">{c.grantCount}</td>
                    <td className="tabular-nums">{c.paidCount}</td>
                    <td>
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="whitespace-nowrap">
                      <div className="flex gap-1">
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => copy(c)}
                        >
                          {copied === c.id ? "Copied" : "Copy link"}
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => setOpen(open === c.id ? null : c.id)}
                        >
                          {open === c.id ? "Hide uses" : "Uses"}
                        </Button>
                        {c.status === "active" ? (
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() =>
                              update.mutate({
                                id: c.id,
                                patch: { status: "paused" },
                              })
                            }
                          >
                            Pause
                          </Button>
                        ) : c.status === "paused" ? (
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() =>
                              update.mutate({
                                id: c.id,
                                patch: { status: "active" },
                              })
                            }
                          >
                            Resume
                          </Button>
                        ) : null}
                        {c.status !== "archived" ? (
                          <Button
                            size="xs"
                            variant="destructive"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Archive ${c.displayCode}? It can't be claimed again.`,
                                )
                              ) {
                                update.mutate({
                                  id: c.id,
                                  patch: { status: "archived" },
                                });
                              }
                            }}
                          >
                            Archive
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  {open === c.id ? (
                    <tr key={`${c.id}-uses`}>
                      <td colSpan={9} className="bg-muted/30">
                        <Redemptions code={c} />
                      </td>
                    </tr>
                  ) : null}
                </>
              ))}
            </Table>
          ) : null}
        </Panel>
      </div>
    </>
  );
}
