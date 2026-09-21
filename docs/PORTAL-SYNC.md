# Portal approval and SOW connection

Use **Pricing & connections → Revive Portal account** or the account panel during quote review. Sign in with an existing portal administrator account. Select the matching portal customer, review the estimate, acknowledge its scope and pricing, and choose **Approve & save to portal**.

A successful save stores the estimate PDF and immutable revision in the portal and creates a pending (`PLANNED`) project. A failed request does not show a successful approval. Retry after a lost response uses the same approval ID. **Approve on this device only** remains an explicit local-only alternative and does not create a portal project.

In the portal, **Accept & activate project** records customer acceptance of the exact estimate revision, activates the same pending project, and creates a Scope of Work draft and PDF. The existing project SOW Intake can load this scope and continue through its existing draft-plan and review/import workflow.

On 2026-09-20 the live portal quote endpoints and database tables were verified, including authenticated capabilities. Signing in does not by itself mean quote saving is ready: the app still checks the quote service/storage capability and preserves drafts on failure. Quote Assistant is deployed separately; see HANDOFF.md for DNS/TLS and release status.

Portal source: `SteelCity-ai/revive-project-portal-VPS`; this app: `SteelCity-ai/revive-quote-assistant`. See both repositories' ARCHITECTURE.md files. Newer live portal changes and another team's local work must be reconciled before any portal redeployment. Private credentials remain outside Git; production configuration is in the root-only VPS environment file documented in DEPLOYMENT.md.
