# Security Model

The support assistant is designed so client WordPress websites can ask for help without receiving Ven Agency's ClickUp or AI credentials.

## Trust Boundary

WordPress is trusted to:

- confirm the user is logged in,
- check WordPress capabilities,
- load the Cloudflare-hosted widget only when the site is authorised,
- expose narrow same-site REST endpoints to the widget,
- pass safe page/admin context and sanitized visible screen context to the gateway,
- sign gateway requests with the site secret.

Cloudflare is trusted to:

- verify site identity,
- enforce feature flags,
- serve the public `/widget.js` interface,
- hold ClickUp and AI credentials,
- call Workers AI or the fallback AI provider,
- create ClickUp tasks.

The browser widget is trusted only as a user interface. It never receives the site shared secret, ClickUp token, AI provider key, or unrestricted WordPress credentials.

## Request Signing

The connector signs gateway requests with:

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

Temporary access is not granted by the connector chat assistant. Any future temporary-access flow must remain explicit, administrator-approved, and capability-gated.

## AI Tooling

The assistant must not directly execute arbitrary code or mutate WordPress content without a narrow approved endpoint.

Current tools can:

- open an admin screen,
- navigate the current browser to a same-site WordPress admin or frontend path,
- annotate a visible screen element from sanitized screen context,
- propose a content change,
- prepare confirmed post/page title, content, or excerpt updates,
- create a ClickUp support task when the AI determines Ven team follow-up is needed.

Post/page updates are applied only by WordPress after a user clicks the confirmation button and passes `edit_post` capability checks through the connector. The Worker never receives WordPress write credentials.

Future mutating tools must include:

- WordPress capability checks,
- signed requests,
- user confirmation,
- target-specific validation,
- audit trail,
- rollback path where WordPress revisions support it.
