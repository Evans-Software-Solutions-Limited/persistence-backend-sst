import { parsePolicy, type AppVersionPolicy } from "./policy";
export interface PolicyStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}
/** The same policy is cached per API environment, never per signed-in account. */
export async function readPolicy(
  storage: PolicyStorage,
  environment: string,
): Promise<AppVersionPolicy | null> {
  try {
    return parsePolicy(
      JSON.parse(
        (await storage.getItem(`app-policy:${environment}`)) || "null",
      ),
    );
  } catch {
    return null;
  }
}
export async function fetchPolicy(
  storage: PolicyStorage,
  environment: string,
  signal: AbortSignal,
): Promise<AppVersionPolicy> {
  const response = await fetch(`${environment.replace(/\/$/, "")}/app-policy`, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("policy-unavailable");
  const policy = parsePolicy(await response.json());
  if (!policy || signal.aborted) throw new Error("invalid-policy");
  try {
    await storage.setItem(`app-policy:${environment}`, JSON.stringify(policy));
  } catch {
    /* Current launch still enforces an accepted policy if storage is unavailable. */
  }
  return policy;
}
