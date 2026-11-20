# We own the kampus libraries we build on, and contribute our fixes back

fabrika and kalfa build their programs on tea and their UI on Manti. These are kampus libraries, and we own every piece of them: no part of tea or Manti is someone else's to wait on. Every contributor to kalfa, fabrika and libfabrika works this way. When tea or Manti falls short of what our work needs, we patch our installed copy with `pnpm patch` and keep building. The same day, we open an issue upstream with the patch attached, so the change can land there. A fix we keep only for ourselves helps nobody else and drifts on each release.

## Considered Options

- Waiting for upstream's release: rejected, because our own work should not wait on a release.
- A wrapper of our own over tea or Manti: rejected, because it would work around the library instead of fixing it.

## Consequences

The pull request that bumps to the version with the fix deletes the patch. Each patch is re-applied on every install and can break on a version bump; pnpm fails the install when a patch no longer applies, so the break is loud. A change to Manti brings evidence from the patch and asks the owner first. Manti is 0.x, so a minor can break: the catalog pins it exact, and the bundle cost is the one real price.
