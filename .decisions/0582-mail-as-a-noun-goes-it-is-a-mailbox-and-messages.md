---
id: 0582
title: In next/, mail as a noun goes: a name's queue is its mailbox, what lands in it is a message, and the settings are mailbox.chunk and mailbox.capacity
status: accepted
date: 2026-11-15
tags: [names, mail, mailbox, message, settings, glossary, next]
---

# 0582: In next/, mail as a noun goes: a name's queue is its mailbox, what lands in it is a message, and the settings are mailbox.chunk and mailbox.capacity

**What this decides:** "mail" as a noun is our own coinage and leaves `next/`. A name's queue is its
mailbox, one thing in it is a message, and the two size settings are renamed to match.

## Context

[0547](0547-program-mail-is-a-message.md) renamed a letter to a message but kept "mail" for the
thing a name receives ("plain mail", `mail.chunk`, `mail.unread`). The owner ruled on 2026-11-15
that the noun goes too. The industry has the words already:

- Erlang: a process has a mailbox, also called its message queue, and what it holds are messages
  ([processes](https://www.erlang.org/doc/system/ref_man_processes.html)).
- Akka: a bounded mailbox is set by `mailbox-capacity`
  ([mailboxes](https://doc.akka.io/libraries/akka-core/current/typed/mailboxes.html)).

0547 amends in part: its rule that one piece is a message holds, its prose and tags that keep "mail"
as a noun do not. The `Mailbox` service already has the right name and keeps it.

## Decision

**"Mail" as a noun leaves `next/`: say mailbox for the queue and message for what is in it.**

```toml
# before
[mail]
chunk  = 65536
unread = 1000
# after
[mailbox]
chunk    = 65536
capacity = 1000
```

- `mail.chunk` becomes `mailbox.chunk`, and `mail.unread` becomes `mailbox.capacity`.
- They live in a `[mailbox]` section of `fabrika.toml`.
- Env vars: `FABRIKA_MAILBOX_CHUNK` and `FABRIKA_MAILBOX_CAPACITY`.
- Flags: `--mailbox.chunk` and `--mailbox.capacity`.
- Prose says message where it said mail: "plain mail" becomes "a plain message".
- The `Mailbox` service keeps its name.
- Before v0.0.0 there is no migration ([0572](0572-pre-release-shape-change-wipes-data.md)): the old keys
  just stop being read.

**Binding constraints**

- No new name, setting or doc uses "mail" as a noun in `next/`.
- No code reads `mail.chunk` or `mail.unread` once the build lands.

## Consequences

- The build owes: regenerate the settings reference and the schemas, and update the glossary rows
  (`chunk`, `full`, `mailed (runner)` and the rest that say mail). It is a separate ticket:
  ticket 1072 in the app's tracker.
- Saved data keeps the word it was written with, as 0547 says.
- Not decided here: renaming code types such as `ProgramMailLedger`; the build ticket picks their
  names from this rule.

## Records

- `.glossary/TERMS.md`: the build ticket updates the rows that say mail.
