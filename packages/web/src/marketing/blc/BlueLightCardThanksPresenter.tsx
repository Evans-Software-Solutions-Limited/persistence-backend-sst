import { Link } from "react-router";
import { AppStoreCta } from "@/marketing/AppStoreCta";
import { PlayStoreCta } from "@/marketing/PlayStoreCta";
import { BLC_COPY, BLC_PATH } from "./blcOffer";
import "./blc.css";

export type BlcThanksState =
  /** Paid (or still confirming) and the access is being set up. */
  | "pending"
  /** Paid and the subscription is live. */
  | "complete"
  /** No session, or the checkout expired — nothing was taken. */
  | "unfinished"
  /** Our API could not answer; the buyer may well have paid. */
  | "unreachable";

export interface BlcThanksView {
  state: BlcThanksState;
  /** `pending` only: the page has stopped polling for the subscription. */
  slow: boolean;
  /** `complete` only: "Premium, annual, £111.99/yr". */
  planLine: string;
  /** `complete` only. */
  emailMasked: string;
  /** `complete` only: where "Open Persistence" goes. */
  openAppHref: string;
}

/**
 * The `/blue-light-card/thanks` render (PER-3), from the reviewed Claude
 * Design: one narrow card, three states. `unreachable` has no design of its
 * own and borrows the unfinished layout with its own, non-committal copy — it
 * must never tell a paying buyer nothing was charged.
 */
export function BlueLightCardThanksPresenter(view: BlcThanksView) {
  return (
    <div className="blc">
      <section className="blc-stage">
        <div className="c blc-stage-inner">
          <div className="blc-card blc-thanks" aria-live="polite">
            {view.state === "pending" && (
              <>
                <span
                  className="blc-spin blc-thanks-spin"
                  role="img"
                  aria-label="Working"
                />
                <h1 className="blc-panel-h">
                  {BLC_COPY.thanks.pendingHeading}
                </h1>
                <p className="blc-thanks-body">{BLC_COPY.thanks.pendingBody}</p>
                {view.slow && (
                  <p className="blc-thanks-note">
                    {BLC_COPY.thanks.pendingSlow}
                  </p>
                )}
              </>
            )}

            {view.state === "complete" && (
              <>
                <span className="blc-thanks-icon blc-thanks-icon-ok">
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.25"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m5 12.5 4.5 4.5L19 7.5" />
                  </svg>
                </span>
                <h1 className="blc-thanks-h disp">
                  {BLC_COPY.thanks.paidLead}
                  <span className="it">{BLC_COPY.thanks.paidEmphasis}</span>
                  {BLC_COPY.thanks.paidEnd}
                </h1>
                <dl className="blc-thanks-rows">
                  <div className="blc-thanks-row">
                    <dt>{BLC_COPY.thanks.planLabel}</dt>
                    <dd>{view.planLine}</dd>
                  </div>
                  <div className="blc-thanks-row">
                    <dt>{BLC_COPY.thanks.accountLabel}</dt>
                    <dd>{view.emailMasked}</dd>
                  </div>
                </dl>
                <a className="btn btn-accent btn-block" href={view.openAppHref}>
                  {BLC_COPY.thanks.openApp}
                </a>
                <div className="store-btns">
                  <AppStoreCta variant="store" />
                  <PlayStoreCta variant="store" />
                </div>
                <p className="blc-thanks-body">{BLC_COPY.thanks.paidNote}</p>
              </>
            )}

            {(view.state === "unfinished" || view.state === "unreachable") && (
              <>
                <span className="blc-thanks-icon">
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 8v4M12 16h.01" />
                  </svg>
                </span>
                <h1 className="blc-panel-h">
                  {view.state === "unfinished"
                    ? BLC_COPY.thanks.unfinishedHeading
                    : BLC_COPY.thanks.unreachableHeading}
                </h1>
                <p className="blc-thanks-body">
                  {view.state === "unfinished"
                    ? BLC_COPY.thanks.unfinishedBody
                    : BLC_COPY.thanks.unreachableBody}
                </p>
                <Link className="btn btn-line btn-block" to={BLC_PATH}>
                  {BLC_COPY.thanks.backCta}
                </Link>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
