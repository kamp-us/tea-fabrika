# Diagnostics

What a kalfa package reports about a place, written first for an agent to act on. This context says what a
diagnostic is. Printing one, and the exit code, are CLI's.

## Language

**Diagnostic**:
One thing a package reports: a code, a severity, a message, a place and a hint. Written first for an agent to act
on. A typed error may carry its own diagnostic.
_Avoid_: finding, issue, problem, result

**Code**:
A diagnostic's stable name, such as `config/unknown-setting`, that starts with its subcommand's root name and stays the
same when the message's words change. A package declares each code once, with its long text, and reports only
through a declared code. `kalfa explain` gives the long text.
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
How much a diagnostic weighs: `error` fails the subcommand, `warning` is only advice. It is given when the
diagnostic is reported, so a setting may choose it.
_Avoid_: level, advice, priority

**Long text**:
A code's full explanation, written in Markdown where the code is declared. The command prints it on request. A
diagnostic's message stays short because the long text exists.
_Avoid_: docs, description, explanation, help
