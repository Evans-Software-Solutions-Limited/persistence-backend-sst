/** Sync only Apple OAuth and its founding callback; never print credentials. */
import { getDomainConfig } from "../packages/api-utils/src/domains/domain-config";

type Stage = "production" | "staging";
type Environment = Record<string, string | undefined>;
export interface Options {
  stage: Stage;
  check: boolean;
}
export interface ValidatedConfig {
  stage: Stage;
  projectRef: string;
  accessToken: string;
  servicesId: string;
  clientSecret: string;
  nativeId: string;
  callback: string;
}
export class ConfigurationError extends Error {}

export function parseArgs(argv: string[]): Options {
  const stages = argv.filter((arg) => arg !== "--check");
  if (
    stages.length !== 1 ||
    !["production", "staging"].includes(stages[0]!) ||
    argv.filter((arg) => arg === "--check").length > 1
  ) {
    throw new ConfigurationError(
      "Usage: configure-apple-auth <production|staging> [--check]",
    );
  }
  return { stage: stages[0] as Stage, check: argv.includes("--check") };
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Format/claim checks only: these do not verify a JWT signature. */
function jwt(token: string): {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
} {
  const parts = token.split(".");
  try {
    if (
      parts.length !== 3 ||
      parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))
    ) {
      throw new Error();
    }
    const header: unknown = JSON.parse(
      Buffer.from(parts[0]!, "base64url").toString(),
    );
    const payload: unknown = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString(),
    );
    if (
      !object(header) ||
      !object(payload) ||
      !["HS256", "ES256", "RS256"].includes(String(header.alg))
    ) {
      throw new Error();
    }
    return { header, payload };
  } catch {
    throw new ConfigurationError("Invalid credential format.");
  }
}

export function validateConfig(
  stage: Stage,
  env: Environment,
  now = Date.now(),
): ValidatedConfig {
  const required = [
    "SUPABASE_ACCESS_TOKEN",
    "SUPABASE_PROJECT_REF",
    "VITE_SUPABASE_ANON_KEY",
    "APPLE_SERVICES_ID",
    "APPLE_CLIENT_SECRET",
  ] as const;
  for (const key of required) {
    if (!env[key]?.trim() || /\s/.test(env[key]!)) {
      throw new ConfigurationError(`Missing or invalid ${key}.`);
    }
  }
  const domain = getDomainConfig(stage);
  const projectRef = env.SUPABASE_PROJECT_REF!;
  if (new URL(domain.supabaseUrl).hostname !== `${projectRef}.supabase.co`) {
    throw new ConfigurationError(
      "Supabase project does not match the selected stage.",
    );
  }
  const publicKey = env.VITE_SUPABASE_ANON_KEY!;
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publicKey)) {
    const { payload } = jwt(publicKey);
    if (
      payload.role !== "anon" ||
      payload.ref !== projectRef ||
      (payload.exp !== undefined &&
        (typeof payload.exp !== "number" || payload.exp <= now / 1000))
    ) {
      throw new ConfigurationError(
        "The browser key must be a public key for the selected project.",
      );
    }
  }
  const servicesId = env.APPLE_SERVICES_ID!;
  const nativeId = `com.bradleyevans96.persistence${stage === "staging" ? ".staging" : ""}`;
  if (
    !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(servicesId) ||
    servicesId === nativeId
  ) {
    throw new ConfigurationError("Invalid Apple Services ID.");
  }
  const clientSecret = env.APPLE_CLIENT_SECRET!;
  const { header, payload } = jwt(clientSecret);
  if (
    header.alg !== "ES256" ||
    typeof header.kid !== "string" ||
    !header.kid ||
    payload.sub !== servicesId ||
    payload.aud !== "https://appleid.apple.com" ||
    typeof payload.exp !== "number" ||
    !Number.isInteger(payload.exp) ||
    payload.exp <= now / 1000 ||
    typeof payload.iss !== "string" ||
    !payload.iss.trim() ||
    typeof payload.iat !== "number" ||
    !Number.isInteger(payload.iat) ||
    payload.iat > now / 1000 + 60 ||
    payload.exp <= payload.iat ||
    payload.exp > payload.iat + 15_777_000 ||
    Buffer.from(clientSecret.split(".")[2]!, "base64url").length !== 64
  ) {
    throw new ConfigurationError(
      "Apple client secret is invalid, expired, or belongs to another Services ID.",
    );
  }
  return {
    stage,
    projectRef,
    accessToken: env.SUPABASE_ACCESS_TOKEN!,
    servicesId,
    clientSecret,
    nativeId,
    callback: `https://${domain.webHost}/founding/access/callback?flow=*`,
  };
}

