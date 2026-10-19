import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useLocation } from "react-router";
import * as auth from "@/founding/auth";
import { subscribe } from "@/lib/consent";
import { marketingApiBase } from "@/lib/marketingApiBase";
import {
  captureTduid,
  hasAffiliateReferral,
  initTradedoubler,
} from "@/lib/tradedoubler";
import { turnstileConfigured } from "@/lib/turnstile";
import type { TurnstileHandle } from "@/marketing/LeadForms";
import {
  BLC_CODE_STORAGE_KEY,
  BLC_COPY,
  BLC_INVALID_CODE_MESSAGE,
  BLC_OFFER,
  BLC_PATH,
  BLC_PLAN_STORAGE_KEY,
  BLC_RETURN_PATH,
  isBlcCadence,
  isBlcTier,
  type BlcCadence,
  type BlcPrice,
  type BlcTier,
} from "./blcOffer";
import { useBlcCheckout } from "./useBlcCheckout";

/**
 * The `campaign` every Blue Light Card checkout is attributed to. The page is
 * not itself a campaign landing route (`/blc` is, and renders Home), so
 * `useCampaign()` would always be undefined here — and a visitor can only
 * reach this page through the affiliate link, so the channel is known.
 */
export const BLC_CAMPAIGN = "blc";

export type BlcCodeStatus =
  | "empty"
  | "checking"
  | "invalid"
  | "error"
  | "valid";

export type BlcStep = "ungated" | "code" | "plans" | "account" | "checkout";

export interface BlcSelectedPlan {
  tier: BlcTier;
  cadence: BlcCadence;
  price: BlcPrice;
}

function readStored(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // ignore — locked-down storage only costs the reload convenience.
  }
}

