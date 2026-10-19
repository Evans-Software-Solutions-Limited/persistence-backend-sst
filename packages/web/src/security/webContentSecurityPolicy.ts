/** Fixed browser destinations used by the deployed web app. */
export function webConnectSrcOrigins(supabaseOrigin: string): string[] {
  return [
    "'self'",
    supabaseOrigin,
    "https://itunes.apple.com",
    "https://www.facebook.com",
    "https://connect.facebook.net",
    "https://challenges.cloudflare.com",
    // Tradedoubler conversion beacons (PER-3, Blue Light Card offer).
    "https://tbs.tradedoubler.com",
  ];
}
