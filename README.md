# Revive Quote Assistant

Standalone mobile web app for commercial renovation, roofing and general contracting estimates. The app guides intake, researches local pricing/material sources, prepares editable costs and saves approved estimates to Revive Portal.

## Start here

- [Architecture and integration contract](ARCHITECTURE.md)
- [Agent handoff and remaining features](docs/HANDOFF.md)
- [VPS deployment, DNS and rollback](docs/DEPLOYMENT.md)
- [Portal repository](https://github.com/SteelCity-ai/revive-project-portal-VPS)

Public origin: https://quote.reviverepairco.com . Production requires an existing Revive Portal administrator account. Check the handoff for current deployment verification.

## Local development

Use Node.js 22.12+ on a normal local filesystem (Google Drive can cause npm errors).

```sh
npm ci
cp .env.example .env.local
# Configure private server credentials in .env.local.
npm run dev
```

Open http://localhost:4178 . The private development API runs on 127.0.0.1:4180. Local development does not require portal login for draft estimating. Production does.

```sh
npm test
npm run build
npm audit --omit=dev --audit-level=high
docker build -t revive-quote-assistant:local .
```

## Estimate lifecycle

1. Answer guided questions; unknown measurements remain visible review items.
2. Build estimate performs AI research and creates editable line items, local-first material suggestions and sourced comparisons.
3. Review quantities, scope, pricing, assumptions, exclusions and terms. All final pricing is subject to staff approval.
4. Approve and save to portal creates an immutable estimate/PDF and a pending project.
5. Record customer acceptance in the portal to activate the same project and create the SOW draft/PDF for existing SOW Intake.

Browser drafts remain on that device. An approved portal save is central, but drafts do not synchronize across devices. JSON export is available; no restore/import UI exists yet. Opening the public URL does not transfer drafts from localhost.

Conversational voice, Google automatic roof measurement, attachments and email/SMS delivery remain pending. Nothing contacts suppliers, sends customer messages or makes purchases automatically.

## Configuration and source

Secrets belong only in server environment files, never VITE-prefixed variables or Git. Production AI routes through private VPS Headroom. See .env.example for configuration names.

Canonical repository: SteelCity-ai/revive-quote-assistant (private).
Local checkout: C:\Users\mike\.codex\workspaces\revive-quote-assistant-repo.
The earlier G:\My Drive\Revive\QuoteAssistant and C: preview directories are historical copies. Use this repository for all new work.
