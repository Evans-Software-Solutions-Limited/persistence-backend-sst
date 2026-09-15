/** Replace, never trust, the private source header at the Lambda boundary. */
export function trustedSourceHeaders<
  T extends {
    headers?: Record<string, string | string[] | undefined>;
    multiValueHeaders?: Record<string, string[] | undefined>;
    requestContext?: unknown;
  },
>(event: T): T & { headers: Record<string, string | string[] | undefined> } {
  const safeHeaders = <V>(headers: Record<string, V>) =>
    Object.fromEntries(
      Object.entries(headers).filter(
        ([key]) => key.toLowerCase() !== "x-persistence-source-ip",
      ),
    );
  const context = event.requestContext as
    | { http?: { sourceIp?: string }; identity?: { sourceIp?: string } }
    | undefined;
  return {
    ...event,
    headers: {
      ...safeHeaders(event.headers ?? {}),
      "x-persistence-source-ip":
        context?.http?.sourceIp ?? context?.identity?.sourceIp ?? "unknown",
    },
    ...(event.multiValueHeaders
      ? { multiValueHeaders: safeHeaders(event.multiValueHeaders) }
      : {}),
  };
}
