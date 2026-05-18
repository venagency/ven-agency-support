# Security Model

The support assistant is designed so client WordPress websites can ask for help without receiving Ven Agency's ClickUp or AI credentials.

## Trust Boundary

WordPress is trusted to:

- confirm the user is logged in,
- check WordPress capabilities,
- collect form data,
- store uploads,
- sign requests with the site secret,
- create temporary access only when an administrator asks for it.

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

Temporary access is created only when an administrator ticks the access checkbox in the support request flow.

The plugin creates or refreshes a named Ven support user and includes a short-lived one-time login link in the ClickUp task. The plugin does not email the site administrator when this happens.

## AI Tooling

The assistant must not directly execute arbitrary code or mutate WordPress content without a narrow approved endpoint.

Current tools only return suggested actions:

- open an admin screen,
- propose a content change,
- prepare a support request draft.

Future mutating tools must include:

- WordPress capability checks,
- signed requests,
- user confirmation,
- target-specific validation,
- audit trail,
- rollback path where WordPress revisions support it.
