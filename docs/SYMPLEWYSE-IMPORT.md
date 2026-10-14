# Symplewyse estimate intake

Quote Assistant can import a text-based Symplewyse estimate PDF from the home screen. It extracts the estimate number/date, client/contact, client address, project breakdown, notes and total. The client address is a proposed job site, never the contractor header address. Original disclaimers remain reference information for review. Site photos stay in the original PDF.

The import screen lets the administrator correct the site, project type, scope and quantities before creating a preliminary quote. The original total is stored in `quote.sourceImport` and displayed as **Symplewyse estimate price** beside the recommendation. A small reference record is attached to the research report after pricing, so the existing portal approval snapshot retains it. It never creates cost lines, feeds money math, becomes a market source or enters AI research prompts. Currency amounts inside project notes are removed before scope is sent for independent pricing. The existing local material/labor research, market low/mid/high information and deterministic quote arithmetic remain in use.

Roof imports request the existing Google Geocoding/Solar integration at the extracted address. PDF area ranges never become roof measurements. The preview displays the matched address, sloped roof area, imagery date/quality and coverage warning. Administrators must confirm all quoted roof sections or enter a confirmed manual area before pricing a manually imported roof. Google unavailable, partial coverage and missing facts stay visible. Email-generated roof quotes are preliminary and retain an unresolved measurement-confirmation question.

PDF uploads require the current portal ADMIN role in production, the allowed origin and `application/pdf`. Limits: 10 MB, 30 pages, 80,000 extracted characters, one upload at a time and 30 imports per account/hour. A separate worker with a 20-second deadline reads the PDF using PDFium. The uploaded PDF is processed in memory, not publicly served. The real sample is not a committed fixture.

## Incoming email

Target mailbox: **mike@reviverepairco.com**. The implementation is disabled until the mail provider and credentials are configured. Server-only variables are listed in `.env.example`:

- `ESTIMATE_IMAP_HOST`, `ESTIMATE_IMAP_USER`, `ESTIMATE_IMAP_PASSWORD`: provider-supported IMAP access over verified TLS on port 993.
- `ESTIMATE_IMAP_FOLDER`: defaults to `INBOX`; a dedicated estimates folder is preferable for a mixed-use mailbox.
- `ESTIMATE_ALLOWED_SENDERS`: exact verified sender addresses, comma separated.
- `ESTIMATE_INBOX_DIR`: private, persistent directory. Compose uses `/data/estimate-inbox`.

The server polls every 60 seconds, checks sender/recipient and size, and processes up to five PDF attachments per message. Initial connection (or changed UID validity) starts with new messages; it does not import historical mailbox contents. A durable cursor and PDF SHA-256 deduplicate deliveries across restarts. Changed PDFs create a new imported draft, even when the estimate number matches. The worker does not mark messages read, delete them, send email, approve quotes, accept a customer quote or create a portal project.

Eligible attachments create a persistent draft before pricing. Pricing uses the same independent estimate service, defaults of 15% markup/zero configured labor/contingency/tax, the existing Project Fee calculation, a four-minute deadline, one global pricing request at a time and a separate 12/hour email budget. No imported price is passed to that service. Drafts with unavailable Google area wait for manual review. Pricing failures retry up to three times and remain visible in the inbox. Invalid PDFs are skipped and produce a generic service warning; the original message remains in the mailbox for manual upload/correction.

Signed-in administrators use **Check received estimates** on the import screen to open a draft. Copying a priced draft to the device preserves normal manual approval and unresolved questions. Editing its scope/area, or having different device pricing defaults, triggers independent repricing. The inbox is shared by portal administrators; device drafts remain browser-local. Repeat imports of the same PDF are disabled on a device already holding it.

## Release and activation

Create `/docker/revive-quote-assistant/estimate-inbox` privately with ownership matching the container's node user (UID/GID 1000) before deployment; retain it and its backups through releases. Populate mailbox credentials in the root-only shared environment file through a private channel. Confirm the real provider and verified sender address before enabling the worker. Password-authenticated IMAP must be supported by that provider; OAuth-only tenants need an OAuth connection adapter rather than a regular account password.

Run the repository tests/build/production dependency audit and normal staging checks, including anonymous PDF/inbox denial and an authenticated synthetic PDF import. Retain the prior application image. No portal database migration is required. For activation, send one explicitly authorized test estimate to the mailbox, verify one persistent draft and independent price, and redeliver the same PDF to verify deduplication. Google/provider tests and actual email receipt are separate from mocked regression coverage.

## Verification for this change

The user-supplied PDF was read successfully: estimate number/date, client/contact/address, scope including roof coating and penetration ranges, project notes, disclaimers and the total. Mobile browser checks covered 320/375 px without horizontal overflow, editable preview, roof confirmation gating, exclusion of embedded note prices and preservation of the draft after a pricing-service failure. Automated tests cover independent pricing inputs, PDF limits/extraction, import authentication/origins, email eligibility, persistent cursor/drafts, retries and deduplication. No real mailbox access, paid Google/AI call, quote approval or production deployment was performed during these checks.
