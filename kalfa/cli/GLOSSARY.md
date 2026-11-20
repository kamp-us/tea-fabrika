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
One thing a subcommand reports, at a place, with a severity.
_Avoid_: finding, issue, problem, result

**Severity**:
How much a diagnostic weighs: `error` fails the subcommand, `warning` is only advice.
_Avoid_: level, advice, priority

**Exit code**:
What a subcommand ends with: 0 when it reported no error, 1 when it reported one or more errors (already
printed), 2 when it could not finish.
_Avoid_: status, return code
