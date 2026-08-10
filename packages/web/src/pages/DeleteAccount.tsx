import { Link } from "react-router";
import { MarketingLayout } from "@/marketing/MarketingLayout";
import { useSeo } from "@/marketing/seo";

export function DeleteAccount() {
  useSeo({
    title: "Delete Your Account — Persistence",
    description:
      "How to request deletion of your Persistence account and what to do if you cannot sign in.",
    path: "/delete-account",
  });

  return (
    <MarketingLayout>
      <section className="legal">
        <span className="kicker c-accent legal-kicker">Account</span>
        <h1>Delete your account</h1>

        <p>
          This page explains how to request deletion of your Persistence account
          and associated personal data.
        </p>

        <h2>If you can sign in</h2>
        <p>
          Open Profile in the Persistence app and select Delete account. Your
          account is deactivated immediately and scheduled for permanent
          deletion 30 days later. During that 30-day window, you can cancel the
          deletion by signing back in and confirming when prompted.
        </p>

        <h2>If you cannot sign in</h2>
        <p>
          Email{" "}
          <a href="mailto:admin@evans-software-solutions.com">
            admin@evans-software-solutions.com
          </a>{" "}
          from the email address on your account. Include that account email in
          your message. We may need to confirm your identity before deleting the
          account.
        </p>

        <h2>What gets deleted</h2>
        <p>
          Your account and its associated personal data are permanently deleted
          when the deletion window ends. See our{" "}
          <Link to="/privacy">Privacy Policy</Link> for full details, including
          any information we may need to retain.
        </p>

        <p>
          For anything else, visit our <Link to="/support">Support page</Link>.
        </p>
      </section>
    </MarketingLayout>
  );
}

export default DeleteAccount;
