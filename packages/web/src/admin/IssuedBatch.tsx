import { useEffect, useState } from "react";
import { IconDownload } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Panel, ErrorState } from "./ui";
import { voucherApi } from "./voucherApi";
import { distributionCsv, downloadCsv } from "./voucherCsv";
import {
  clearIssuedVouchers,
  saveIssuedVouchers,
  voucherIssuanceOwner,
  type IssuedVouchers,
} from "./issuedVouchers";

export function IssuedBatch({
  issued,
  onClose,
}: {
  issued: IssuedVouchers;
  onClose: () => void;
}) {
  const [downloaded, setDownloaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const protectCodes = (e: MouseEvent) => {
      const anchor =
        e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (
        !anchor ||
        anchor.hasAttribute("download") ||
        anchor.getAttribute("target") === "_blank"
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      setError(
        new Error(
          "Download and save the codes, then select ‘I have saved the codes’ before leaving this page.",
        ),
      );
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", protectCodes, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", protectCodes, true);
    };
  }, []);
  async function download() {
    setBusy(true);
    setError(null);
    try {
      // Best effort retry if storage became unavailable after creation.
      try {
        saveIssuedVouchers(voucherIssuanceOwner(), issued);
      } catch {
        /* Keep the direct download available. */
      }
      await voucherApi.exportAudit(issued.batch.id);
      downloadCsv(
        distributionCsv(issued.batch, issued.codes),
        `persistence-vouchers-${issued.batch.id}-${issued.codes[0].id}.csv`,
      );
      setDownloaded(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel
      title={`${issued.codes.length} ${issued.codes.length === 1 ? "code" : "codes"} generated for ${issued.batch.businessName}`}
    >
      <div className="space-y-4">
        <p role="status">
          Your new codes are ready. Download and securely save the distribution
          CSV now. This admin account can recover pending codes in this browser
          tab for up to 24 hours, until you confirm they are saved.
        </p>
        <div className="admin-notice">
          This file contains one-time membership codes and any assigned employee
          emails. Share each code only with its intended recipient. The CSV
          includes the redemption website.
        </div>
        {issued.storageWarning ? (
          <ErrorState error={new Error(issued.storageWarning)} />
        ) : null}
        {error ? <ErrorState error={error} /> : null}
        <div className="admin-actions">
          <Button onClick={() => void download()} disabled={busy}>
            <IconDownload size={16} />
            {busy ? "Preparing download…" : "Download codes CSV"}
          </Button>
          {downloaded ? (
            <Button
              variant="outline"
              onClick={() => {
                try {
                  clearIssuedVouchers(issued.batch.id, issued.codes[0].id);
                  onClose();
                } catch {
                  setError(
                    new Error(
                      "Could not clear pending codes from browser storage. Keep this page open and retry after storage is available.",
                    ),
                  );
                }
              }}
            >
              I have saved the codes
            </Button>
          ) : null}
        </div>
        {downloaded ? (
          <p className="admin-field-hint">
            Download requested. Check the file is saved before continuing; this
            acknowledgement permanently removes this tab's recovery copy.
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
