# Release Process

The MU connector and legacy WordPress plugin use GitHub Releases for delivery.

## Version Bump

Update all of these for a release:

- connector header `Version`,
- plugin header `Version`,
- `Ven_Agency_Support::VERSION`,
- `package.json` version,
- `readme.txt` stable tag,
- `readme.txt` changelog.

## Validation

Run:

```sh
npm run lint
```

Build the ZIPs locally when needed:

```sh
npm run connector:zip
npm run plugin:zip
```

## Publish

```sh
git add wordpress ven-agency-support/ven-agency-support.php readme.txt README.md docs package.json package-lock.json cloudflare .wp-env.json .github
git commit -m "Describe release change"
git push origin main
gh release create v1.4.0 ven-support-connector.zip ven-agency-support.zip --repo venagency/ven-agency-support --title "Ven Agency Support 1.4.0" --notes "Release notes"
```

The release workflow also builds and attaches `ven-support-connector.zip` and `ven-agency-support.zip` when a GitHub release is published.

## Client Updates

New Ven-managed WordPress sites should receive the MU connector through Ven deployment automation. Existing legacy plugin sites check GitHub Releases through the plugin updater; the update appears on the WordPress Plugins screen when WordPress refreshes plugin update data.
