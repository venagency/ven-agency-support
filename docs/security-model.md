# Security Model

The support assistant is designed so client WordPress websites can ask for help without receiving Ven Agency's ClickUp or AI credentials.

## Trust Boundary

WordPress is trusted to:

- confirm the user is logged in,
- check WordPress capabilities,
- pass safe admin context to the gateway,
- sign requests with the site secret.

Cloudflare is trusted to:

- verify site identity,
- enforce feature flags,
- hold ClickUp and AI credentials,
- call Workers AI or the fallback AI provider,
- create ClickUp tasks.

## Request Signing

The plugin signs requests with:

```text
HMAC-SHA256(timestamp.body)
```

The Worker rejects requests when:

- site ID is missing,
- timestamp is missing or outside the allowed clock skew,
- signature is invalid,
- site origin is not in `allowedOrigins`,
- the site is disabled.

## Temporary Access

Temporary access is not granted by the chat assistant. Any future temporary-access flow must remain explicit, administrator-approved, and capability-gated.

## AI Tooling

The assistant must not directly execute arbitrary code or mutate WordPress content without a narrow approved endpoint.

Current tools can:

- open an admin screen,
- propose a content change,
- create a ClickUp support task when the AI determines Ven team follow-up is needed.

Future mutating tools must include:

- WordPress capability checks,
- signed requests,
- user confirmation,
- target-specific validation,
- audit trail,
- rollback path where WordPress revisions support it.
