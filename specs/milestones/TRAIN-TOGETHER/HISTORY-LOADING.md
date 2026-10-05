# Own history hydration for local Together

Approved PR #486 follow-up: use the authenticated own-history API to refresh
only the active workout's non-skipped exercises before its original start.
Both cached and refreshed sharing filter against the current non-skipped exercise
IDs immediately before publication; skipping during a fetch cannot re-share that
exercise or block the remaining PREV rows. Local admission,
logging and cached PREV never wait for internet. Cloud authority is unchanged.

`GET /sessions/recent-sets` keeps its existing unfiltered contract and accepts
optional bounded exercise IDs and an ISO `before` timestamp. Filtering precedes
latest-per-set selection. JWT ownership remains mandatory; no recipient or
owner ID supplied by the caller grants access to another athlete's history.

Local hosting/joining warms the owner's cache in the background. Explicit PREV
consent publishes available cached rows immediately and may then publish refreshed
rows for the same still-current grant. Account, workout, lifecycle or consent
changes invalidate late responses. Cache merging never replaces newer local
entries with older API history. Missing cached history remains unavailable when
offline; it never becomes fabricated zero values. Retrospective responses older
than the latest cache entry may be shared for that original-start window without
replacing the latest personal cache. No automatic cloud/local authority switch.

Validation covers authenticated filters, original-start SQL bounds, relevant
exercise selection, offline failure, newer offline rows, account/workout races,
and consent revocation while hydration is outstanding. No native build required.
