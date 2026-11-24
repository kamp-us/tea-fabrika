# CLI

The `kalfa` command, and the contract every package's subcommand under it keeps: how it is found, how it is named,
what it reports and what its exit code means. What a diagnostic is (its code, severity, message, place and hint) is
Diagnostics' ([`kalfa/diagnostics/GLOSSARY.md`](../diagnostics/GLOSSARY.md)).

## Language

**Command**:
The whole `kalfa` entry: one root that holds the subcommand of every kalfa package a repo depends on directly.
_Avoid_: tool, binary, app, program

**Subcommand**:
One package's command under `kalfa`, found through the `kalfa.cli` field in that package's manifest.
_Avoid_: plugin, extension, tool

**Root name**:
A subcommand's first word, such as `records`. Two installed packages with the same root name stop the command from
starting, and so does a package that takes the name of a built-in, `config` or `explain`.
_Avoid_: alias, command name

**Failure**:
A subcommand that could not finish, told apart from one that reported errors. It has a message and no code, place or
severity. A subcommand that stops with an error that carries its own diagnostic is not a failure: the command reports
that diagnostic.
_Avoid_: crash, error, abort

**Exit code**:
What a subcommand ends with: 0 when it reported no error, 1 when it reported one or more errors (already
printed), 2 when it could not finish.
_Avoid_: status, return code

**Readable line**:
How the command prints one diagnostic by default: one line on standard error with its place, severity, code, message and
hint, with no line break in it.
_Avoid_: pretty output, human format, log line

**Write command**:
A subcommand that changes something. It sends one message to a process the app runs, and the app decides and
writes. A subcommand that only reads stays on the device.
_Avoid_: mutation, action, remote command

**Direct**:
How a write command writes when the app is down: it writes the entry itself, straight into the app's Ledger. The
program's guard does not run, and the entry's sender says it was direct. Only a write command that needs nothing but
the Ledger has it.
_Avoid_: offline, force, bypass, local mode
