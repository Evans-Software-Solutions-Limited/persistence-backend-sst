import { AuthCallbackContainer } from "@/ui/containers/AuthCallbackContainer";

/**
 * /auth/callback — target of the `persistencemobile://auth/callback` deep link
 * (Supabase email-confirmation / password-recovery / OAuth redirect, forwarded
 * from the web callback page). `app/+native-intent.ts` rewrites the incoming
 * custom-scheme link onto this route; the container reads the token fragment
 * off the raw launch URL and establishes the session.
 */
export default function AuthCallbackScreen() {
  return <AuthCallbackContainer />;
}
