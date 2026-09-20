import { CAMPAIGN_LANDING_SLUGS } from "@/marketing/campaign";
import { useEffect, useRef, useState, type FormEvent } from "react";
import * as auth from "./auth";
import { foundingApi, type ClaimResult } from "./api";
import { FOUNDING_PLANS, type FoundingPlan } from "@/marketing/foundingOffer";
import { useFoundingCheckout } from "@/marketing/useFoundingCheckout";
import { type TurnstileHandle } from "@/marketing/LeadForms";
import { turnstileConfigured } from "@/lib/turnstile";
import { appDestination } from "@/lib/appDestination";

const PLAN_KEY = "persistence.founding.selected-plan";
function initialPlan(): FoundingPlan | null {
  const params = new URLSearchParams(window.location.search);
  const callback = window.location.pathname === "/founding/access/callback";
  let selected = `${params.get("tier")}:${params.get("months")}`;
  if (callback) selected = auth.callbackPlan(window.location.search) ?? "";
  const plan =
    FOUNDING_PLANS.find((p) => `${p.tier}:${p.months}` === selected) ?? null;
  if (plan) sessionStorage.setItem(PLAN_KEY, `${plan.tier}:${plan.months}`);
  else sessionStorage.removeItem(PLAN_KEY);
  return plan;
}

export function useFoundingAccess() {
  const [plan] = useState(initialPlan);
  const [campaign] = useState(() => {
    const callback = window.location.pathname === "/founding/access/callback";
    const value = callback
      ? auth.callbackCampaign(window.location.search)
      : new URLSearchParams(window.location.search).get("campaign");
    const valid =
      value && CAMPAIGN_LANDING_SLUGS.includes(value) ? value : undefined;
    if (valid) sessionStorage.setItem("persistence.founding.campaign", valid);
    else sessionStorage.removeItem("persistence.founding.campaign");
    return valid;
  });
  const [callback] = useState(() =>
    window.location.pathname === "/founding/access/callback"
      ? { search: window.location.search, hash: window.location.hash }
      : null,
  );
  const startup = useRef<Promise<auth.MembershipAccount | null> | null>(null);
  const [account, setAccount] = useState<auth.MembershipAccount | null>(null);
  const [busy, setBusy] = useState(true);
  const running = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signup, setSignup] = useState(false);
  const [terms, setTerms] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [purchaseEmail, setPurchaseEmail] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [result, setResult] = useState<ClaimResult | null>(null);
  const [hp, setHp] = useState("");
  const [turnstile, setTurnstile] = useState("");
  const turnstileRef = useRef<TurnstileHandle>(null);
  const checkout = useFoundingCheckout();
  const destination = appDestination();

  useEffect(() => {
    document.title = "Your founding access · Persistence";
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex, nofollow";
    const referrer = document.createElement("meta");
    referrer.name = "referrer";
    referrer.content = "no-referrer";
    document.head.append(robots, referrer);
    return () => {
      robots.remove();
      referrer.remove();
    };
  }, []);
  useEffect(() => {
    let alive = true;
    if (callback)
      window.history.replaceState(
        null,
        "",
        plan
          ? `/founding/access?tier=${plan.tier}&months=${plan.months}${campaign ? `&campaign=${encodeURIComponent(campaign)}` : ""}`
          : "/founding/access",
      );
    startup.current ??= callback
      ? auth.completeCallback(callback.search, callback.hash)
      : auth.currentAccount();
    startup.current
      .then((a) => {
        if (alive) setAccount(a);
      })
      .catch((e) => {
        if (alive) {
          auth.signOut();
          setError(
            e instanceof Error
              ? e.message
              : "Sign-in failed. Please try again.",
          );
        }
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [callback, plan, campaign]);

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
  function changeAccount() {
    auth.signOut();
    setAccount(null);
    setConfirmed(false);
    setChallenge(null);
    setCode("");
    setResult(null);
    setError("");
    setNotice("");
    setPassword("");
    setEmail("");
    setPurchaseEmail("");
    checkout.reset();
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      if (!account || !confirmed) return;
      if (plan) {
        if (turnstileConfigured() && !turnstile) {
          setError("Please complete the security check before paying.");
          return;
        }
        const ok = await checkout.start({
          accountId: account.id,
          campaign,
          tier: plan.tier,
          months: plan.months,
          email: purchaseEmail.trim(),
          priceMinor: plan.priceMinor,
          hp,
          ...(turnstile ? { turnstileToken: turnstile } : {}),
        });
        if (!ok) {
          turnstileRef.current?.reset();
          setTurnstile("");
        }
      } else if (challenge) {
        const claimed = await foundingApi.verify(challenge, code, account.id);
        setResult(claimed);
        setCode("");
        setChallenge(null);
      } else {
        const proof = await foundingApi.request(
          purchaseEmail.trim(),
          account.id,
        );
        setChallenge(proof.challengeId);
        setCode("");
      }
    });
  }

  const socialSignIn = (provider: "apple" | "google") =>
    run(async () => window.location.assign(await auth.oauthUrl(provider)));
  const authenticate = () =>
    run(async () => {
      if (signup && !terms) return;
      const a = signup
        ? await auth.signUp(email.trim(), password)
        : await auth.signIn(email.trim(), password);
      setPassword("");
      if (a) {
        setAccount(a);
        setConfirmed(false);
      } else
        setNotice(
          "Check your email to confirm your account. Open the link in this same browser, or return here to sign in after confirming.",
        );
    });
  const emailLink = () =>
    run(async () => {
      await auth.sendSignInLink(email.trim());
      setNotice(
        "If this email has an account, a sign-in link is on its way. Open it in this same browser. If you use Apple or Google in the app, use that button instead.",
      );
    });
  return {
    plan,
    account,
    busy,
    error,
    notice,
    email,
    password,
    signup,
    terms,
    confirmed,
    purchaseEmail,
    challenge,
    code,
    result,
    hp,
    turnstile,
    turnstileRef,
    checkout,
    destination,
    setEmail,
    setPassword,
    setSignup,
    setTerms,
    setConfirmed,
    setPurchaseEmail,
    setCode,
    setHp,
    setTurnstile,
    setChallenge,
    setError,
    changeAccount,
    submit,
    socialSignIn,
    authenticate,
    emailLink,
  };
}