interface AuthConfig {
  external_apple_enabled: boolean;
  external_apple_client_id: string;
  uri_allow_list: string;
}
function authConfig(value: unknown): AuthConfig {
  if (
    !object(value) ||
    typeof value.external_apple_enabled !== "boolean" ||
    (value.external_apple_client_id !== null &&
      typeof value.external_apple_client_id !== "string") ||
    (value.uri_allow_list !== null && typeof value.uri_allow_list !== "string")
  ) {
    throw new ConfigurationError(
      "Supabase returned an invalid auth configuration.",
    );
  }
  return {
    external_apple_enabled: value.external_apple_enabled,
    external_apple_client_id: value.external_apple_client_id ?? "",
    uri_allow_list: value.uri_allow_list ?? "",
  } as AuthConfig;
}
function entries(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
export function buildPatch(config: ValidatedConfig, existing: unknown) {
  const current = authConfig(existing);
  return {
    external_apple_enabled: true,
    external_apple_client_id: [
      ...new Set([
        config.servicesId,
        ...entries(current.external_apple_client_id),
        config.nativeId,
      ]),
    ].join(","),
    external_apple_secret: config.clientSecret,
    uri_allow_list: [
      ...new Set([...entries(current.uri_allow_list), config.callback]),
    ].join(","),
  };
}

export async function configureAppleAuth(
  config: ValidatedConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const url = `https://api.supabase.com/v1/projects/${config.projectRef}/config/auth`;
  async function request(
    method: "GET" | "PATCH",
    body?: unknown,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method,
        redirect: "error",
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ConfigurationError(`Supabase auth ${method} request failed.`);
    }
    if (!response.ok)
      throw new ConfigurationError(
        `Supabase auth ${method} failed (HTTP ${response.status}).`,
      );
    return response;
  }
  async function read(): Promise<AuthConfig> {
    const response = await request("GET");
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new ConfigurationError(
        "Supabase returned an unreadable auth configuration.",
      );
    }
    return authConfig(value);
  }
  const patch = buildPatch(config, await read());
  await request("PATCH", patch);
  const verified = await read();
  if (
    !verified.external_apple_enabled ||
    entries(verified.external_apple_client_id).join(",") !==
      patch.external_apple_client_id ||
    entries(verified.uri_allow_list).join(",") !== patch.uri_allow_list
  ) {
    throw new ConfigurationError(
      "Supabase Apple configuration verification failed.",
    );
  }
}

export async function runCli(
  argv: string[],
  env: Environment,
  fetchImpl: typeof fetch = fetch,
  output: Pick<Console, "log" | "error"> = console,
): Promise<number> {
  try {
    const options = parseArgs(argv);
    const config = validateConfig(options.stage, env);
    if (!options.check) await configureAppleAuth(config, fetchImpl);
    output.log(
      options.check
        ? "Apple auth inputs validated; no network changes made."
        : "Apple auth configuration applied and verified.",
    );
    return 0;
  } catch (error) {
    output.error(
      error instanceof ConfigurationError
        ? error.message
        : "Apple auth configuration failed.",
    );
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await runCli(process.argv.slice(2), process.env);
}
