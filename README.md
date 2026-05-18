# Ven Agency Support

Ven Agency Support adds a remotely controlled support assistant to authorised WordPress websites.

The plugin is intentionally thin. WordPress handles permissions, the admin UI, signed requests, uploads, and temporary access grants. Ven-controlled Cloudflare infrastructure handles site authorisation, AI responses, feature flags, and support task routing.

## Installation

Install the release zip from GitHub, then activate **Ven Agency Support** in WordPress.

Configure the site with constants in `wp-config.php` or host environment variables:

```php
define( 'VEN_SUPPORT_GATEWAY_URL', 'https://ven-support-task-gateway.ven-agency.workers.dev' );
define( 'VEN_SUPPORT_SITE_ID', 'client-site-id' );
define( 'VEN_SUPPORT_SITE_SECRET', 'client-site-secret' );
```

The site ID and secret must match the authorised site entry in the Ven support gateway.

Legacy `TW_SOLAR_SUPPORT_*` constants are still supported so existing installs can migrate without breaking.

## Releases And Updates

WordPress checks GitHub Releases for new plugin versions. To ship an update:

1. Update the plugin header version and `Ven_Agency_Support::VERSION`.
2. Commit and push the change.
3. Create a GitHub release tag such as `v1.2.3`.
4. The release workflow builds `ven-agency-support.zip` and attaches it to the release.

Client WordPress sites will show the update in **Plugins** once WordPress next checks plugin updates.

## Security Model

- Client sites must be authorised by site ID, shared secret, timestamp, signature, and origin.
- ClickUp and AI credentials stay outside WordPress.
- Temporary support access is granted only from the support form by an administrator.
- AI tool calls are rendered as suggested actions unless a future approved action endpoint explicitly applies a change.

## Development

Lint the plugin file with PHP before releasing:

```sh
php -l ven-agency-support/ven-agency-support.php
```

Build a release zip locally:

```sh
rm -f ven-agency-support.zip
zip -r ven-agency-support.zip ven-agency-support -x '*.DS_Store'
```
