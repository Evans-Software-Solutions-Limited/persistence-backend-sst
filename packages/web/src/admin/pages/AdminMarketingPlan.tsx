import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  adminApi,
  formatDay,
  formatMinor,
  type ChannelAttribution,
  type MarketingPlanDetail,
  type PlanMetric,
  type PlanStatus,
  type PlanStoreOffer,
} from "../adminApi";
import { Markdown } from "../markdown";
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

const NEXT_STATUS: Record<PlanStatus, PlanStatus[]> = {
  draft: ["active"],
  active: ["paused", "complete"],
  paused: ["active", "complete"],
  complete: [],
};

const STATUS_VERB: Record<PlanStatus, string> = {
  draft: "Move to draft",
  active: "Activate",
  paused: "Pause",
  complete: "Mark complete",
};

/** Whole-plan metric rows carry no slug; the forms use this sentinel. */
const WHOLE_PLAN = "__plan__";

function sumFor(metrics: PlanMetric[], slug: string | null) {
  const rows = metrics.filter((m) => m.campaignSlug === slug);
  const total = (pick: (m: PlanMetric) => number | null) =>
    rows.reduce((n, m) => n + (pick(m) ?? 0), 0);
  return {
    spendMinor: total((m) => m.spendMinor),
    impressions: total((m) => m.impressions),
    clicks: total((m) => m.clicks),
    landingViews: total((m) => m.landingViews),
    storeRedemptions: total((m) => m.storeRedemptions),
  };
}

