# @kalfa/records

The checks on our records ([0605](../../.decisions/0605-no-record-patches-another.md) to
[0607](../../.decisions/0607-every-link-lands-on-a-live-record.md)), and advice on the size of the
map, in our tooling
([0585](../../.decisions/0585-kalfa-is-six-domain-packages.md)). The package is private. It imports
no product code, and it reads the repo it is run in.

```text
$ node kalfa/records/src/bin.ts check
.decisions/0534-x.md:4  `amended-in-part by [0539](0539-y.md)` is not what a decision's frontmatter holds.
  The id is the file's number, and the status is `accepted`, or `superseded` with `successor: "NNNN"` ... (0606).
docs/plan/README.md:300  links 0146, which is superseded.
  Link 0162, or the rule's home (0607).
AGENTS.md  231 lines, over 200.
  A shorter map is followed better: move text to its home (advice)
2 findings, 1 advice
```

Each finding starts with its place and may go on in indented lines that say what to do instead. The
last line is the count, with only the parts that are not zero: "3 findings, 1 advice", "3 findings"
or "1 advice". With nothing to say, nothing is printed and the exit code is 0. A status, patch or
link finding makes the exit code 1. A map finding is advice: its last line ends in "(advice)" and it
never fails the command.

## The four checks

| Check | Decision | What it finds |
|---|---|---|
| `status` | [0606](../../.decisions/0606-a-record-is-accepted-or-superseded.md) | A decision whose `id` is not its file's number, whose status is not `accepted` or `superseded`, whose `superseded` has no `successor`, whose `accepted` has one, or whose `successor` names no record in `.decisions/`. A frontmatter that is not YAML is one finding too. |
| `patch` | [0605](../../.decisions/0605-no-record-patches-another.md) | In a decision's body, outside fenced and inline code: a `## Amendments` heading, a line that says the rest of an older record still holds, a line that says a rule is carried forward. |
| `link` | [0607](../../.decisions/0607-every-link-lands-on-a-live-record.md) | A Markdown link, or a `.decisions/NNNN-slug.md` path in a code comment, to a superseded record. The finding names the successor. |
| `map` (advice) | none | A tracked `AGENTS.md`, the root or one folder down, with more than 200 lines. The 200 is `maxLines` in `MapSize.ts`: Claude Code's memory guide says to keep each file "under 200 lines per file" ([memory](https://code.claude.com/docs/en/memory)). Lines count as `wc -l` counts them. A constant, not a setting. |

The link check reads `AGENTS.md` and `CLAUDE.md` files, `.agents/skills/`, `docs/guidelines/`,
`.runbooks/`, `docs/plan/`, `.patterns/` and `.glossary/` (Markdown), and the comments of tracked
`.ts`, `.tsx`, `.js`, `.mjs`, `.sh` and `.yaml` files. It does not read `.decisions/`, `experiments/`,
`field/` or `docs/direction/`, which are history, nor fenced code, nor symlinks. A bare number is not
a link.

## The command

```text
node kalfa/records/src/bin.ts check            all four, every finding, exit 1 if any
node kalfa/records/src/bin.ts check status     one check: status, patch, link or map
```

Run it in the repo's root: the tracked files come from `git ls-files -s` in the working folder.
`@kalfa/records/cli` exports the `effect/cli` command, and `"kalfa": { "cli": "./cli" }` in
`package.json` lets a `kalfa` command find it, as `@kalfa/quality` does. `src/bin.ts` is the edge that
runs it with Node's file system and git.

## Public modules

`Status` (the two cases and `decodeStatus`), `Frontmatter` (the status check and the `Decision`
schema of the keys every decision has), `Finding` (the one union of the four checks' findings) and
`cli`. The other files are private: `Patches`, `Links`, `MapSize`, `Prose` and
`Comments` hold the checks and what they read, and `Tracked` is the service behind `git ls-files`, so
no law starts git and a law hands in a list.
