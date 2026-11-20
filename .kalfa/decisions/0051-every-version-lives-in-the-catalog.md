# Every dependency version lives in the workspace catalog

Every dependency the repo uses gets its version in one place: the catalog in `pnpm-workspace.yaml`. A `package.json` names a dependency with `catalog:`, or `catalog:<name>` for a named catalog such as the one the frozen today's version runs on, and never with a version of its own. So bumping a dependency is one line, and two packages cannot drift onto different versions of the same thing.

## Considered Options

- A version in each `package.json`: rejected, because the same dependency drifts between packages and a bump has to find every copy.

## Consequences

The dependencies still pinned in a `package.json` move into the catalog. A patch in `patchedDependencies` keeps naming the exact version it applies to.

The check stays simple, with no complex tooling to maintain, and any check of ours lives in `@kalfa/quality`. Not decided here: whether pnpm's own catalog setting is enough, or a small rule is needed.
