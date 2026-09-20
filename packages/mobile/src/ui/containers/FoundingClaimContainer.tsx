import React, { useState } from "react";
import { useFoundingClaim } from "@/ui/hooks/useFoundingClaim";
import { FoundingClaimPresenter } from "@/ui/presenters/FoundingClaimPresenter";

export function FoundingClaimContainer() {
  const { request, verify } = useFoundingClaim();
  const [expanded, setExpanded] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const busy = request.isPending || verify.isPending;
  const send = async () => {
    verify.reset();
    try {
      const challenge = await request.mutateAsync(email);
      setChallengeId(challenge.challengeId);
      setCode("");
    } catch {
      // Mutation errors are shown inline.
    }
  };
  const claim = async () => {
    request.reset();
    try {
      await verify.mutateAsync({ challengeId, code });
    } catch {
      // Keep the challenge for retry; expired codes can be resent.
    }
  };
  return (
    <FoundingClaimPresenter
      expanded={expanded}
      email={email}
      code={code}
      codeSent={challengeId.length > 0}
      busy={busy}
      claimed={verify.isSuccess}
      error={request.error?.message ?? verify.error?.message ?? null}
      onExpand={() => setExpanded(true)}
      onEmailChange={(value) => {
        request.reset();
        verify.reset();
        setEmail(value);
      }}
      onCodeChange={(value) => {
        verify.reset();
        setCode(value.replace(/\D/g, "").slice(0, 6));
      }}
      onSend={() => void send()}
      onVerify={() => void claim()}
      onChangeEmail={() => {
        setChallengeId("");
        setCode("");
        request.reset();
        verify.reset();
      }}
    />
  );
}
