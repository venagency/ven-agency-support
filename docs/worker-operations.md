# Worker Operations

The Worker is the Ven-controlled gateway for site authorisation, AI chat, and ClickUp task creation.

## Location

```text
cloudflare/ven-support-task-gateway/
```

## Commands

```sh
npm run worker:dev
npm run worker:deploy
npm run worker:types
```

## Required Secrets

- `AUTHORIZED_SITES`
- `CLICKUP_TOKEN`

Set secrets from the Worker directory:

```sh
cd cloudflare/ven-support-task-gateway
npx wrangler secret put AUTHORIZED_SITES
npx wrangler secret put CLICKUP_TOKEN
```

## Runtime Variables

`wrangler.jsonc` includes:

- `CF_AI_MODEL` set to `@cf/google/gemma-4-26b-a4b-it`
- `CLICKUP_API_BASE` set to `https://api.clickup.com/api/v2`

## Health Check

```sh
curl https://ven-support-task-gateway.ven-agency.workers.dev/health
```

Expected response:

```json
{"ok":true}
```

## ClickUp Routing

Use `clickupListId` in each site entry to route tasks to the correct ClickUp list. If a site entry does not include `clickupListId`, the Worker can use `DEFAULT_CLICKUP_LIST_ID` when configured.

## AI Routing

The Worker uses Cloudflare Workers AI when the `AI` binding is available. The fallback path uses the OpenAI Responses API when `OPENAI_API_KEY` is configured.

Do not put provider credentials in WordPress.
