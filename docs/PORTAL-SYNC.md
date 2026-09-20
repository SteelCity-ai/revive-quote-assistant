# Portal approval and SOW connection

Use **Pricing & connections → Revive Portal account** or the account panel during quote review. Sign in with an existing portal administrator account. Select the matching portal customer, review the estimate, acknowledge its scope and pricing, and choose **Approve & save to portal**.

A successful save stores the estimate PDF and immutable revision in the portal and creates a pending (`PLANNED`) project. A failed request does not show a successful approval. Retry after a lost response uses the same approval ID. **Approve on this device only** remains an explicit local-only alternative and does not create a portal project.

In the portal, **Accept & activate project** records customer acceptance of the exact estimate revision, activates the same pending project, and creates a Scope of Work draft and PDF. The existing project SOW Intake can load this scope and continue through its existing draft-plan and review/import workflow.

The local bridge code is installed, but the live portal quote endpoints and database migration are not deployed yet. Signing in does not by itself mean quote saving is ready: the connection checks the quote service/storage capability. Until deployment, the app reports that quote saving is unavailable and preserves local drafts.

Portal implementation and verification: `C:\Users\mike\.codex\workspaces\revive-portal-quote-sync\docs\QUOTE-ASSISTANT-INTEGRATION.md`. The newer portal implementation is in that isolated worktree, not the older Google Drive portal checkout. No portal password or session is stored in this folder; the OpenAI key remains only in the private C: runtime.
