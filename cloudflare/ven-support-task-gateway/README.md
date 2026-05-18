# Ven Support Task Gateway

Cloudflare Worker for the Ven Agency Support WordPress plugin.

The Worker verifies authorised WordPress sites, controls remote feature flags, calls Workers AI for support chat, and creates ClickUp tasks for support requests.

## Local Development

```sh
npx wrangler dev
```

## Deploy

```sh
npx wrangler deploy
```

## Required Secrets

```sh
npx wrangler secret put AUTHORIZED_SITES
npx wrangler secret put CLICKUP_TOKEN
```

## Endpoints

- `GET /health`
- `POST /site-config`
- `POST /chat`
- `POST /support-task`

All `POST` endpoints require signed WordPress plugin requests.
