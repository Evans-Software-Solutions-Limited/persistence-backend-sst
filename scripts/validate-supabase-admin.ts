/** Deployment gate: verify the service credential belongs to the selected project. */
import { getDomainConfig } from "../packages/api-utils/src/domains/domain-config";

type Stage = "production" | "staging";
export function validateAdminConfig(
  stage: string,
  env: Record<string, string | undefined>,
  now = Date.now(),
) {
  if (stage !== "production" && stage !== "staging")
    throw new Error("Expected production or staging.");
  const url = getDomainConfig(stage as Stage).supabaseUrl;
  const ref = new URL(url).hostname.split(".")[0];
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (env.SUPABASE_PROJECT_REF !== ref)
    throw new Error("Supabase project does not match the selected stage.");
  if (!key || /\s/.test(key))
    throw new Error("Missing or invalid SUPABASE_SERVICE_ROLE_KEY.");
  if (!/^sb_secret_[A-Za-z0-9_-]+$/.test(key)) {
    let claims: Record<string, unknown>;
    try {
      const parts = key.split(".");
      if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p)))
        throw new Error();
      claims = JSON.parse(Buffer.from(parts[1]!, "base64url").toString());
      if (!claims || typeof claims !== "object") throw new Error();
    } catch {
      throw new Error("Invalid service-role credential format.");
    }
    if (
      claims.role !== "service_role" ||
      claims.ref !== ref ||
      typeof claims.exp !== "number" ||
      claims.exp * 1000 <= now
    ) {
      throw new Error(
        "Service-role credential has the wrong project, role, or expiry.",
      );
    }
  }
  return { url, key };
}

export async function verifyAdminAccess(
  config: { url: string; key: string },
  request: typeof fetch = fetch,
) {
  // Read one page without logging or retaining customer data. This verifies the
  // signature/revocation and actual admin access; decoding claims alone cannot.
  let response: Response;
  try {
    response = await request(
      `${config.url}/auth/v1/admin/users?page=1&per_page=1`,
      {
        headers: { apikey: config.key, Authorization: `Bearer ${config.key}` },
        signal: AbortSignal.timeout(10_000),
        redirect: "error",
      },
    );
  } catch {
    throw new Error(
      "Supabase admin credential verification could not reach the selected project.",
    );
  }
  await response.body?.cancel();
  if (response.status !== 200)
    throw new Error(
      `Supabase admin credential verification failed (HTTP ${response.status}).`,
    );
}

export async function main(args = process.argv.slice(2), env = process.env) {
  if (args.length !== 1)
    throw new Error("Usage: validate-supabase-admin <production|staging>");
  await verifyAdminAccess(validateAdminConfig(args[0]!, env));
  console.log("Supabase admin credential verified for the selected stage.");
}
if (import.meta.main) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