function ChannelsPanel({
  detail,
  slugs,
  onChanged,
}: {
  detail: MarketingPlanDetail;
  slugs: string[];
  onChanged: () => void;
}) {
  const [slug, setSlug] = useState("");
  const [label, setLabel] = useState("");
  const [placement, setPlacement] = useState("");
  const add = useMutation({
    mutationFn: (input: {
      campaignSlug: string;
      label: string;
      placement?: string | null;
    }) => adminApi.addPlanChannel(detail.plan.id, input),
    onSuccess: () => {
      setSlug("");
      setLabel("");
      setPlacement("");
      onChanged();
    },
  });
  const remove = useMutation({
    mutationFn: (channelId: string) =>
      adminApi.removePlanChannel(detail.plan.id, channelId),
    onSuccess: onChanged,
  });

  return (
    <Panel title="Channels">
      {detail.channels.length === 0 ? (
        <EmptyState>
          No channels yet — add one per campaign slug this plan runs on.
        </EmptyState>
      ) : (
        <Table head={["Slug", "Label", "Placement", ""]}>
          {detail.channels.map((channel) => (
            <tr key={channel.id}>
              <td className="font-mono">{channel.campaignSlug}</td>
              <td>{channel.label}</td>
              <td>{channel.placement ?? "—"}</td>
              <td>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => remove.mutate(channel.id)}
                >
                  Remove
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      )}
      {add.isError ? <ErrorState error={add.error} /> : null}
      {remove.isError ? <ErrorState error={remove.error} /> : null}
      <form
        aria-label="Add channel"
        className="mt-4 grid gap-3 sm:grid-cols-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          add.mutate({
            campaignSlug: slug,
            label: label.trim(),
            placement: placement.trim() || null,
          });
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="channel-slug">Campaign slug</Label>
          <select
            id="channel-slug"
            required
            className={selectClass}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          >
            <option value="">Choose…</option>
            {slugs.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="channel-label">Label</Label>
          <Input
            id="channel-label"
            required
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Meta ads"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="channel-placement">Placement</Label>
          <Input
            id="channel-placement"
            value={placement}
            onChange={(e) => setPlacement(e.target.value)}
            placeholder="Reels"
          />
        </div>
        <div className="flex items-end">
          <Button type="submit" disabled={add.isPending}>
            Add channel
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function CodesPanel({
  detail,
  slugs,
  onChanged,
}: {
  detail: MarketingPlanDetail;
  slugs: string[];
  onChanged: () => void;
}) {
  const [codeId, setCodeId] = useState("");
  const [slug, setSlug] = useState("");
  const codes = useQuery({
    queryKey: ["admin", "codes", "", ""],
    queryFn: () => adminApi.codes(),
  });
  const link = useMutation({
    mutationFn: () =>
      adminApi.linkPlanCode(detail.plan.id, {
        referralCodeId: codeId,
        campaignSlug: slug || null,
      }),
    onSuccess: () => {
      setCodeId("");
      setSlug("");
      onChanged();
    },
  });
  const unlink = useMutation({
    mutationFn: (linkId: string) =>
      adminApi.unlinkPlanCode(detail.plan.id, linkId),
    onSuccess: onChanged,
  });
  const linkedIds = new Set(detail.codes.map((c) => c.codeId));

  return (
    <Panel title="Referral codes">
      <p className="mb-3 text-xs text-muted-foreground">
        Codes are created on the Referral codes page. This links an existing one
        to the plan so its claims and grants show below.
      </p>
      {detail.codes.length === 0 ? (
        <EmptyState>No codes linked to this plan yet.</EmptyState>
      ) : (
        <Table head={["Code", "Label", "Partner", "Channel", ""]}>
          {detail.codes.map((code) => (
            <tr key={code.linkId}>
              <td className="font-mono">{code.displayCode}</td>
              <td>{code.label}</td>
              <td>{code.partnerName ?? "—"}</td>
              <td className="font-mono text-xs">{code.campaignSlug ?? "—"}</td>
              <td>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => unlink.mutate(code.linkId)}
                >
                  Unlink
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      )}
      {link.isError ? <ErrorState error={link.error} /> : null}
      {unlink.isError ? <ErrorState error={unlink.error} /> : null}
      <form
        aria-label="Link referral code"
        className="mt-4 grid gap-3 sm:grid-cols-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          link.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="link-code">Code</Label>
          <select
            id="link-code"
            required
            className={selectClass}
            value={codeId}
            onChange={(e) => setCodeId(e.target.value)}
          >
            <option value="">Choose…</option>
            {(codes.data ?? [])
              .filter((c) => !linkedIds.has(c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayCode} — {c.label}
                </option>
              ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="link-slug">Pin to channel (optional)</Label>
          <select
            id="link-slug"
            className={selectClass}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          >
            <option value="">No channel</option>
            {slugs.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <Button type="submit" disabled={link.isPending || !codeId}>
            Link code
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function redemptionsFor(
  metrics: PlanMetric[],
  offer: PlanStoreOffer,
): number | null {
  // Redemptions are entered against the offer's channel, so an offer with no
  // channel pinned has nothing to attribute to it. Show "—", not a false zero.
  if (!offer.campaignSlug) return null;
  return metrics
    .filter((m) => m.campaignSlug === offer.campaignSlug)
    .reduce((n, m) => n + (m.storeRedemptions ?? 0), 0);
}

function StoreOffersPanel({
  detail,
  slugs,
  onChanged,
}: {
  detail: MarketingPlanDetail;
  slugs: string[];
  onChanged: () => void;
}) {
  const [platform, setPlatform] = useState<"ios" | "android">("ios");
  const [code, setCode] = useState("");
  const [tierName, setTierName] = useState("premium");
  const [durationMonths, setDurationMonths] = useState(6);
  const [price, setPrice] = useState("");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [slug, setSlug] = useState("");
  const [redemptionUrl, setRedemptionUrl] = useState("");

  const add = useMutation({
    mutationFn: () =>
      adminApi.addPlanStoreOffer(detail.plan.id, {
        platform,
        code,
        tierName,
        durationMonths,
        priceMinor: Math.round(Number.parseFloat(price || "0") * 100),
        maxRedemptions:
          maxRedemptions.trim() === ""
            ? null
            : Number.parseInt(maxRedemptions, 10),
        expiresOn: expiresOn || null,
        campaignSlug: slug || null,
        redemptionUrl: redemptionUrl.trim() || null,
        notes: null,
      }),
    onSuccess: () => {
      setCode("");
      setPrice("");
      setMaxRedemptions("");
      setExpiresOn("");
      setRedemptionUrl("");
      onChanged();
    },
  });
  const remove = useMutation({
    mutationFn: (offerId: string) =>
      adminApi.removePlanStoreOffer(detail.plan.id, offerId),
    onSuccess: onChanged,
  });

  return (
    <Panel title="Store offers">
      <p className="mb-3 text-xs text-muted-foreground">
        Configured in App Store Connect / Play Console; this is a record, not a
        control. Editing a row here does not change what the store charges, caps
        or expires.
      </p>
      {detail.storeOffers.length === 0 ? (
        <EmptyState>No store offers recorded for this plan.</EmptyState>
      ) : (
        <Table
          head={[
            "Platform",
            "Code",
            "Tier",
            "Duration",
            "Price",
            "Redemptions",
            "Expires",
            "Channel",
            "",
          ]}
        >
          {detail.storeOffers.map((offer) => {
            const used = redemptionsFor(detail.metrics, offer);
            return (
              <tr key={offer.id}>
                <td>{offer.platform === "ios" ? "App Store" : "Play"}</td>
                <td className="font-mono">{offer.code}</td>
                <td>{offer.tierName}</td>
                <td className="tabular-nums">{offer.durationMonths} mo</td>
                <td className="tabular-nums">
                  {formatMinor(offer.priceMinor, offer.currency)}
                </td>
                <td className="tabular-nums">
                  {used === null ? "—" : used}
                  {offer.maxRedemptions !== null
                    ? ` / ${offer.maxRedemptions}`
                    : ""}
                </td>
                <td>{formatDay(offer.expiresOn)}</td>
                <td className="font-mono text-xs">
                  {offer.campaignSlug ?? "—"}
                </td>
                <td>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => remove.mutate(offer.id)}
                  >
                    Remove
                  </Button>
                </td>
              </tr>
            );
          })}
        </Table>
      )}
      {add.isError ? <ErrorState error={add.error} /> : null}
      {remove.isError ? <ErrorState error={remove.error} /> : null}
      <form
        aria-label="Record store offer"
        className="mt-4 grid gap-3 sm:grid-cols-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="offer-platform">Platform</Label>
          <select
            id="offer-platform"
            className={selectClass}
            value={platform}
            onChange={(e) => setPlatform(e.target.value as "ios" | "android")}
          >
            <option value="ios">App Store</option>
            <option value="android">Play</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="offer-code">Offer code</Label>
          <Input
            id="offer-code"
            required
            value={code}
            onChange={(e) =>
              setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="offer-tier">Tier</Label>
          <select
            id="offer-tier"
            className={selectClass}
            value={tierName}
            onChange={(e) => setTierName(e.target.value)}
          >
            <option value="premium">premium</option>
            <option value="premium_plus">premium_plus</option>
            <option value="start_up_coach_plus">start_up_coach_plus</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="offer-duration">Duration (months)</Label>
          <select
            id="offer-duration"
            className={selectClass}
            value={durationMonths}
            onChange={(e) => setDurationMonths(Number(e.target.value))}
          >
            {[1, 2, 3, 6, 12].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="offer-price">Price charged (£)</Label>
          <Input
            id="offer-price"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            required
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="offer-max">Max redemptions</Label>
          <Input
            id="offer-max"
            type="number"
            min="0"
            inputMode="numeric"
            value={maxRedemptions}
            onChange={(e) => setMaxRedemptions(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="offer-expires">Expires</Label>
          <Input
            id="offer-expires"
            type="date"
            value={expiresOn}
            onChange={(e) => setExpiresOn(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="offer-slug">Offer channel</Label>
          <select
            id="offer-slug"
            className={selectClass}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          >
            <option value="">No channel</option>
            {slugs.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5 sm:col-span-3">
          <Label htmlFor="offer-url">Redemption URL</Label>
          <Input
            id="offer-url"
            value={redemptionUrl}
            onChange={(e) => setRedemptionUrl(e.target.value)}
            placeholder="https://apps.apple.com/redeem?ctx=offercodes&id=…&code=…"
          />
        </div>
        <div className="flex items-end">
          <Button type="submit" disabled={add.isPending}>
            Record offer
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function AttributionPanel({ detail }: { detail: MarketingPlanDetail }) {
  // Every money figure on this panel is in the PLAN's currency, the same one
  // the budget cap is shown in. Defaulting some of them to GBP would put a
  // cap and the spend against it in two different currencies.
  const money = (minor: number) => formatMinor(minor, detail.plan.currency);
  const byCode = new Map(detail.attribution.codes.map((c) => [c.codeId, c]));
  const perChannel = (channel: ChannelAttribution) => {
    const hand = sumFor(detail.metrics, channel.campaignSlug);
    const costPerClick =
      hand.spendMinor > 0 && channel.storeClicks > 0
        ? money(Math.round(hand.spendMinor / channel.storeClicks))
        : "—";
    return { hand, costPerClick };
  };
  const planTotals = detail.attribution.channels.reduce(
    (acc, c) => ({
      storeClicks: acc.storeClicks + c.storeClicks,
      withCode: acc.withCode + c.storeClicksWithCode,
    }),
    { storeClicks: 0, withCode: 0 },
  );
  const contributionMinor = detail.attribution.codes.reduce(
    (n, c) => n + c.contributionMinor,
    0,
  );

  return (
    <Panel title="Attribution">
      <p className="mb-3 text-xs text-muted-foreground">
        {formatDay(detail.attribution.window.from)} to{" "}
        {formatDay(detail.attribution.window.to)}. Store clicks and referral
        claims are first-party; spend, impressions, clicks, landing views and
        store redemptions are the numbers entered below.
      </p>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Store clicks" value={planTotals.storeClicks} />
        <Stat label="Clicks with a linked code" value={planTotals.withCode} />
        <Stat
          label="Contributions"
          value={money(contributionMinor)}
          hint="Optional, separate from access. Not revenue."
        />
        <Stat
          label="Registrations"
          value={detail.attribution.registrationsAllSources}
          hint="All sources — sign-up carries no channel."
        />
      </div>

      <h3 className="mb-2 text-sm font-medium text-muted-foreground">
        Per channel
      </h3>
      {detail.attribution.channels.length === 0 ? (
        <EmptyState>Add a channel to see its attribution.</EmptyState>
      ) : (
        <Table
          head={[
            "Channel",
            "Store clicks",
            "iOS",
            "Android",
            "With code",
            "Spend",
            "Impressions",
            "Clicks",
            "Landing views",
            "Redemptions",
            "Cost / store click",
          ]}
        >
          {detail.attribution.channels.map((channel) => {
            const { hand, costPerClick } = perChannel(channel);
            return (
              <tr key={channel.campaignSlug}>
                <td className="font-mono">{channel.campaignSlug}</td>
                <td className="tabular-nums">{channel.storeClicks}</td>
                <td className="tabular-nums">{channel.storeClicksIos}</td>
                <td className="tabular-nums">{channel.storeClicksAndroid}</td>
                <td className="tabular-nums">{channel.storeClicksWithCode}</td>
                <td className="tabular-nums">{money(hand.spendMinor)}</td>
                <td className="tabular-nums">{hand.impressions}</td>
                <td className="tabular-nums">{hand.clicks}</td>
                <td className="tabular-nums">{hand.landingViews}</td>
                <td className="tabular-nums">{hand.storeRedemptions}</td>
                <td className="tabular-nums">{costPerClick}</td>
              </tr>
            );
          })}
        </Table>
      )}

      <h3 className="mb-2 mt-5 text-sm font-medium text-muted-foreground">
        Per referral code
      </h3>
      {detail.codes.length === 0 ? (
        <EmptyState>Link a code to see its claims and grants.</EmptyState>
      ) : (
        <Table
          head={[
            "Code",
            "Claims",
            "Locked",
            "Founding grants",
            "Complimentary",
            "Pending",
            "Applied",
            "Contributions",
          ]}
        >
          {detail.codes.map((code) => {
            const a = byCode.get(code.codeId);
            return (
              <tr key={code.linkId}>
                <td className="font-mono">{code.displayCode}</td>
                <td className="tabular-nums">{a?.referralClaims ?? 0}</td>
                <td className="tabular-nums">{a?.referralClaimsLocked ?? 0}</td>
                <td className="tabular-nums">{a?.grantsFounding ?? 0}</td>
                <td className="tabular-nums">{a?.grantsComplimentary ?? 0}</td>
                <td className="tabular-nums">{a?.grantsPending ?? 0}</td>
                <td className="tabular-nums">{a?.grantsApplied ?? 0}</td>
                <td className="tabular-nums">
                  {money(a?.contributionMinor ?? 0)}
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </Panel>
  );
}

function MetricsPanel({
  detail,
  onChanged,
}: {
  detail: MarketingPlanDetail;
  onChanged: () => void;
}) {
  const [scope, setScope] = useState(WHOLE_PLAN);
  const [metricDate, setMetricDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [spend, setSpend] = useState("");
  const [impressions, setImpressions] = useState("");
  const [clicks, setClicks] = useState("");
  const [landingViews, setLandingViews] = useState("");
  const [storeRedemptions, setStoreRedemptions] = useState("");
  const [notes, setNotes] = useState("");

  const int = (v: string) => (v.trim() === "" ? null : Number.parseInt(v, 10));

  const save = useMutation({
    mutationFn: () =>
      adminApi.upsertPlanMetric(detail.plan.id, {
        campaignSlug: scope === WHOLE_PLAN ? null : scope,
        metricDate,
        spendMinor:
          spend.trim() === ""
            ? null
            : Math.round(Number.parseFloat(spend) * 100),
        impressions: int(impressions),
        clicks: int(clicks),
        landingViews: int(landingViews),
        storeRedemptions: int(storeRedemptions),
        notes: notes.trim() || null,
      }),
    onSuccess: onChanged,
  });

  return (
    <Panel title="Weekly numbers">
      <p className="mb-3 text-xs text-muted-foreground">
        Meta spend and store redemptions live outside our systems — enter them
        here. Saving the same channel and date again replaces that row, so a
        correction overwrites rather than double-counts.
      </p>
      {detail.metrics.length === 0 ? (
        <EmptyState>Nothing recorded yet.</EmptyState>
      ) : (
        <Table
          head={[
            "Date",
            "Channel",
            "Spend",
            "Impressions",
            "Clicks",
            "Landing views",
            "Redemptions",
            "Notes",
          ]}
        >
          {detail.metrics.map((m) => (
            <tr key={m.id}>
              <td className="whitespace-nowrap">{formatDay(m.metricDate)}</td>
              <td className="font-mono text-xs">
                {m.campaignSlug ?? "whole plan"}
              </td>
              <td className="tabular-nums">
                {m.spendMinor === null ? "—" : formatMinor(m.spendMinor)}
              </td>
              <td className="tabular-nums">{m.impressions ?? "—"}</td>
              <td className="tabular-nums">{m.clicks ?? "—"}</td>
              <td className="tabular-nums">{m.landingViews ?? "—"}</td>
              <td className="tabular-nums">{m.storeRedemptions ?? "—"}</td>
              <td>{m.notes ?? "—"}</td>
            </tr>
          ))}
        </Table>
      )}
      {save.isError ? <ErrorState error={save.error} /> : null}
      <form
        aria-label="Record weekly numbers"
        className="mt-4 grid gap-3 sm:grid-cols-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="metric-scope">Channel</Label>
          <select
            id="metric-scope"
            className={selectClass}
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value={WHOLE_PLAN}>Whole plan</option>
            {detail.channels.map((c) => (
              <option key={c.id} value={c.campaignSlug}>
                {c.campaignSlug}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="metric-date">Date</Label>
          <Input
            id="metric-date"
            type="date"
            required
            value={metricDate}
            onChange={(e) => setMetricDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="metric-spend">Spend (£)</Label>
          <Input
            id="metric-spend"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={spend}
            onChange={(e) => setSpend(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="metric-impressions">Impressions</Label>
          <Input
            id="metric-impressions"
            type="number"
            min="0"
            inputMode="numeric"
            value={impressions}
            onChange={(e) => setImpressions(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="metric-clicks">Clicks</Label>
          <Input
            id="metric-clicks"
            type="number"
            min="0"
            inputMode="numeric"
            value={clicks}
            onChange={(e) => setClicks(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="metric-landing">Landing views</Label>
          <Input
            id="metric-landing"
            type="number"
            min="0"
            inputMode="numeric"
            value={landingViews}
            onChange={(e) => setLandingViews(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="metric-redemptions">Store redemptions</Label>
          <Input
            id="metric-redemptions"
            type="number"
            min="0"
            inputMode="numeric"
            value={storeRedemptions}
            onChange={(e) => setStoreRedemptions(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="metric-notes">Notes</Label>
          <Input
            id="metric-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <div className="flex items-end">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save numbers"}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

export function AdminMarketingPlan() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ["admin", "marketing", "plan", id],
    queryFn: () => adminApi.marketingPlan(id),
  });
  const slugs = useQuery({
    queryKey: ["admin", "marketing", "slugs"],
    queryFn: adminApi.campaignSlugs,
  });
  const setStatus = useMutation({
    mutationFn: (status: PlanStatus) =>
      adminApi.updateMarketingPlan(id, { status }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["admin", "marketing"] }),
  });
  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: ["admin", "marketing"] });

  if (detail.isError) return <ErrorState error={detail.error} />;
  if (!detail.data) return <EmptyState>Loading…</EmptyState>;

  const plan = detail.data.plan;
  const slugList = slugs.data ?? [];

  return (
    <>
      <PageHeader title={plan.name}>
        <StatusBadge status={plan.status} />
        {NEXT_STATUS[plan.status].map((next) => (
          <Button
            key={next}
            size="sm"
            variant="outline"
            disabled={setStatus.isPending}
            onClick={() => setStatus.mutate(next)}
          >
            {STATUS_VERB[next]}
          </Button>
        ))}
        <Button asChild size="sm" variant="ghost">
          <Link to="/admin/marketing">Back</Link>
        </Button>
      </PageHeader>

      {setStatus.isError ? <ErrorState error={setStatus.error} /> : null}

      <div className="space-y-6">
        <Panel>
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted-foreground">Slug</dt>
            <dd className="font-mono">{plan.slug}</dd>
            <dt className="text-muted-foreground">Dates</dt>
            <dd>
              {formatDay(plan.startsOn)} → {formatDay(plan.endsOn)}
            </dd>
            <dt className="text-muted-foreground">Budget cap</dt>
            <dd>
              {plan.budgetCapMinor === null
                ? "—"
                : formatMinor(plan.budgetCapMinor, plan.currency)}
            </dd>
            <dt className="text-muted-foreground">Objective</dt>
            <dd>{plan.objective ?? "—"}</dd>
            <dt className="text-muted-foreground">Hypothesis</dt>
            <dd>{plan.hypothesis ?? "—"}</dd>
            <dt className="text-muted-foreground">Decision rule</dt>
            <dd>{plan.decisionRule ?? "—"}</dd>
          </dl>
        </Panel>

        <AttributionPanel detail={detail.data} />
        <ChannelsPanel
          detail={detail.data}
          slugs={slugList}
          onChanged={invalidate}
        />
        <CodesPanel
          detail={detail.data}
          slugs={slugList}
          onChanged={invalidate}
        />
        <StoreOffersPanel
          detail={detail.data}
          slugs={slugList}
          onChanged={invalidate}
        />
        <MetricsPanel detail={detail.data} onChanged={invalidate} />

        <Panel title="Brief">
          {plan.briefMd ? (
            <Markdown source={plan.briefMd} />
          ) : (
            <EmptyState>
              No brief pasted yet — add one when creating or editing the plan.
            </EmptyState>
          )}
        </Panel>
      </div>
    </>
  );
}
