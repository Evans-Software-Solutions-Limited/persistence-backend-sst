/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    const stage = input?.stage ?? "dev";
    return {
      name: "persistence-api",
      removal: stage === "production" ? "retain" : "remove",
      protect: stage === "production",
      home: "aws",
      providers: {
        aws: {
          defaultTags: {
            tags: {
              App: "persistence-api",
              Stage: stage,
            },
          },
        },
      },
    };
  },
  async run() {
    const api = await import("./infra/api");
    const web = await import("./infra/web");
    // SES email + SMTP creds. Self-guards: `email` is `undefined` on dev /
    // personal stages (no hosted zone), so nothing is provisioned there.
    const { email } = await import("./infra/email");
    return {
      api: api.coreAPI.url,
      web: $dev ? "http://localhost:5173" : web.frontend.url,
      // Non-secret SMTP config for the Supabase dashboard step. The password
      // is deliberately NOT an output — read it from SSM (SecureString):
      //   aws ssm get-parameter --with-decryption --region eu-west-2 \
      //     --name /persistence/<stage>/ses/smtp-password
      ...(email
        ? {
            emailSmtpHost: email.smtpHost,
            emailSmtpPort: email.smtpPort,
            emailSmtpUsername: email.smtpUsername,
            emailSender: email.sender,
            emailSenderName: email.senderName,
            emailSmtpUsernameParam: email.smtpUsernameParam,
            emailSmtpPasswordParam: email.smtpPasswordParam,
          }
        : {}),
    };
  },
});
