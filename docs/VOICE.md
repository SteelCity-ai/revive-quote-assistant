# Voice ("Talk to Revive")

Implemented with OpenAI Realtime API over WebRTC and an ephemeral client secret. Medium-eagerness semantic VAD, input transcription and a one-shot committed-turn watchdog reduce stalled turns. Strict tools and existing domain validation own all draft mutations; approval remains read-back plus fingerprint-tied confirmation on the idempotent portal path.

## Server configuration

Add to `/docker/revive-quote-assistant/shared/.env` (root, mode 600) on the VPS:

| Variable | Default | Meaning |
| --- | --- | --- |
| (none — reuses) | | `OPENAI_API_KEY` must be present; it is the only secret voice uses. |
| `OPENAI_REALTIME_MODEL` | `gpt-realtime-2.1` | Realtime speech-to-speech model. Verify the API project has access; if the mint call returns 403, choose an available realtime model. |
| `OPENAI_REALTIME_VOICE` | `marin` | Output voice. |
| `OPENAI_REALTIME_TRANSCRIPTION_MODEL` | `gpt-4o-mini-transcribe` | Input transcript used for the visible transcript, Jev routing and pause recovery. |
| `OPENAI_REALTIME_BASE_URL` | `https://api.openai.com/v1` | Mint endpoint base. Headroom cannot serve this route (404, verified 2026-09-21); leave the default unless Headroom adds realtime support. |
| `TYPESAFE_API_KEY` | unset | Optional server-only key that enables Jev voice intent/confidence routing. |
| `TYPESAFE_MODEL` | `jev-1.13.0` | Pinned TypeSafe model; calibrate before changing. |
| `TYPESAFE_VOICE_CONFIDENCE` | `0.65` | Minimum confidence for a reliable recovery hint. |

`/api/app/config` exposes `voiceAvailable` and `jevAvailable`. The frontend hides Talk to Revive without OpenAI; Jev remains optional and fails open to the existing voice path.

## Runtime routes

- `POST /api/voice/session` — exact-origin + JSON checks, production portal ADMIN session, 12 sessions/identity/hour, mints `{clientSecret, model, webRtcUrl}`. Errors are sanitized.
- `POST /api/voice/decision` — exact-origin + JSON checks, production portal identity, 240 short turns/identity/hour, sends a bounded transcript/current-question/pause state to TypeSafe and returns a closed-set intent with confidence. No transcript is logged by this app.
- The browser then exchanges its SDP offer directly with `https://api.openai.com/v1/realtime/calls` (production CSP `connect-src` allows this origin).

## Session behavior

- States surfaced in the UI: listening, speaking (Revive), thinking, paused, ended, microphone-denied, disconnected, error — each with recovery (retry, reconnect, or typed fallback that continues the same conversation).
- Barge-in: `interrupt_response: true`; user speech during a spoken answer is a new turn.
- Pause recovery: if a committed audio turn produces no `response.created` within 4.5 seconds, the client sends one recovery `response.create`. A reliable Jev result may be included as a routing hint; low confidence asks for clarification. Timers are cancelled when a response starts or the session pauses, ends, disconnects or closes.
- Commands: repeat that / go back / correction / pause / resume / I don't know / build the estimate / read it back / approve — mapped to deterministic tools; unrecognized answers are re-asked with the allowed options; silence never invents an answer.
- Every fourth recorded answer creates a deterministic recap gate. No additional intake command runs until the user confirms the recap or selects a field to correct.
- Google roof measurement is a pending proposal. It changes no answer until the user explicitly confirms the building and included roof sections; confirmation records measured sloped roof area and removes stale pitch input.
- Approval: `prepare_approval` returns the verbatim read-back (customer, total, assumptions, exclusions, flags) and a revision fingerprint; `confirm_approval` must echo that fingerprint of the unchanged quote. The save records the verbal acknowledgment, keeps the same `approvalId` across retries, and requires the portal receipt. Nothing is emailed, texted or accepted; customer acceptance stays a portal action.

## Verification status

Verified by tests and headless Chromium (see HANDOFF): answer extraction/normalization, question sequencing including conditional roofing branches, interrupted turns, pause/resume, approval gates, fingerprint mismatch and edit-after-read-back rejection, duplicate function-call suppression, synchronized post-answer context, duplicate approval-id stability, route auth/origin/rate-limit/sanitization, 390px/320px layout without horizontal overflow, and the graceful error card when a connection fails. The production server successfully minted a short-lived `gpt-realtime-2.1` client secret on 2026-09-21.

The owner reported successful basic voice use on physical Android and iPhone on 2026-09-23. The prior build sometimes stalled after an answer; medium VAD and the watchdog address that defect but still require a repeat device test. Bluetooth behavior, speaker/earpiece switching, cellular loss, screen-lock/background suspension, long sessions, recap correction, Google confirmation and revision-tied approval on a real quote remain unverified. Do not describe wake-word, locked-screen or fully hands-free driving use as supported.
