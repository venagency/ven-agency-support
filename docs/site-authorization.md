# Site Authorisation

Each WordPress site must be authorised in the Cloudflare Worker before the assistant can appear or send requests.

## WordPress Constants

Add these values to the client host configuration:

```php
define( 'VEN_SUPPORT_GATEWAY_URL', 'https://ven-support-task-gateway.ven-agency.workers.dev' );
define( 'VEN_SUPPORT_SITE_ID', 'tws-ven-com-au' );
define( 'VEN_SUPPORT_SITE_SECRET', getenv( 'VEN_SUPPORT_SITE_SECRET' ) );
```

`VEN_SUPPORT_SITE_SECRET` must be a long random value and must match the Worker's `AUTHORIZED_SITES` entry.

## Worker Secret

`AUTHORIZED_SITES` is a JSON object keyed by site ID:

```json
{
  "tws-ven-com-au": {
    "enabled": true,
    "chatEnabled": true,
    "ticketsEnabled": true,
    "secret": "<site-specific-shared-secret>",
    "allowedOrigins": ["https://tws.ven.com.au"],
    "clickupListId": "901611479405",
    "tags": ["tw-solar"],
    "title": "Ven Support",
    "intro": "Ask Ven for help with this website.",
    "aiModel": "@cf/google/gemma-4-26b-a4b-it",
    "aiInstructions": "You are Ven Agency website support. Keep replies concise and create a support ticket when Ven implementation work is needed."
  }
}
```

## Feature Flags

- `enabled: false` hides the assistant from that site.
- `chatEnabled: false` disables AI chat.
- `ticketsEnabled: false` disables ClickUp task creation.

Feature flag changes are controlled from the Worker secret and do not require a WordPress deployment.
