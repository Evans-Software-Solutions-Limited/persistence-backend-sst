import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import QRCode from "qrcode";
import {
  useClientProfile,
  useCoachProfile,
  useLibrary,
} from "../hooks/coachQueries";
import { firstName } from "../lib/people";
import {
  buildLibrary,
  daysLeft,
  inviteMailto,
  inviteState,
  readyLines,
} from "../lib/setup";
import { LoadError, Loading } from "../ui/parts";
import { usePreview } from "../setup/usePreview";
import { InviteStepView } from "./InviteStep";
import { useInviteActions } from "./useInviteActions";

/** A QR image for the invite link (the same deep link the iPhone QR holds). */
function useQrDataUrl(text: string | null): string | null {
  const [url, setUrl] = useState<{ text: string; url: string } | null>(null);
  useEffect(() => {
    if (!text) return;
    let cancelled = false;
    QRCode.toDataURL(text, {
      margin: 0,
      width: 360,
      color: { dark: "#0a0b12", light: "#f4f4f8" },
    })
      .then((u) => {
        if (!cancelled) setUrl({ text, url: u });
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [text]);
  return url && url.text === text ? url.url : null;
}

/** Add client · 3 Invite. Issues the code on arrival when there isn't one. */
export function InviteContainer() {
  const { profileId = "" } = useParams();
  const navigate = useNavigate();
  const detailQ = useClientProfile(profileId);
  const library = useLibrary();
  const coach = useCoachProfile();
  const actions = useInviteActions();
  const tried = useRef(false);
  const [copied, setCopied] = useState(false);
  const lib = useMemo(
    () => buildLibrary(library.forms, library.schedules, library.plans),
    [library.forms, library.schedules, library.plans],
  );
  const preview = usePreview(detailQ.data, lib);
  const detail = detailQ.data;
  const state = inviteState(detail?.invite);
  const live = state === "active" ? detail!.invite : null;
  const qr = useQrDataUrl(live?.link ?? null);

  useEffect(() => {
    if (!detail || detail.status !== "invited" || tried.current) return;
    // Issuing always expires the live code, so decide from a fresh read,
    // never from data cached on another page (a code issued on another
    // device would otherwise be voided).
    // A failed refetch also counts as "fetched after mount": still cached.
    if (!detailQ.isFetchedAfterMount || detailQ.isFetching || detailQ.isError) {
      return;
    }
    if (state !== "none" || !actions.online) return;
    tried.current = true;
    void actions.issue(detail.id);
  }, [
    detail,
    state,
    actions,
    detailQ.isFetchedAfterMount,
    detailQ.isFetching,
    detailQ.isError,
  ]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  if (detailQ.isPending) return <Loading />;
  if (!detail) {
    return (
      <LoadError
        message="We couldn't load this client."
        onRetry={() => void detailQ.refetch()}
      />
    );
  }
  if (detail.status === "active" && detail.clientId) {
    return <Navigate to={`/coach/clients/${detail.clientId}`} replace />;
  }

  const clientFirst = firstName(detail.displayName);
  const base = `/coach/clients/invited/${detail.id}`;
  const coachName = coach.data?.fullName ?? "Your coach";
  const days = live ? daysLeft(live.expiresAt) : null;

  async function copyLink() {
    if (!live) return;
    try {
      await navigator.clipboard.writeText(live.link);
      setCopied(true);
    } catch {
      // Clipboard refused (permissions); the code is on screen to copy.
    }
  }

  return (
    <>
      <InviteStepView
        clientFirst={clientFirst}
        backTo={{ to: "/coach/clients", label: "Clients" }}
        code={live?.code ?? null}
        qrDataUrl={qr}
        state={state}
        daysLeft={days}
        email={detail.contactEmail}
        mailtoHref={
          live && detail.contactEmail
            ? inviteMailto({
                email: detail.contactEmail,
                clientFirst,
                coachName,
                code: live.code,
                link: live.link,
                days: days ?? 7,
              })
            : null
        }
        ready={readyLines(detail, lib)}
        copied={copied}
        busy={actions.busyId === detail.id}
        offline={!actions.online}
        error={
          actions.error ??
          (detail.status === "cancelled"
            ? "This invite was cancelled. Send a new one to invite them again."
            : null)
        }
        onCopyLink={() => void copyLink()}
        onIssue={() => void actions.issue(detail.id)}
        onPreview={preview.open}
        onBack={() => void navigate(`${base}/setup`)}
        onDone={() => void navigate(base)}
      />
      {preview.panel}
      {actions.dialog}
    </>
  );
}
