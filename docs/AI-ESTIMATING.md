# AI estimating, sourcing and comparisons

The guided flow now calls the private local estimate API when the user selects **Build estimate**. The result is a priced proposal, not a blank line-item template. Existing quotes can use **Generate with AI**. Regeneration asks before replacing edited prices/assumptions/exclusions; customer answers and terms are retained.

## Research pipeline

1. The Node server validates the job and strips the explicit customer, contact and title fields from the AI payload. The job address, scope, measurements and pricing defaults are necessary for location-based estimating. Free-text notes can still contain identifying information; users should include only relevant job details.
2. Two independent OpenAI Responses requests perform required live `web_search`, prioritizing local suppliers, then online listings. Forums/social media are excluded as pricing evidence. It searches comparable documented projects first, then reputable local/regional cost guidance. No one is contacted.
3. A final structured-output request prepares cost items with supplier details nested beside each material; the server assigns shopping-list indices. Research uses `gpt-4.1` (`OPENAI_MODEL`); estimating uses `gpt-5.4-mini-2026-03-17` (`OPENAI_ESTIMATE_MODEL`). Both are server-only settings.
4. Runtime validation rejects invalid numbers, unrecognized source IDs, missing evidence for claimed listed prices, duplicate labor costing, orphaned/duplicate material mappings and invalid comparison ranges. Forum benchmark URLs are removed defensively.
5. React applies the complete proposal atomically only if the active request and the quote inputs still match. Errors and cancellation leave the existing draft intact. Money arithmetic remains in the app.

Research is AI interpretation, not an independently certified takeoff or supplier bid. Cited pages may change, a local branch does not guarantee inventory, and generic cost guides are not actual competitor quotes. Estimated allowances are explicitly labeled. Unverified benchmarks are omitted, not fabricated. Compare source scope, geography and included costs before relying on a range.

## Material and benchmark behavior

- Each material row references exactly one estimate line, so the shopping list never adds cost a second time. Current line quantities/prices drive the displayed material totals. Deleting a line marks its material row as removed. Source basis and rationale reflect the research snapshot; edits remain the estimator's responsibility.
- Local entries appear before online and unverified entries. Supplier source links are only drawn from returned search citations. The model is instructed to identify products, sellable packages and coverage; packaging and stock may still require confirmation and are shown as limitations.
- Only whole-project documented-project benchmarks enter the displayed comparison range. General cost guides cannot establish a verified full-scope range and are kept as context or component comparisons. Component and contextual benchmarks remain visibly separate. Total-cost benchmarks require a known source project area to convert to cost per square foot. The user's cost per square foot uses affected floor area or roof surface area before waste, never purchased material area.
- AI follow-up questions remain review issues until the user marks them resolved after updating the scope/estimate. Unresolved issues prevent fixed-quote approval. Preliminary estimates can retain clearly disclosed allowances and unknowns.

## Local runtime

`npm.cmd run dev` starts both Vite on 4178 and the private API on loopback 4180. `npm.cmd run api` runs only the API. Node.js 22.12+ is recommended (verified on 24.13.0). The API uses Node's environment-file loader; private credentials are read only from the local `.env.local` or server environment.

The verified key file is `C:\Users\mike\.codex\workspaces\revive-quote-assistant\.env.local`. It stays outside Google Drive and is ignored. Do not put private credentials in VITE-prefixed environment variables. No key is included in the browser bundle, API responses, source copy or test artifacts.

Default OpenAI route: `http://127.0.0.1:8790/v1` through the existing Headroom proxy. Dashboard: http://127.0.0.1:8790/dashboard . A positive configured status means the server found a key; actual provider failures appear during generation.

Development uses Vite's proxy and loopback API. Production uses the compiled frontend and Node server behind Traefik HTTPS, an exact APP_ORIGIN, current portal administrator authentication, JSON/body limits, schema validation, one active estimate at a time, 12 requests per account/hour and a four-minute timeout. It does not retry billed calls automatically. Shared draft storage, distributed session/rate-limit storage and durable AI audit records remain future work; see ARCHITECTURE.md.

On the VPS, requests use `http://100.82.54.127:8877/v1` and explicitly pin `X-Headroom-Base-Url: https://api.openai.com` because the shared Headroom instance defaults to OpenRouter for other apps. A real synthetic estimate passed through this route on 2026-09-20. Production secrets are in the root-only VPS environment file; the C: key file above describes historical local setup, not a file committed to this repository.

OpenAI API usage and web search incur charges on the configured API account. No email/SMS delivery, supplier contact or purchase occurs.

## Official API references

- https://developers.openai.com/api/docs/guides/tools-web-search
- https://developers.openai.com/api/docs/guides/structured-outputs
