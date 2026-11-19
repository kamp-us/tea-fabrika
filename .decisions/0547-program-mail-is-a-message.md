---
id: 0547
title: One thing in a name's mailbox is called a message, never a letter, and message keeps its inbox meaning beside it
status: accepted
date: 2026-11-15
tags: [names, mailbox, message, letter, glossary]
---

# 0547: One thing in a name's mailbox is called a message, never a letter, and message keeps its inbox meaning beside it

**What this decides:** the word for one thing one program sends another, which lands in its
mailbox, in `next/`.

## Context

`next/` called one piece of mail in a name's inbox a letter: `Letter`, chunk letters, "a letter
overtakes". Read aloud, letter is first a letter of the alphabet, and it had to be explained each
time. The glossary's own row explained a letter as "OTP's message". Erlang and email both say
message. The owner picked message.

[0582](0582-mail-as-a-noun-goes-it-is-a-mailbox-and-messages.md) then retired "mail" as a noun: a
name's queue is its mailbox, and what lands in it is a message. This record's text says mailbox
where it first said inbox for that queue.

Message already has a decided meaning (2026-11-08): what an agent or a person sends you, a row in
your inbox under Messages. And tea's `Msg` is what a machine's `update` takes.

## Decision

**One thing in a name's mailbox is a message.**

- The word letter leaves `next/`, its docs, the glossary and the skills, in one pull request, done
  in one go.
- Message then has two homes, kept apart by their bounded context
  ([we follow DDD](../docs/direction/we-follow-ddd.md)): in the process code it is the record
  that lands in a name's mailbox; in the inbox program it is the row a person reads. They are the
  same idea at two levels: one thing that landed in a mailbox or an inbox.
- `Msg` stays tea's own word for what `update` takes.
- Saved data keeps the word it was written with: field rows are never edited, and a name already
  written to a ledger is read under both words until no such ledger is left.

## Consequences

- The glossary's `letter` row becomes a `message` row for the Processes context, beside the inbox's
  `message` row, and each says it is not the other.
- If a type named `Message` in the mailbox code and one in the inbox program prove hard to tell
  apart in code, the inbox one takes a longer name. That is not decided here.
- The rename starts after the two renames already in flight have landed (task, 0545; quest, 0546),
  so the three do not collide.

## Records

- `.glossary/TERMS.md`: the `letter` row says it is renamed, and points here.
