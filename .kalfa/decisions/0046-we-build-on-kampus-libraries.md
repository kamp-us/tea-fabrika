# We build on kampus libraries and contribute our fixes back

fabrika builds its programs on tea and its UI on Manti. When tea or Manti falls short of what our work needs, we patch our installed copy with `pnpm patch` and keep building, and we file the same change upstream the same day, because a fix we keep only for ourselves helps nobody else and drifts on each release.

## Considered Options

- Waiting for upstream's release: rejected, because a release is someone else's schedule and our own work should not wait on it.
- A wrapper of our own over Manti: rejected, because it would work around Manti.

## Consequences

The pull request that bumps to the version with the fix deletes the patch. Each patch is re-applied on every install and can break on a version bump; pnpm fails the install when a patch no longer applies, so the break is loud. A pull request to Manti brings evidence from the patch and asks the owner first. Manti is 0.x, so a minor can break: the catalog pins it exact, and the bundle cost is the one real price.
