# Voice ("Talk to Revive")

Implemented on `feat/voice-conversation` (2026-09-21). Transport: OpenAI Realtime API over WebRTC with an ephemeral client secret; turn detection `semantic_vad`; strict function tools; all answers validated by the existing domain model before they reach the draft; approval is read-back + fingerprint-tied confirmation on the idempotent portal path.

## Server configuration

Add to `/docker/revive-quote-assistant/shared/.env` (root, mode 600) on the VPS:

| Variable | Default | Meaning |
| --- | --- | --- |
| (none — reuses) | | `OPENAI_API_KEY` must be present; it is the only secret voice uses. |
| `OPENAI_REALTIME_MODEL` | `gpt-realtime-2.1` | Realtime speech-to-speech model. Verify the API project has access; if the mint call returns 403, choose an available realtime model. |
| `OPENAI_REALTIME_VOICE` | `marin` | Output voice. |
| `OPENAI_REALTIME_BASE_URL` | `https://api.openai.com/v1` | Mint endpoint base. Headroom cannot serve this route (404, verified 2026-09-21); leave the default unless Headroom adds realtime support. |

`/api/app/config` exposes `voiceAvailable: !!OPENAI_API_KEY`; the frontend hides the Talk to Revive button when false.

## Runtime routes

- `POST /api/voice/session` — exact-origin + JSON checks, production portal ADMIN session, 12 sessions/identity/hour, mints `{clientSecret, model, webRtcUrl}`. Errors are sanitized.
- The browser then exchanges its SDP offer directly with `https://api.openai.com/v1/realtime/calls` (production CSP `connect-src` allows this origin).

## Session behavior

- States surfaced in the UI: listening, speaking (Revive), thinking, paused, ended, microphone-denied, disconnected, error — each with recovery (retry, reconnect, or typed fallback that continues the same conversation).
- Barge-in: `interrupt_response: true`; user speech during a spoken answer is a new turn.
- Commands: repeat that / go back / correction / pause / resume / I don't know / build the estimate / read it back / approve — mapped to deterministic tools; unrecognized answers are re-asked with the allowed options; silence never invents an answer.
- Approval: `prepare_approval` returns the verbatim read-back (customer, total, assumptions, exclusions, flags) and a revision fingerprint; `confirm_approval` must echo that fingerprint of the unchanged quote. The save records the verbal acknowledgment, keeps the same `approvalId` across retries, and requires the portal receipt. Nothing is emailed, texted or accepted; customer acceptance stays a portal action.

## Verification status

Verified by tests and headless Chromium (see HANDOFF): answer extraction/normalization, question sequencing including conditional roofing branches, interrupted turns, pause/resume, approval gates, fingerprint mismatch and edit-after-read-back rejection, duplicate function-call suppression, synchronized post-answer context, duplicate approval-id stability, route auth/origin/rate-limit/sanitization, 390px/320px layout without horizontal overflow, and the graceful error card when a connection fails. The production server successfully minted a short-lived `gpt-realtime-2.1` client secret on 2026-09-21.

**Not yet verified (requires real devices and an authenticated portal administrator):** a complete realtime conversation and quote on physical iPhone/Android devices, microphone and Bluetooth behavior, speaker/earpiece switching, network loss mid-session on cellular, screen-lock/background suspension, and real-user quote completion. Do not describe hands-free use, background wake words or use while driving/locked as supported until those are tested.
