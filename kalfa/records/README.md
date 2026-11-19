# @kalfa/records

Two checks on our records, in our tooling
(). The package is private. It imports
no product code, and it reads the repo it is run in.

```text
$ node kalfa/records/src/bin.ts check
AGENTS.md  231 lines, over 200.
  A shorter map is followed better: move text to its home (advice)
1 advice
```

Each finding starts with its place and may go on in indented lines that say what to do instead. The
last line is the count, with only the parts that are not zero: "3 findings, 1 advice", "3 findings"
or "1 advice". With nothing to say, nothing is printed and the exit code is 0. A runbook finding makes
the exit code 1. A map finding is advice: its last line ends in "(advice)" and it never fails the
command.

## The checks

| Check | What it finds |
|---|---|
| `map` (advice) | A tracked `AGENTS.md`, the root or one folder down, with more than 200 lines. The 200 is `maxLines` in `MapSize.ts`: Claude Code's memory guide says to keep each file "under 200 lines per file" ([memory](https://code.claude.com/docs/en/memory)). Lines count as `wc -l` counts them. A constant, not a setting. |
| `runbook` | Runs only by its name, and `pnpm lint` runs it: each tracked `.runbooks/*.md` has a `summary`, each `.runbooks/sev-*.md` has the level-two headings Trigger, Roles, Steps, Exit and Comms, and `.agents/skills/sev/SKILL.md` links every sev runbook and none that is not there. |

Markdown is read by micromark into mdast (`mdast-util-from-markdown` with GitHub's tables), so a
link's text may wrap and a table cell is its own block.

## The command

```text
node kalfa/records/src/bin.ts check            the map check, exit 1 if a finding fails
node kalfa/records/src/bin.ts check runbook    one check by name: map or runbook
```

Run it in the repo's root: the tracked files come from `git ls-files -s` in the working folder.
`@kalfa/records/cli` exports the `effect/cli` command, and `"kalfa": { "cli": "./cli" }` in
`package.json` lets a `kalfa` command find it, as `@kalfa/quality` does. `src/bin.ts` is the edge that
runs it with Node's file system and git.

## Public modules

`Finding` (the one union of the checks' findings) and `cli`. The other files are private: `MapSize`,
`Runbooks`, `Markdown` and `Frontmatter` hold the checks and what they read, and `Tracked` is the service
behind `git ls-files`, so no law starts git and a law hands in a list.
