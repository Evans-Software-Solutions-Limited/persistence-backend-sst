import { Link } from "react-router";
import { IconLock } from "../ui/icons";

/** The 11 client tabs (C3, K layout). Web shows all of them. */
const TABS = [
  "Overview",
  "Training",
  "Nutrition",
  "Check-ins",
  "Photos",
  "Body",
  "Habits",
  "Messages",
  "Resources",
  "Notes",
  "Settings",
] as const;
export type ClientTab = (typeof TABS)[number];

/**
 * `open` tabs link to `hrefFor(tab)`. Locked tabs (an invited client) show a
 * lock and say why; tabs not on the web yet are shown but inert.
 */
export function ClientTabs({
  selected,
  open,
  locked,
  lockedReason,
  hrefFor,
}: {
  selected: ClientTab;
  open: readonly ClientTab[];
  locked: boolean;
  lockedReason: string;
  hrefFor: (tab: ClientTab) => string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label="Client">
      {TABS.map((tab) => {
        if (open.includes(tab)) {
          return (
            <Link
              key={tab}
              role="tab"
              aria-selected={tab === selected}
              to={hrefFor(tab)}
            >
              {tab}
            </Link>
          );
        }
        return (
          <span
            key={tab}
            role="tab"
            aria-selected={false}
            aria-disabled="true"
            aria-label={
              locked ? `${tab}, ${lockedReason}` : `${tab}, not on the web yet`
            }
            title={locked ? undefined : "Not on the web yet"}
          >
            {locked && <IconLock size={14} />}
            {tab}
          </span>
        );
      })}
    </div>
  );
}
