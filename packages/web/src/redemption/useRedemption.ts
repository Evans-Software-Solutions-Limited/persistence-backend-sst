import { useEffect, useRef, useState } from "react";
import * as auth from "./auth";
import { voucherApi, type Challenge, type Redemption } from "./api";
import {
  clearDraft,
  loadDraft,
  saveDraft,
  type RedemptionDraft,
} from "./draft";

export function useRedemption() {
  const [draft, setDraft] = useState(loadDraft);
  const [eligibilityCode, setEligibilityCode] = useState<string | null>(null);
  const requiresEligibilityEmail = eligibilityCode === draft.code.trim();
  const [account, setAccount] = useState<auth.MembershipAccount | null>(null);
  const [stage, setStage] = useState<
    "details" | "account" | "verify" | "confirm" | "complete"
  >("details");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [result, setResult] = useState<Redemption | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retryableSignIn, setRetryableSignIn] = useState(false);
  const startup = useRef<Promise<auth.MembershipAccount | null> | null>(null);
  const [callback] = useState(() =>
    window.location.pathname.replace(/\/+$/, "") === "/redeem/callback"
      ? { hash: window.location.hash, search: window.location.search }
      : null,
  );

  useEffect(() => {
    let alive = true;
    // Remove credentials before any provider/API requests or navigation.
    if (window.location.pathname.replace(/\/+$/, "") === "/redeem/callback")
      window.history.replaceState(null, "", "/redeem/callback");
    startup.current ??= callback?.search
      ? auth.completeAppleCallback(callback.search, callback.hash)
      : callback?.hash
        ? auth.completeCallback(callback.hash)
        : auth.currentAccount();
    startup.current
      .then((a) => {
        if (alive) {
          setAccount(a);
          if (a)
            setDraft((current) => ({
              ...current,
              accountEmail: a.email,
            }));
        }
      })
      .catch((e) => {
        if (alive) {
          const retryable = auth.isRetryableAuthError(e);
          setRetryableSignIn(retryable);
          if (!retryable) auth.signOut();
          setError(
            retryable && e instanceof Error
              ? e.message
              : "Your sign-in could not be verified. Continue below to sign in or request a new link.",
          );
        }
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [callback]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function prepare(next: RedemptionDraft) {
    const proof = await voucherApi.prepare(
      next.code.trim(),
      next.eligibilityEmail.trim().toLowerCase() || undefined,
    );
    setChallenge(proof);
    setStage(proof.verified ? "confirm" : "verify");
  }

  const details = () =>
    run(async () => {
      const code = draft.code.trim();
      const checked = await voucherApi.check(code);
      setEligibilityCode(checked.requiresEligibilityEmail ? code : null);
      if (
        checked.requiresEligibilityEmail &&
        (!requiresEligibilityEmail || !draft.eligibilityEmail.trim())
      )
        return;
      const next = {
        ...draft,
        code,
        eligibilityEmail: checked.requiresEligibilityEmail
          ? draft.eligibilityEmail.trim().toLowerCase()
          : "",
        accountEmail: draft.accountEmail.trim().toLowerCase(),
      };
      // An email-specific preflight also prevents duplicate/ineligible attempts before auth.
      await voucherApi.check(
        next.code,
        next.eligibilityEmail || account?.email || undefined,
      );
      saveDraft(next);
      setDraft(next);
      setChallenge(null);
      if (account?.email.toLowerCase() === next.accountEmail)
        await prepare(next);
      else setStage("account");
    });

  async function recheckBeforeAuth(apple = false) {
    try {
      await voucherApi.check(
        draft.code,
        draft.eligibilityEmail ||
          (apple ? undefined : draft.accountEmail || undefined),
      );
    } catch (e) {
      setStage("details");
      throw e;
    }
  }

  const apple = () =>
    run(async () => {
      await recheckBeforeAuth(true);
      saveDraft(draft);
      const url = await auth.appleOAuthUrl();
      setAccount(null);
      setChallenge(null);
      window.location.assign(url);
    });

  const retrySignIn = () =>
    run(async () => {
      try {
        const a = await auth.currentAccount();
        setAccount(a);
        if (a) setDraft((current) => ({ ...current, accountEmail: a.email }));
        setRetryableSignIn(false);
      } catch (e) {
        const retryable = auth.isRetryableAuthError(e);
        setRetryableSignIn(retryable);
        if (!retryable) auth.signOut();
        throw e;
      }
    });

  const authenticate = (mode: "signin" | "signup", password: string) =>
    run(async () => {
      if (!draft.accountEmail.trim())
        throw new Error("Enter your membership account email to continue.");
      saveDraft(draft);
      await recheckBeforeAuth();
      const a =
        mode === "signup"
          ? await auth.signUp(draft.accountEmail.trim().toLowerCase(), password)
          : await auth.signIn(
              draft.accountEmail.trim().toLowerCase(),
              password,
            );
      if (!a) {
        setNotice(
          "Check your membership email for the confirmation link. After confirming, return here. If you already have an account, sign in instead.",
        );
        return;
      }
      setAccount(a);
      setDraft((current) => ({ ...current, accountEmail: a.email }));
      // Show authenticated identity before allowing any grant to that account.
      setStage("details");
      setNotice(`Signed in as ${a.email}. Continue to verify your voucher.`);
    });

  const emailLink = () =>
    run(async () => {
      if (!draft.accountEmail.trim())
        throw new Error("Enter your membership account email to continue.");
      saveDraft(draft);
      await recheckBeforeAuth();
      await auth.sendSignInLink(draft.accountEmail.trim().toLowerCase());
      setNotice(
        "If an account exists for this email, a sign-in link is on its way. Open it to continue. New to Persistence? Choose Create account.",
      );
    });

  const verify = (otp: string) =>
    run(async () => {
      if (!challenge) return;
      const proof = await voucherApi.verify(challenge.challengeId, otp.trim());
      setChallenge(proof);
      if (proof.verified) setStage("confirm");
    });
  const redeem = () =>
    run(async () => {
      if (!challenge?.verified) return;
      const completed = await voucherApi.redeem(challenge.challengeId);
      clearDraft();
      setResult(completed);
      setStage("complete");
    });
  const restart = () => {
    setChallenge(null);
    setError("");
    setNotice("");
    setStage("details");
  };
  const changeAccount = () => {
    auth.signOut();
    setRetryableSignIn(false);
    setAccount(null);
    setDraft((current) => ({ ...current, accountEmail: "" }));
    restart();
  };
  return {
    draft,
    setDraft,
    requiresEligibilityEmail,
    account,
    stage,
    challenge,
    result,
    busy,
    error,
    notice,
    details,
    authenticate,
    emailLink,
    apple,
    retrySignIn,
    retryableSignIn,
    verify,
    redeem,
    restart,
    changeAccount,
  };
}
