# CLI

The `kalfa` command, and the contract every package's subcommand under it keeps: how it is found, how it is named,
what it reports and what its exit code means.

## Language

**Command**:
The whole `kalfa` entry: one root that holds the subcommand of every kalfa package a repo depends on directly.
_Avoid_: tool, binary, app, program

**Subcommand**:
One package's command under `kalfa`, found through the `kalfa.cli` field in that package's manifest.
_Avoid_: plugin, extension, tool

**Root name**:
A subcommand's first word, such as `records`. Two installed packages with the same root name stop the command from
starting.
_Avoid_: alias, command name

**Diagnostic**:
One thing a subcommand reports: a code, a severity, a message, a place and a hint. Written first for an agent to act
on.
_Avoid_: finding, issue, problem, result

**Code**:
A diagnostic's stable name, such as `leak-guard/key-shape`, that starts with its subcommand's root name and stays the
same when the message's words change. `kalfa explain` gives its long text.
_Avoid_: rule id, error number, kind

**Message**:
What a diagnostic says is so, as a fact, never quoting text that must stay private.
_Avoid_: description, text, summary

**Place**:
Where a diagnostic points: a path from the repo root, and a line and column when known. The whole repo is `.`.
_Avoid_: location, position, span

**Hint**:
What to do next about a diagnostic. Every diagnostic has one; when only a person can decide, the hint says so.
_Avoid_: suggestion, fix, help, advice

**Severity**:
How much a diagnostic weighs: `error` fails the subcommand, `warning` is only advice.
_Avoid_: level, advice, priority

**Failure**:
A subcommand that could not finish, told apart from one that reported errors. It has a message and no code, place or
severity.
_Avoid_: crash, error, abort

**Exit code**:
What a subcommand ends with: 0 when it reported no error, 1 when it reported one or more errors (already
printed), 2 when it could not finish.
_Avoid_: status, return code
