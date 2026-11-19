# Glossary map

This is the map of the project's words. It names the contexts, says where each context's glossary
will live, and says how the contexts relate. It defines no term.

**Draft.** This context list is being checked with Event Storming on real flows. Borders may move.

Each context gets its own `GLOSSARY.md` when its words are decided, and not before. **None exists
yet.** A glossary's shape is in the domain-modeling skill
([mattpocock/skills](https://github.com/mattpocock/skills/blob/main/skills/engineering/domain-modeling/GLOSSARY-FORMAT.md),
adapted for this repo in [PR 1668](https://github.com/kamp-us/tea-fabrika/pull/1668)): a short
description, then each term with its meaning and an `_Avoid_` line. When a glossary is made, its
line below becomes a link, in the same pull request. The old file, about 650 lines and 500 terms,
is in git history. It is not a source: the words get decided again, one context at a time.

The paths below are leans. A glossary may land beside the code it names, and its pull request
moves the line here if it does.

## Contexts

- **Shared names** (`next/packages/libfabrika/GLOSSARY.md`): the few words every context uses, such
  as ids and keys. A small shared kernel.
- **Ledger** (`next/packages/libfabrika/src/ledger/GLOSSARY.md`): the record of facts and the
  coordination built on it.
- **Runtime and program core** (`next/packages/libfabrika/src/runtime/GLOSSARY.md`): what a program
  is, how it runs, and the processes that run it.
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
- **Access** (`next/packages/libfabrika/src/access/GLOSSARY.md`): who someone is, and what they may
  do.
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
(`@kalfa/provider-github`, [0616](../.decisions/0616-chat-codehost-provider-split.md)), so none of
its words are ours.

## Relationships

- **Shared names** is a shared kernel: small, used by every context, changed in a pull request that
  changes its glossary too.
- **Ledger supplies, the rest are its customers.** Tracker, Pipeline and Runtime write facts to it
  and read them back.
- **Pipeline and Tracker are partners.** The pipeline asks; the tracker shows the ask to a person.
- **Delivery uses Code hosting,** and **Code hosting uses Source control.**
- **A git provider implements Source control.** `@kalfa/provider-github` implements Code hosting
  and the remote side of Source control. It is the anticorruption layer: it translates GitHub's
  words (pull request, check run, ruleset) into Code hosting's.
- **Delivery uses CI.** A change lands only when the builds it needs have passed.
- **Access and Configuration are asked by many.** Any context may ask who someone is, or read a
  setting, and neither owns the question's words.
- **Conversation reaches people.** Pipeline and Tracker speak to it, and it translates chat-app
  words into ours.
- **Clients and Frame speak to Runtime** over a published protocol, and show what Tracker and
  Pipeline say.
- **Records talk about every context** and translate nothing.
- **Broad words never appear bare.** "Run" means nothing alone. A context uses its own precise word:
  CI says build and job, Code hosting says check, Runtime says process. A GitHub "workflow run" is
  translated into a build inside `@kalfa/provider-github`.
- A word that means two things in two contexts gets an entry in each glossary and a line here.

## Open clashes

Borders that are still fuzzy, one line each.

- **Delivery vs Pipeline:** both own "a change on its way to main"; unclear where one stops.
- **Delivery vs CI:** who owns priority, the order builds and merges go in.
- **Access vs the Ledger's `WritePolicy`:** who may write is Access's question, but the ledger
  enforces it.
- **Conversation vs Tracker:** an ask in chat and an ask in the inbox may be one thing.
- **Configuration's drift:** a context of its own, or a pattern other contexts use.
