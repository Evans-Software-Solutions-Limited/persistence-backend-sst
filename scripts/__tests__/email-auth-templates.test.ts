import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import { describe, expect, it } from "vitest";
import { authEmailDefinitions, buildAuthEmail } from "../email-auth-templates";

describe("Auth email distribution artifacts", () => {
  it.each(authEmailDefinitions)(
    "preserves the usable security action in $key HTML and text",
    async (definition) => {
      const mail = buildAuthEmail(definition, 3600);
      const token = definition.action
        ? "{{ .ConfirmationURL }}"
        : "{{ .Token }}";
      expect(mail.html).toContain(token);
      expect(mail.text).toContain(token);
      if (definition.action)
        expect(mail.html).toContain('href="{{ .ConfirmationURL }}"');
      expect(mail.html).not.toContain("example.invalid");
      expect(mail.html).toContain(
        '/apple-touch-icon.png" width="30" height="30" alt="Persistence logo"',
      );
      expect(mail.html).not.toMatch(
        /<script|<form|<link|@import|founding member|founding-welcome\.gif/i,
      );
      expect(mail.text).toContain("expires in 1 hour.");
      expect(mail.text).toContain("16938357");
      const templates = new URL("../../supabase/templates/", import.meta.url);
      expect(
        await readFile(
          fileURLToPath(new URL(`${definition.key}.html`, templates)),
          "utf8",
        ),
      ).toBe(await format(mail.html, { parser: "html" }));
      expect(
        await readFile(
          fileURLToPath(new URL(`${definition.key}.txt`, templates)),
          "utf8",
        ),
      ).toBe(mail.text + "\n");
    },
  );

  it.each([0, -1, NaN, Infinity, 1.5])(
    "refuses an unusable expiry: %s",
    (expiry) => {
      expect(() => buildAuthEmail(authEmailDefinitions[0], expiry)).toThrow(
        "Auth expiry",
      );
    },
  );

  it.each([
    [7200, "2 hours"],
    [60, "1 minute"],
    [120, "2 minutes"],
    [45, "45 seconds"],
  ])("shows the configured %s-second expiry", (expiry, label) => {
    expect(
      buildAuthEmail(authEmailDefinitions[0], Number(expiry)).text,
    ).toContain(`expires in ${label}.`);
  });
});
