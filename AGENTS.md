# Agent handoff rules

Read `ARCHITECTURE.md`, `docs/HANDOFF.md` and `docs/DEPLOYMENT.md` first. This repository owns Quote Assistant. Portal APIs/data belong to `SteelCity-ai/revive-project-portal-VPS`.

- Preserve existing edits; inspect branch/status before changes. Record exact commit, pushed state and deployed state separately.
- Never commit `.env` files, private keys, real session cookies, customer fixtures or generated real quotes. Use `.env.example` names only.
- Production AI calls must require a current portal ADMIN session, exact allowed origin, and usage limits. Route AI through configured Headroom.
- Keep deterministic money math, explicit allowances, source dates, manual review and idempotent approvals. Do not fabricate prices, measurements or successful saves.
- No automatic outreach, document sending, purchasing or customer acceptance.
- Run relevant tests/build; add meaningful regression coverage for auth, money and state changes. Verify mobile layout for UI work.
- Voice and Google roof measurement are pending. Do not describe them as working based on design notes or mocked tests.
- Deploy only with authorization, a verified image, staging smoke checks and a retained rollback image. Never alter the portal database merely to deploy this app.
