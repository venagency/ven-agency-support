# Release Process

The WordPress plugin uses GitHub Releases for update delivery.

## Version Bump

Update all of these for a plugin release:

- plugin header `Version`,
- `Ven_Agency_Support::VERSION`,
- `readme.txt` stable tag,
- `readme.txt` changelog.

## Validation

Run:

```sh
npm run plugin:lint
```

Build the ZIP locally when needed:

```sh
npm run plugin:zip
```

## Publish

```sh
git add ven-agency-support/ven-agency-support.php readme.txt README.md docs package.json cloudflare
git commit -m "Describe release change"
git push origin main
gh release create v1.3.4 ven-agency-support.zip --repo venagency/ven-agency-support --title "Ven Agency Support 1.3.4" --notes "Release notes"
```

The release workflow also builds and attaches `ven-agency-support.zip` when a GitHub release is published.

## Client Updates

Client WordPress sites check GitHub Releases through the plugin updater. The update appears on the WordPress Plugins screen when WordPress refreshes plugin update data.
