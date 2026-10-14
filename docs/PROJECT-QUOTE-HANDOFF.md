# Existing-project quoting — 2026-10-13

The portal can open Quote Assistant with ?projectId=<uuid>. After the existing sign-in gate, the app reads the project and its matching active customer through the authenticated bridge, preloads customer/title/address/scope, and starts a general-contracting intake. Nothing is written to the portal until the administrator approves.

The approval panel also offers eligible projects for the selected customer, or the existing create-pending-project option. The optional projectId participates in the approval fingerprint and POST body. Changing it invalidates the retry identity; unchanged retries retain their approvalId. Project selectors remain locked after a confirmed save.

The bridge adds only GET projects and GET projects/:uuid. It validates the current administrator session for both and refuses project writes or arbitrary targets. The portal remains responsible for matching customer/project ownership, quote storage, price calculation, acceptance and SOW.

Before an existing-project approval, the bridge requires the portal's projectLinking capability. An older portal returns a clear conflict without receiving the write, preventing it from silently creating a duplicate job.

Depends on the companion portal all-work quote change. Existing-project acceptance preserves ACTIVE/ON_HOLD states and activates only PLANNED projects. No customer acceptance, outreach, external sending, purchase or deployment is automated.

Validation: 121 tests pass, including project request authorization and refusal of project writes, plus approval fingerprint/retry behavior. TypeScript/Vite production build passes. A synthetic 390px browser check confirms customer/address/project prefill with no horizontal overflow. No production session, quote save or deployment was performed.
