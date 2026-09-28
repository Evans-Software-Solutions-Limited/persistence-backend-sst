import { useEffect, useState } from "react";
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
  const [callbackHash] = useState(() =>
    window.location.pathname.replace(/\/+$/, "") === "/redeem/callback"
      ? window.location.hash
      : "",
  );

  useEffect(() => {
    let alive = true;
    // Remove credentials before any provider/API requests or navigation.
    if (window.location.pathname.replace(/\/+$/, "") === "/redeem/callback")
      window.history.replaceState(null, "", "/redeem/callback");
    const request = callbackHash
      ? auth.completeCallback(callbackHash)
      : auth.currentAccount();
    request
      .then((a) => {
        if (alive) {
          setAccount(a);
          if (a)
            setDraft((current) => ({
              ...current,
              accountEmail: current.accountEmail || a.email,
            }));
        }
      })
      .catch(() => {
        if (alive) {
          auth.signOut();
          setError(
            "Your sign-in could not be verified. Continue below to sign in or request a new link.",
          );
        }
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [callbackHash]);

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
        next.eligibilityEmail || next.accountEmail,
      );
      saveDraft(next);
      setDraft(next);
      setChallenge(null);
      if (account?.email.toLowerCase() === next.accountEmail)
        await prepare(next);
      else setStage("account");
    });

  async function recheckBeforeAuth() {
    try {
      await voucherApi.check(
        draft.code,
        draft.eligibilityEmail || draft.accountEmail,
      );
    } catch (e) {
      setStage("details");
      throw e;
    }
  }

  const authenticate = (mode: "signin" | "signup", password: string) =>
    run(async () => {
      await recheckBeforeAuth();
      const a =
        mode === "signup"
          ? await auth.signUp(draft.accountEmail, password)
          : await auth.signIn(draft.accountEmail, password);
      if (!a) {
        setNotice(
          "Check your membership email for the confirmation link. After confirming, return here. If you already have an account, sign in instead.",
        );
        return;
      }
      setAccount(a);
      // Show authenticated identity before allowing any grant to that account.
      setStage("details");
      setNotice(`Signed in as ${a.email}. Continue to verify your voucher.`);
    });

  const emailLink = () =>
    run(async () => {
      await recheckBeforeAuth();
      await auth.sendSignInLink(draft.accountEmail);
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
    setAccount(null);
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
    verify,
    redeem,
    restart,
    changeAccount,
  };
}
