# For fabrikaa: slice 8 question

Version: our tooling. Slice 8 of `docs/plan/quests/rules-and-records-build-PLAN.md`, the new
`@kalfa/records`. Pull request https://github.com/kamp-us/tea-fabrika/pull/1634, branch
`fabrikalfa/records-checks`, head 1b24c68f0.

**The question: who adds `@kalfa/records` as a dependency of the root `package.json`, and when?**

- `pnpm lint:reach` (`oxlint-plugins/workspace-reach.ts`, decision 0003) fails on the branch:
  `kalfa/records (@kalfa/records): no app, tool or root reaches it`. A package is reached only when
  the root `package.json` or a reached package names it as a dependency.
- The plan gives the root `package.json` to slice 9 alone (one entry in the `lint` script), and the
  slice 8 brief says not to touch it. So the PR cannot be green as the plan stands.
- The fix is one line, `"@kalfa/records": "workspace:*"` in the root `devDependencies` (the root
  `lint` script is what runs `kalfa/records/src/bin.ts`), plus the lockfile's root importer, which
  slice 8 already changes.

Options:

1. Slice 8 adds that one devDependency line (and the lockfile line). Slice 9 then changes only the
   `lint` script, a different line of the same file. This is my lean: the edge that makes the
   package reached belongs with the package, and the two lines do not touch.
2. Slice 8 waits, red on `lint:reach`, until slice 9 lands both lines; slice 9 then depends on
   slice 8 being merged with a red check, which the merge rule does not allow.
3. `.github/ci/package.json` names it instead, as it names `@kalfa/quality`. Nothing in `.github/ci`
   imports it, so that would be a false edge.

Two measured hits that may be false alarms, for the plan's rule that a hit which is not a real
patch removes its phrasing before slice 9 (not changed in slice 8):

- `.decisions/0227-saved-state-carries-shape-number.md:39`: "carried / forward" across a line
  break, plain English, found once the patch check reads blocks.
- `.decisions/0603-no-stacks-and-sev0-admin-merges.md:38`: "the rest holds in a sev0, for now", in
  a Context sentence.
