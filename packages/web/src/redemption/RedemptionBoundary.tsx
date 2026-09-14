import { useEffect, useState, type ReactNode } from "react";

/** A marketing pixel loaded on a previous SPA route cannot be unloaded.
 * Enter redemption in a fresh document before showing any sensitive inputs. */
export function RedemptionBoundary({ children }: { children: ReactNode }) {
  const [needsFreshDocument] = useState(() => typeof window.fbq === "function");
  useEffect(() => {
    if (needsFreshDocument) window.location.replace(window.location.href);
  }, [needsFreshDocument]);
  return needsFreshDocument ? <p>Opening secure redemption…</p> : children;
}