/** `POST /blc/code/check` → the status it implies. Never throws. */
async function requestCodeCheck(trimmed: string): Promise<BlcCodeStatus> {
  try {
    const response = await fetch(`${marketingApiBase()}/blc/code/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: trimmed }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
    };
    if (response.ok && body.ok === true) return "valid";
    if (response.status === 400) return "invalid";
    return "error";
  } catch {
    return "error";
  }
}

function parsePlan(
  value: string | null | undefined,
): { tier: BlcTier; cadence: BlcCadence } | null {
  if (!value) return null;
  const [tier, cadence] = value.split(":");
  return isBlcTier(tier) && isBlcCadence(cadence) ? { tier, cadence } : null;
}

/**
 * All the logic behind `/blue-light-card` (PER-3). The presenter is a plain
 * render of what this returns, so the Claude Design pass that restyles the
 * page later replaces the presenter and leaves this alone.
 *
 * ─── The gate ───
 *
 * The offer (code field, then prices) shows only to someone who came through
 * the affiliate link — a `tduid` on the URL, one kept from earlier in the
 * session, or the SDK's cookie — or who already holds a code that checks out
 * (a reload, or the return leg of a sign-in redirect, carries no `tduid`).
 * Anyone else sees a page that names the offer, shows no price, and points at
 * Blue Light Card.
 *
 * ─── The sign-in round trip ───
 *
 * Sign-in reuses the founding account flow. The redirecting methods are
 * started with `returnPath` so Supabase returns to `/blue-light-card/callback`,
 * and with the code + chosen plan in the proof so a link opened in a fresh
 * tab still lands on the right step. The auth code is captured once from the
 * URL and stripped in a layout effect — this page loads the Meta pixel, which
 * transmits the document location.
 */
export function useBlcOffer() {
  const location = useLocation();
  // Snapshot ONCE: the address bar is rewritten below and must not re-trigger.
  const [entry] = useState(() => ({
    pathname: location.pathname,
    search: location.search,
    hash: location.hash,
  }));
  const [callback] = useState(() => entry.pathname === BLC_RETURN_PATH);
  const [extra] = useState(() =>
    callback ? auth.callbackExtra(entry.search) : null,
  );
  const [cancelled] = useState(
    () =>
      !callback && new URLSearchParams(entry.search).get("cancelled") === "1",
  );

  const [referral, setReferral] = useState(() => hasAffiliateReferral());
  const [code, setCode] = useState(
    () => extra?.code ?? readStored(BLC_CODE_STORAGE_KEY) ?? "",
  );
  // A code carried over a reload or the sign-in round trip is re-checked, not
  // trusted: the server is the authority and the stored copy only saves
  // typing. It starts in `checking` so the first paint is never the ungated
  // page for a member who merely reloaded.
  const [initialCode] = useState(() => code.trim());
  const [codeStatus, setCodeStatus] = useState<BlcCodeStatus>(() =>
    initialCode.length > 0 ? "checking" : "empty",
  );
  const checkSeq = useRef(0);

  const [initialPlan] = useState(() =>
    parsePlan(extra?.plan ?? readStored(BLC_PLAN_STORAGE_KEY)),
  );
  const [cadence, setCadence] = useState<BlcCadence>(
    () => initialPlan?.cadence ?? "annual",
  );
  const [selectedTier, setSelectedTier] = useState<BlcTier | null>(
    () => initialPlan?.tier ?? null,
  );

  const startup = useRef<Promise<auth.MembershipAccount | null> | null>(null);
  const [account, setAccount] = useState<auth.MembershipAccount | null>(null);
  const [retryableSignIn, setRetryableSignIn] = useState(false);
  const [busy, setBusy] = useState(true);
  const running = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signup, setSignup] = useState(false);
  const [terms, setTerms] = useState(false);
  const [receiptEmail, setReceiptEmail] = useState("");
  const [hp, setHp] = useState("");
  const [turnstile, setTurnstile] = useState("");
  const turnstileRef = useRef<TurnstileHandle>(null);
  const checkout = useBlcCheckout();

  // Strip the sign-in callback's `code`/`flow` BEFORE the pixel's PageView
  // (a passive effect above this route) can read the location.
  useLayoutEffect(() => {
    if (!callback) return;
    window.history.replaceState(null, "", BLC_PATH);
  }, [callback]);

  // The landing tag: read the click id before anything strips it (it is only
  // KEPT with consent), load the SDK if consent is already given, and react
  // to consent granted later on this page.
  useEffect(() => {
    captureTduid();
    initTradedoubler();
    return subscribe((choices) => {
      if (!choices.affiliate) return;
      captureTduid();
      initTradedoubler();
      setReferral(hasAffiliateReferral());
    });
  }, []);

  // Resolve a finished check — unless a newer one has started since, in
  // which case the stale answer is dropped rather than overwriting it.
  const settle = useCallback(
    (seq: number, trimmed: string, status: BlcCodeStatus) => {
      if (seq !== checkSeq.current) return;
      if (status === "valid") writeStored(BLC_CODE_STORAGE_KEY, trimmed);
      else if (status === "invalid") writeStored(BLC_CODE_STORAGE_KEY, null);
      setCodeStatus(status);
    },
    [],
  );

  const checkCode = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        setCodeStatus("empty");
        return;
      }
      const seq = ++checkSeq.current;
      setCodeStatus("checking");
      void requestCodeCheck(trimmed).then((status) =>
        settle(seq, trimmed, status),
      );
    },
    [settle],
  );

  useEffect(() => {
    if (initialCode.length === 0) return;
    const seq = ++checkSeq.current;
    void requestCodeCheck(initialCode).then((status) =>
      settle(seq, initialCode, status),
    );
  }, [initialCode, settle]);

  useEffect(() => {
    let alive = true;
    startup.current ??= callback
      ? auth.completeCallback(entry.search, entry.hash)
      : auth.currentAccount();
    startup.current
      .then((a) => {
        if (alive) adopt(a);
      })
      .catch((e) => {
        if (!alive) return;
        const retryable = auth.isRetryableAuthError(e);
        setRetryableSignIn(retryable);
        if (!retryable) auth.signOut();
        setError(
          e instanceof Error ? e.message : "Sign-in failed. Please try again.",
        );
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [callback, entry]);

  // The receipt defaults to the account's address; the buyer can change it.
  function adopt(a: auth.MembershipAccount | null) {
    setAccount(a);
    if (a) setReceiptEmail((current) => current || a.email);
  }

  async function run(action: () => Promise<void>) {
    if (busy || running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  const selected: BlcSelectedPlan | null =
    selectedTier === null
      ? null
      : {
          tier: selectedTier,
          cadence,
          price: BLC_OFFER[selectedTier][cadence],
        };

  const flowOptions = (): auth.AuthFlowOptions => ({
    returnPath: BLC_RETURN_PATH,
    extra: {
      code: code.trim(),
      ...(selected ? { plan: `${selected.tier}:${selected.cadence}` } : {}),
    },
  });

  function choosePlan(tier: BlcTier) {
    setSelectedTier(tier);
    writeStored(BLC_PLAN_STORAGE_KEY, `${tier}:${cadence}`);
    setError("");
    checkout.reset();
  }

  function changePlan() {
    setSelectedTier(null);
    writeStored(BLC_PLAN_STORAGE_KEY, null);
    setError("");
    setNotice("");
    checkout.reset();
  }

  function changeAccount() {
    auth.signOut();
    setAccount(null);
    setRetryableSignIn(false);
    setError("");
    setNotice("");
    setPassword("");
    setEmail("");
    setReceiptEmail("");
    checkout.reset();
  }

  function applyCode(e?: FormEvent) {
    e?.preventDefault();
    checkCode(code);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      if (!account || !selected || codeStatus !== "valid") return;
      if (turnstileConfigured() && !turnstile) {
        setError(BLC_COPY.challengeUnavailable);
        return;
      }
      const ok = await checkout.start({
        accountId: account.id,
        tier: selected.tier,
        cadence: selected.cadence,
        code: code.trim(),
        email: receiptEmail.trim(),
        priceMinor: selected.price.memberMinor,
        hp,
        campaign: BLC_CAMPAIGN,
        ...(turnstile ? { turnstileToken: turnstile } : {}),
      });
      if (!ok) {
        turnstileRef.current?.reset();
        setTurnstile("");
      }
    });
  }

  const socialSignIn = (provider: "apple" | "google") =>
    run(async () =>
      window.location.assign(await auth.oauthUrl(provider, flowOptions())),
    );
  const authenticate = () =>
    run(async () => {
      if (signup && !terms) return;
      let a: auth.MembershipAccount | null;
      try {
        a = signup
          ? await auth.signUp(email.trim(), password, flowOptions())
          : await auth.signIn(email.trim(), password);
      } catch (e) {
        setRetryableSignIn(auth.isRetryableAuthError(e));
        throw e;
      }
      setRetryableSignIn(false);
      setPassword("");
      if (a) adopt(a);
      else
        setNotice(
          "Check your email to confirm your account. Open the link in this same browser, or return here to sign in after confirming.",
        );
    });
  const retrySignIn = () =>
    run(async () => {
      try {
        adopt(await auth.currentAccount());
        setRetryableSignIn(false);
      } catch (e) {
        const retryable = auth.isRetryableAuthError(e);
        setRetryableSignIn(retryable);
        if (!retryable) auth.signOut();
        throw e;
      }
    });
  const emailLink = () =>
    run(async () => {
      await auth.sendSignInLink(email.trim(), flowOptions());
      setNotice(
        "If this email has an account, a sign-in link is on its way. Open it in this same browser. If you use Apple or Google in the app, use that button instead.",
      );
    });

  const gated = referral || codeStatus === "valid" || codeStatus === "checking";
  const step: BlcStep = !gated
    ? "ungated"
    : codeStatus !== "valid"
      ? "code"
      : selected === null
        ? "plans"
        : account === null
          ? "account"
          : "checkout";

  const codeMessage =
    codeStatus === "invalid"
      ? BLC_INVALID_CODE_MESSAGE
      : codeStatus === "error"
        ? BLC_COPY.codeCheckFailed
        : codeStatus === "valid"
          ? BLC_COPY.codeValid
          : null;

  return {
    step,
    cancelled,
    code,
    codeStatus,
    codeMessage,
    cadence,
    selected,
    account,
    retryableSignIn,
    busy,
    error,
    notice,
    email,
    password,
    signup,
    terms,
    receiptEmail,
    hp,
    turnstile,
    turnstileRef,
    checkout,
    setCode,
    setCadence,
    setEmail,
    setPassword,
    setSignup,
    setTerms,
    setReceiptEmail,
    setHp,
    setTurnstile,
    applyCode,
    choosePlan,
    changePlan,
    changeAccount,
    submit,
    socialSignIn,
    authenticate,
    retrySignIn,
    emailLink,
  };
}

export type BlcOfferView = ReturnType<typeof useBlcOffer>;
