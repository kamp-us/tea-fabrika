# @kalfa/ci

Our CI's shared rules. So far it holds one module, `src/DocsOnly.ts`: the docs-only classifier. It
says what kind of change each repo-relative path is: `code` when a program or a test reads it,
`instructions` when an agent reads it as its instructions (skill prose, `AGENTS.md`, `CLAUDE.md`, an
agent's definition), and `docs` for a field row or for Markdown that nothing reads. Decisions 0183,
0180 and 0090 say why.

Three users read it, and must agree:

- `.github/ci/changes.mjs`, the changes job's classifier, which skips the heavy jobs on a docs-only
  change (`check.yaml` links this package before it runs).
- `.agents/skills/lead/scripts/pr/Arm.ts`, which arms a docs-only pull request on its automatic check.
- `.agents/skills/lead/scripts/pr/Merge.ts`, the admin merge, which takes only `isAdminDocs`: the `docs` kind in `.decisions/`, `docs/`, `field/`, `.glossary/` or `.runbooks/` (decision 0183).

The package imports nothing and has no dependencies, so CI can run it before any install. Its laws are
in `src/DocsOnly.test.ts`, and the table every tool's law reads is `src/DocsOnly.test-support.ts`.
