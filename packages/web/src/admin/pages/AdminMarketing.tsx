import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  adminApi,
  formatDay,
  formatMinor,
  type MarketingPlanListRow,
  type OfferLane,
} from "../adminApi";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  StatusBadge,
  Table,
  selectClass,
} from "../ui";
import { suggestPlanSlug } from "../codeHelpers";

const LANE_LABEL: Record<OfferLane, string> = {
  founding_access: "Founding access",
  store_offer: "Store offer",
};

function NewPlanForm({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [lanes, setLanes] = useState<OfferLane[]>(["founding_access"]);
  const [budgetCap, setBudgetCap] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [objective, setObjective] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [decisionRule, setDecisionRule] = useState("");
  const [briefMd, setBriefMd] = useState("");

  const create = useMutation({
    mutationFn: adminApi.createMarketingPlan,
    onSuccess: (plan) => onCreated(plan.id),
  });

  function toggleLane(lane: OfferLane, on: boolean) {
    setLanes((current) =>
      on ? [...new Set([...current, lane])] : current.filter((l) => l !== lane),
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate({
      name: name.trim(),
      slug: slug || suggestPlanSlug(name),
      offerLanes: lanes,
      budgetCapMinor:
        budgetCap.trim() === ""
          ? null
          : Math.round(Number.parseFloat(budgetCap) * 100),
      startsOn: startsOn || null,
      endsOn: endsOn || null,
      objective: objective.trim() || null,
      hypothesis: hypothesis.trim() || null,
      decisionRule: decisionRule.trim() || null,
      briefMd: briefMd.trim() || null,
    });
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-4"
      aria-label="New marketing plan"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="plan-name">Name</Label>
          <Input
            id="plan-name"
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(suggestPlanSlug(e.target.value));
            }}
            placeholder="Founders' offer — Sep 2026"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="plan-slug">Slug</Label>
          <Input
            id="plan-slug"
            required
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
            }}
            minLength={3}
            maxLength={48}
          />
        </div>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Offer lanes</legend>
          {(Object.keys(LANE_LABEL) as OfferLane[]).map((lane) => (
            <label
              key={lane}
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <input
                type="checkbox"
                checked={lanes.includes(lane)}
                onChange={(e) => toggleLane(lane, e.target.checked)}
              />
              {LANE_LABEL[lane]}
            </label>
          ))}
        </fieldset>
        <div className="space-y-1.5">
          <Label htmlFor="plan-budget">Budget cap (£, optional)</Label>
          <Input
            id="plan-budget"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={budgetCap}
            onChange={(e) => setBudgetCap(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="plan-starts">Starts</Label>
          <Input
            id="plan-starts"
            type="date"
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="plan-ends">Ends</Label>
          <Input
            id="plan-ends"
            type="date"
            value={endsOn}
            onChange={(e) => setEndsOn(e.target.value)}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="plan-objective">Objective</Label>
          <Input
            id="plan-objective"
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="plan-hypothesis">Hypothesis</Label>
          <Input
            id="plan-hypothesis"
            value={hypothesis}
            onChange={(e) => setHypothesis(e.target.value)}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="plan-decision">Decision rule</Label>
          <Input
            id="plan-decision"
            value={decisionRule}
            onChange={(e) => setDecisionRule(e.target.value)}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="plan-brief">Brief (markdown)</Label>
          <Textarea
            id="plan-brief"
            rows={8}
            className="font-mono text-xs"
            value={briefMd}
            onChange={(e) => setBriefMd(e.target.value)}
            placeholder="Paste the marketing brief here."
          />
        </div>
      </div>
      {create.isError ? <ErrorState error={create.error} /> : null}
      <Button type="submit" disabled={create.isPending}>
        {create.isPending ? "Creating…" : "Create plan"}
      </Button>
    </form>
  );
}

function BudgetCell({ plan }: { plan: MarketingPlanListRow }) {
  if (plan.budgetCapMinor === null) {
    return (
      <span className="tabular-nums">
        {formatMinor(plan.spendMinor, plan.currency)}
      </span>
    );
  }
  const pct = Math.min(
    100,
    plan.budgetCapMinor > 0
      ? Math.round((plan.spendMinor / plan.budgetCapMinor) * 100)
      : 0,
  );
  return (
    <div className="min-w-32">
      <div className="tabular-nums">
        {formatMinor(plan.spendMinor, plan.currency)} /{" "}
        {formatMinor(plan.budgetCapMinor, plan.currency)}
      </div>
      <div
        className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted"
        aria-label={`${pct}% of budget cap spent`}
      >
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/**
 * The marketing plans list.
 *
 * Spend is hand-entered and store clicks are first-party; grants are counted
 * for the codes linked to the plan. There is deliberately no revenue, CAC or
 * ROAS column — grants are access rather than sales, so the numbers to build
 * one from do not exist (FOUNDING-OFFER 2026-09-04 amendment).
 */
export function AdminMarketing() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const showNew = params.get("new") === "1";
  const [status, setStatus] = useState("");
  const plans = useQuery({
    queryKey: ["admin", "marketing", "plans", status],
    queryFn: () => adminApi.marketingPlans(status || undefined),
  });

  return (
    <>
      <PageHeader title="Marketing">
        <Button
          variant={showNew ? "outline" : "default"}
          onClick={() => setParams(showNew ? {} : { new: "1" })}
        >
          {showNew ? "Close form" : "New plan"}
        </Button>
      </PageHeader>

      <div className="space-y-6">
        {showNew ? (
          <Panel title="New plan">
            <NewPlanForm
              onCreated={() => {
                setParams({});
                void qc.invalidateQueries({
                  queryKey: ["admin", "marketing"],
                });
              }}
            />
          </Panel>
        ) : null}

        <Panel>
          <div className="mb-3">
            <select
              className={`${selectClass} max-w-40`}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="complete">Complete</option>
            </select>
          </div>
          {plans.isError ? <ErrorState error={plans.error} /> : null}
          {plans.data && plans.data.length === 0 ? (
            <EmptyState>
              No plans yet — create one for each campaign you want to track.
            </EmptyState>
          ) : null}
          {plans.data && plans.data.length > 0 ? (
            <Table
              head={[
                "Plan",
                "Status",
                "Lanes",
                "Channels",
                "Dates",
                "Spend",
                "Store clicks",
                "Grants",
              ]}
            >
              {plans.data.map((plan) => (
                <tr key={plan.id}>
                  <td>
                    <Link
                      to={`/admin/marketing/${plan.id}`}
                      className="font-medium underline underline-offset-2"
                    >
                      {plan.name}
                    </Link>
                    <div className="font-mono text-xs text-muted-foreground">
                      {plan.slug}
                    </div>
                  </td>
                  <td>
                    <StatusBadge status={plan.status} />
                  </td>
                  <td className="text-xs">
                    {plan.offerLanes.length === 0
                      ? "—"
                      : plan.offerLanes
                          .map((lane) => LANE_LABEL[lane as OfferLane] ?? lane)
                          .join(", ")}
                  </td>
                  <td className="tabular-nums">{plan.channelsCount}</td>
                  <td className="whitespace-nowrap text-xs">
                    {formatDay(plan.startsOn)} → {formatDay(plan.endsOn)}
                  </td>
                  <td>
                    <BudgetCell plan={plan} />
                  </td>
                  <td className="tabular-nums">{plan.storeClicks}</td>
                  <td className="tabular-nums">{plan.grants}</td>
                </tr>
              ))}
            </Table>
          ) : null}
        </Panel>
      </div>
    </>
  );
}
