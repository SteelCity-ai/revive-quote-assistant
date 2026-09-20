# Integration plan

## Product boundary

The quote assistant is an independent mobile browser app at its own future address. The Revive Project Portal remains the source for shared customer/project records. The quote app must also support new prospects and jobs that have not become portal projects yet.

## Portal

Portal implementation is in `C:\Users\mike\.codex\workspaces\revive-portal-quote-sync`, branch `codex/quote-portal-sync`, based on remote main `fa51149` from `SteelCity-ai/revive-project-portal-VPS`. The live release is pending; see `PORTAL-SYNC.md` and the portal's `docs/QUOTE-ASSISTANT-INTEGRATION.md`.

The server adapter now supports portal administrator login, explicit customer selection, restricted routes, origin checks and idempotent approval. Approval stores an immutable estimate revision/PDF and creates one pending project. Customer acceptance activates that same project and creates the SOW draft/PDF for the existing SOW Intake. The browser receives an opaque session cookie; upstream session credentials stay on the server. Non-localhost login requires HTTPS.

Do not treat localStorage as production storage. Replace it with authenticated persistence while retaining the same quote domain model and adding revision/concurrency control. Include a reviewed local draft migration/import path.

## Automatic roof measurements

1. Address lookup and map: Maps JavaScript API; add Places for autocomplete.
2. User confirms the building and included roof sections.
3. A private server calls Solar API buildingInsights using location and returns a normalized measurement proposal: segment areas, pitches, imagery date/quality, coverage limitations and source.
4. Show returned values for user approval before applying them to the estimate. Preserve footprint vs sloped-area distinction and never apply pitch twice.
5. Offer manual entry when data is unavailable, out of date or unsuitable; implement map tracing as an additional measurement mode.
6. Keep waste a separate user-specified allowance. Google does not establish tear-off layers, concealed damage or material quantities for every detail.

Check current Google permitted uses, attribution and retention terms before persisting or including API-derived content in quotes/PDFs. API coverage and accuracy must be tested against known commercial roofs. Secrets belong in server environment/configuration; public map keys must be restricted by referrer and API.

References: https://developers.google.com/maps/documentation/solar/overview and https://developers.google.com/maps/documentation/solar/reference/rest/v1/buildingInsights/findClosest

## AI pricing research — implemented locally

The private Node API now performs live web research and generates structured priced drafts, material lists and source-linked comparisons. See AI-ESTIMATING.md for implementation and remaining production requirements. Prices remain editable and final quote approval remains manual. Portal integration is implemented locally; its live release is pending.

## Delivery

PDF generation should use a stable approved quote revision. Email and SMS require explicit recipient confirmation, idempotency and delivery records. Approval, document generation and sending remain separate actions. No real message should be sent during implementation tests.
