import { createContext, useContext, type ReactNode } from "react";
import type { Adapters } from "@/shared/types";

export const AdapterContext = createContext<Adapters | null>(null);

/**
 * Access the adapter instances (API, storage, health, etc.).
 * Must be used within an AdapterProvider.
 */
export function useAdapters(): Adapters {
  const ctx = useContext(AdapterContext);
  if (!ctx) {
    throw new Error("useAdapters must be used within an AdapterProvider");
  }
  return ctx;
}

/**
 * Provides adapter instances to the component tree.
 * Wrap your app root (or test harness) with this.
 */
export function AdapterProvider({
  children,
  adapters,
}: {
  children: ReactNode;
  adapters: Adapters;
}) {
  return (
    <AdapterContext.Provider value={adapters}>
      {children}
    </AdapterContext.Provider>
  );
}
