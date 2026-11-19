# Glossary map

This is the map of the project's words. It names the contexts, says where each context's glossary
will live, and says how the contexts relate. It defines no term. The rule for it is.

**Draft.** This context list is being checked with Event Storming on real flows. Borders may move.

Each context gets its own `GLOSSARY.md` when its words are decided, and not before. Six exist so
far: Shared names, Ledger, Program, Identity, Transport and Permissions. Its shape is in the `domain-modeling` skill's
[`GLOSSARY-FORMAT.md`](../../.agents/skills/domain-modeling/GLOSSARY-FORMAT.md), adapted for this repo in
[PR 1668](https://github.com/kamp-us/tea-fabrika/pull/1668). In short:

```md
# Context name

One sentence on what the context is.

## Language

**Term**:
What the word means here.
_Avoid_: the words to use instead
```

Each term is a `**Term**:` line, its meaning, and an `_Avoid_:` line, with no blank line inside the
term. When a glossary is made, its line below becomes a link, in the same pull request. The old
file, about 700 lines and 460 terms, is in git history. It is not a source: the words get decided
again, one context at a time.

The paths below are leans. A glossary may land beside the code it names, and its pull request
moves the line here if it does.

## Contexts

- **Shared names** ([`kalfa/GLOSSARY.md`](../../kalfa/GLOSSARY.md)): the few words every context
  uses with one meaning, such as stream, platform and replica. A small shared kernel.
- **Ledger** ([`kalfa/ledger/GLOSSARY.md`](../../kalfa/ledger/GLOSSARY.md)): the record of facts and the
  coordination built on it.
- **Program** ([`kalfa/program/GLOSSARY.md`](../../kalfa/program/GLOSSARY.md)): what a program is,
  how it runs as processes, and what happens when one fails.
- **Pipeline** (`next/programs/pipeline/GLOSSARY.md`): the steps a ticket goes through from filed to
  merged.
- **Tracker** (`next/programs/inbox/GLOSSARY.md`): tickets, plans and asks as a person sees them.
- **Records** (`docs/GLOSSARY.md`): the project as a lab notebook: what was decided, measured and
  seen.
- **Clients and Frame** (`next/packages/tuval/GLOSSARY.md`): the app side: how clients reach the
  brain, and the window a person sees.
- **Delivery** (`kalfa/ci/GLOSSARY.md`): getting a change onto main safely, in an order we choose.
- **CI** (`kalfa/ci/GLOSSARY.md`): one CI execution for one revision (a build), its pieces (jobs),
  and choosing which builds start first (priority, admission).
- **Identity** ([`kalfa/identity/GLOSSARY.md`](../../kalfa/identity/GLOSSARY.md)): who is acting:
  keys, clients, and the humans and agents they act for.
- **Transport** ([`kalfa/transport/GLOSSARY.md`](../../kalfa/transport/GLOSSARY.md)): how values
  move between two places: socket, connection, gateway and frame.
- **Permissions** ([`kalfa/permissions/GLOSSARY.md`](../../kalfa/permissions/GLOSSARY.md)): what a
  human or agent may do: relations, permissions, checks and roles.
- **Configuration** (`kalfa/config/GLOSSARY.md`): settings that should match a file, and drift.
- **Conversation** (`kalfa/chat/GLOSSARY.md`): talking with people in chat apps.
- **Source control** (`kalfa/git/GLOSSARY.md`): git itself: repository, ref, commit, push. Not
  GitHub.
- **Code hosting** (`kalfa/codehost/GLOSSARY.md`): what a remote host adds on top of git: a proposal
  to merge one ref into another, reviews, the host's checks and its rules. Built from Source
  control's words.
- **Agent runs** (`next/packages/libfabrika/src/tasks/GLOSSARY.md`): sessions, models, effort,
  briefs, transcripts and usage.
- **Scheduling** (candidate, no path yet): when work starts on its own. It may fold into another
  context.

GitHub is not a context. It sits behind an anticorruption layer, in a provider package
(`@kalfa/provider-github`), so none of
its words are ours.

## Relationships

- **Shared names** is a shared kernel: small, used by every context, changed in a pull request that
  changes its glossary too.
- **Ledger supplies, the rest are its customers.** Tracker, Pipeline and Program write facts to it
  and read them back.
- **Pipeline and Tracker are partners.** The pipeline asks; the tracker shows the ask to a person.
- **Delivery uses Code hosting,** and **Code hosting uses Source control.**
- **A git provider implements Source control.** `@kalfa/provider-github` implements Code hosting
  and the remote side of Source control. It is the anticorruption layer: it translates GitHub's
  words (pull request, check run, ruleset) into Code hosting's.
- **Delivery uses CI.** A change lands only when the builds it needs have passed.
- **Identity, Permissions and Configuration are asked by many.** Any context may ask who is acting,
  what they may do, or read a setting, and none owns the question's words.
- **Permissions uses Identity:** it answers what a sender may do, never who the sender is.
- **Conversation reaches people.** Pipeline and Tracker speak to it, and it translates chat-app
  words into ours.
- **Clients and Frame speak to Program** over a published protocol, and show what Tracker and
  Pipeline say.
- **Records talk about every context** and translate nothing.
- **Broad words never appear bare.** "Run" means nothing alone. A context uses its own precise word:
  CI says build and job, Code hosting says check, Program says process. A GitHub "workflow run" is
  translated into a build inside `@kalfa/provider-github`.
- A word that means two things in two contexts gets an entry in each glossary and a line here.
- **Capability vs permission:** a capability (Identity) is what a client can do; a permission is what
  someone may do. Permissions never says capability.
- **A limit is a wall, not a permission:** spend, quota and CPU caps belong to Program, never to
  Permissions.
- **Recovery** means two things: in Program, a process getting back its saved state; in Identity, a
  human getting back in after losing every device.

## Open clashes

Borders that are still fuzzy, one line each.

- **Delivery vs Pipeline:** both own "a change on its way to main"; unclear where one stops.
- **Delivery vs CI:** who owns priority, the order builds and merges go in.
- **Permissions vs the Ledger's `WritePolicy`:** who may write is Permissions' question, but the
  ledger enforces it.
- **Frame:** in Transport, one piece of text on a socket; Clients and Frame uses it for the window around
  a program, which gets its own word (a lean: chrome) when that glossary is written.
- **Conversation vs Tracker:** an ask in chat and an ask in the inbox may be one thing.
- **Configuration's drift:** a context of its own, or a pattern other contexts use.
