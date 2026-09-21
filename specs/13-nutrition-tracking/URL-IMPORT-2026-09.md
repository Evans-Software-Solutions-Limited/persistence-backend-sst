# Recipe URL recovery — September 2026

Authorised by Brad: support the reported Pip Coaching recipe URL and add a thin AI fallback with a visible review note and safeguards for malicious links. This supersedes the earlier deferral of URL AI extraction.

- Extraction order: Schema.org JSON-LD; clearly labelled HTML ingredients/method; bounded AI text extraction; paste/manual recovery.
- All URL requests use the existing guarded fetch: HTTP(S), public DNS/IP checks, pinned connections, redirect revalidation, response-type/size and time limits. No AI call after a blocked fetch. No model-selected URLs, browser tools, scripts or downloads.
- HTML recovery decodes entities, preserves grouped ingredient order and nested method text, ignores hidden/script/navigation/form content, and declines ambiguous multiple recipes. Only explicit per-serving nutrition is copied.
- AI receives bounded readable page text only, treated as untrusted data. One timed request, no tools or SDK retries. Strict JSON validation and source-grounded strings; no inferred nutrition, servings or quantities. Oversized/truncated/invalid output falls back to manual recovery.
- AI follows existing ai_access entitlement and an atomic per-user daily reservation (12 attempts for /recipes/import). Provider failures still consume a reserved attempt. Metadata/HTML extraction remains available without AI access.
- Review form identifies page-text vs AI extraction, asks the athlete to check contents and never saves automatically. AI provenance is retained as ai_extracted when saved.
- Paste URL reads the clipboard only after an explicit tap, validates HTTP(S), and gives inline empty/invalid/permission feedback.
- The public token-free Pip URL is sufficient to reproduce the original failure. Signed tracking tokens are not copied into fixtures or logs. Live source extraction is checked locally; fixture tests use synthetic recipe text.
