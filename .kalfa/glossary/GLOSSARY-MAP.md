# Glossary map

This is the map of the project's words. It names the contexts, says where each context's glossary
will live, and says how the contexts relate. It defines no term. The rule for it is.

**Draft.** This context list is being checked with Event Storming on real flows. Borders may move.

Each context gets its own `GLOSSARY.md` when its words are decided, and not before. Sixteen exist so
far: Shared names, Ledger, Program, Identity, Transport, Permissions, Delivery, Incidents, Reconciliation, Secrets, Leak guard, CI, Source control, Conversation, Code hosting and Configuration. Its shape is in the `domain-modeling` skill's
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
- **Records** ([`kalfa/records/GLOSSARY.md`](../../kalfa/records/GLOSSARY.md)): the docs a repo's
  agents read: each record kind, where it lives and what goes in it.
- **Clients and Frame** (`next/packages/tuval/GLOSSARY.md`): the app side: how clients reach the
  brain, and the window a person sees.
- **Delivery** ([`kalfa/delivery/GLOSSARY.md`](../../kalfa/delivery/GLOSSARY.md)): getting a change request onto
  main safely, in an order we choose.
- **CI** ([`kalfa/ci/GLOSSARY.md`](../../kalfa/ci/GLOSSARY.md)): one CI execution for one commit (a build), its
  pieces (jobs), and choosing which builds start first (priority class, slot, admission).
- **Identity** ([`kalfa/identity/GLOSSARY.md`](../../kalfa/identity/GLOSSARY.md)): who is acting:
  keys, clients, and the humans and agents they act for.
- **Transport** ([`kalfa/transport/GLOSSARY.md`](../../kalfa/transport/GLOSSARY.md)): how values
  move between two places: socket, connection, gateway and frame.
- **Permissions** ([`kalfa/permissions/GLOSSARY.md`](../../kalfa/permissions/GLOSSARY.md)): what a
  human or agent may do: relations, permissions, checks and roles.
- **Configuration** ([`kalfa/config/GLOSSARY.md`](../../kalfa/config/GLOSSARY.md)): the values an app's programs run
  with, read from flags, environment variables and two files, and where each one came from. It never reads a host.
- **Reconciliation** ([`kalfa/reconciliation/GLOSSARY.md`](../../kalfa/reconciliation/GLOSSARY.md)): the
  project's kalfa config says what should be true (desired state), it is compared with what is live,
  and drift is reported or reconciled.
- **Incidents** ([`kalfa/incidents/GLOSSARY.md`](../../kalfa/incidents/GLOSSARY.md)): an incident and its
  severity, the alerts that open and resolve it, its fixes, and paging the people who run it.
- **Secrets** ([`kalfa/secrets/GLOSSARY.md`](../../kalfa/secrets/GLOSSARY.md)): a value few may read, known to others only by its name;
  fetched, or used to sign without leaving.
- **Leak guard** ([`kalfa/leak-guard/GLOSSARY.md`](../../kalfa/leak-guard/GLOSSARY.md)): checking text before it goes public
  against its rules, such as a list of private words, with a refusal that really stops the write.
- **Conversation** ([`kalfa/chat/GLOSSARY.md`](../../kalfa/chat/GLOSSARY.md)): talking with people in a thread, in a
  chat app or in a pull request's comments, the comments under a line of code included.
- **Source control** ([`kalfa/git/GLOSSARY.md`](../../kalfa/git/GLOSSARY.md)): git itself, in git's own words:
  repository, ref, commit, push, rebase. Not GitHub.
- **Code hosting** ([`kalfa/codehost/GLOSSARY.md`](../../kalfa/codehost/GLOSSARY.md)): what a remote host adds on top of git: a proposal
  to merge one ref into another, reviews, the host's checks, its rules, and access grants
  (short-lived credentials the host gives out). Built from Source control's words.
- **Agent runs** (`next/packages/libfabrika/src/tasks/GLOSSARY.md`): sessions, models, effort,
  briefs, transcripts and usage.

GitHub is not a context. `@kalfa/github` is an Effect client for GitHub's API in GitHub's own words, and it
implements no context's interface. Each context that reaches GitHub translates in its own entry point
(`@kalfa/codehost/github`, `@kalfa/chat/github`, `@kalfa/ci/github`), so none of GitHub's words are ours.

## Relationships

- **Shared names** is a shared kernel: small, used by every context, changed in a pull request that
  changes its glossary too.
- **Ledger supplies, the rest are its customers.** Tracker, Pipeline and Program write facts to it
  and read them back.
- **Pipeline and Tracker are partners.** The pipeline asks; the tracker shows the ask to a person.
- **Delivery uses Code hosting,** and **Code hosting uses Source control.**
- **Each context's `/github` entry point is its anticorruption layer.** `@kalfa/codehost/github` translates
  GitHub's words (pull request, check run, ruleset) into Code hosting's. Each such entry point uses `@kalfa/github`
  for the calls.
- **Source control has no GitHub entry point.** A GitHub remote is a plain git remote; Code hosting hands it the
  credential, an access grant.
- **`@kalfa/github` uses Secrets:** a GitHub App logs in with a token signed by Secrets' signing key, so the private
  key never leaves Secrets. The installation token it gets back is GitHub's word; `@kalfa/codehost/github` turns it
  into an access grant, and no other context sees one.
- **Pipeline hands a change request to Delivery at Ready.** Pipeline is Delivery's customer and uses Delivery's
  words as they are; Delivery never says ticket, step, plan, law or fix round. Pipeline's steps (plan, tests, build,
  review) end when it marks the change request ready; Pipeline has no land step and only hears how it ended. Its
  review step's pass goes to Delivery as an approval, counted only if Delivery's approver setting lets an agent
  approve. When Delivery takes a change request out (failed, replaced, withdrawn) it only says so, with the carry
  answer for a replaced one; Pipeline decides what is next: a kept one goes back to ready at once, a stale one back to
  review, a failed one to a fix round.
- **Delivery uses CI.** A change candidate lands only on a passing verdict: the verdict of the candidate's build.
  Delivery reads the verdict and never says build, job or check. A canceled build gives no verdict.
- **Priority vs precedence:** CI's priority orders builds; Configuration's precedence orders which source wins.
- **Priority vs landing order:** landing order is Delivery's (its queue); CI's priority only orders which builds start
  first. CI never reads Delivery or Incidents: whoever asks for a build gives its priority class, such as fix, and CI's
  setting ranks the classes.
- **Revision and head** are the Ledger's. Delivery says changeset and latest changeset.
- **HEAD** (Source control) is what a working copy has checked out; **head** (Ledger) is a stream's newest revision.
- **A changeset is a commit** seen from Delivery, and a build runs on a commit. Delivery builds a change candidate
  with Source control's rebase or a merge commit; which one is Delivery's setting.
- **Land vs merge commit:** landing is Delivery's word; a merge commit is only a commit with two parents.
- **Delivery obeys Incidents.** An open incident's severity has a response, such as a hold; Delivery
  lands only fixes during a hold and puts each fix first. Delivery hears incidents by reading a
  stream, so there is no watch context. A hold cancels the builds of anything that is not a fix through CI's cancel
  below a class; the app connects the two, and CI never reads a hold.
- **Incidents raises alerts from CI's builds,** such as a broken main or a test failing again and again. Which
  alerts exist and what each opens is a setting.
- **Incidents pages people through Conversation.** Who may declare a severity, and which severities a
  rule may escalate to, are Permissions' answers.
- **Reconciliation uses Code hosting** for a host's live settings, such as its rules. Who may push
  where is one of those rules.
- **Reconciliation reads its desired state through Configuration,** from the project's kalfa config: the repo
  configuration of the app named kalfa. Drift is Reconciliation's word, and Configuration does not use it.
- **Configuration never reads a host.** A host's live value is a host setting or a ref rule (Code hosting), read by
  Reconciliation's live state source. A setting (Configuration) is never a host setting.
- **Source** is never bare across contexts: Configuration's source is a place values are read from; Reconciliation
  says live state source.
- **Flag vs args:** a flag (Configuration) is one value on the command line; args (Program) are all the values a
  process starts with. Configuration's load makes a process's args from every source.
- **Live setting vs hot reload:** a live setting's new value reaches a running process as an input (Program); hot
  reload swaps a program's code. A restart setting is one of a process's args. Neither says a bare "reload".
- **User** in Configuration means the person whose config home holds the user configuration. Identity says human or
  agent, and Code hosting says host account.
- **A setting holds a secret's name, never its value.** The value is fetched from Secrets.
- **Check** means three things: in Permissions, running a permission; in Reconciliation, comparing the
  desired state with the live state; in Code hosting, a named mark the host keeps on one commit. CI's builds show on
  the host as checks.
- **Host** is Code hosting's word: a remote that adds change requests, reviews, checks, rules and access grants.
  Shared names' platform and Identity's device avoid "host" because they mean other things.
- **Change request** is one word for one thing in Delivery and Code hosting. Code hosting knows its source and target
  branches and its state; Delivery adds changesets, approvals and the queue.
- **Merge** means three things, and none is bare: Delivery lands; Source control makes a merge commit; Code hosting
  marks a change request merged, which Delivery's landing causes.
- **Approve vs approval:** approving is a Code hosting review; Delivery's approval is read from one or handed in by a
  caller such as Pipeline. Delivery's approver setting says whose yes counts, and its carry rule alone says how long
  it covers.
- **Rule** means two things: in Leak guard, a check on outgoing text; in Code hosting, a ref rule (a limit on matching
  refs) is never called a bare rule.
- **Host account vs speaker vs sender:** a host account is a name the host knows; Identity says who is behind it, as
  it does for Conversation's speaker. A sender is still only the client the gateway stamped.
- **Code hosting uses Secrets** to sign an access grant's request with a signing key, which never leaves Secrets.
- **Every public write goes through Leak guard:** a push, a post on the host, a reply in a thread.
  The private words are a secret.
- **Verdict** means three things: in Delivery, whether a change candidate passed its checks; in CI, a build's passed
  or failed, which Delivery's is read from; in Leak guard, pass or refusal for one public write.
- **Identity, Permissions and Configuration are asked by many.** Any context may ask who is acting,
  what they may do, or read a setting, and none owns the question's words.
- **Permissions checks a subject, never a sender.** It imports nothing from Identity: the app turns a sender into a
  subject, and Permissions answers what that subject may do, never who it is.
- **Conversation reaches people.** Pipeline and Tracker speak to it, and it translates chat-app
  words into ours. `@kalfa/chat/github` implements it for a pull request's comment threads.
- **A review is Code hosting's; the talk under it is Conversation's.** Approving or asking for changes is Code
  hosting's. A comment thread under a line of code is a Conversation thread whose anchor Code hosting's words fill in
  (file, line, commit).
- **Speaker vs sender:** a sender (Identity) is the client the gateway stamped; a speaker (Conversation) is the human
  or agent a provider found behind a chat app's account. An unknown speaker may ask for nothing, which Permissions
  enforces.
- **Feature vs capability:** a feature is what a Conversation provider offers, such as reactions; a capability
  (Identity) is what a client can do.
- **When work starts on a timer is Program's.** There is no Scheduling context.
- **Clients and Frame speak to Program** over a published protocol, and show what Tracker and
  Pipeline say.
- **Records talk about every context** and translate nothing.
- **Broad words never appear bare.** "Run" means nothing alone. A context uses its own precise word:
  CI says build and job, Code hosting says check, Program says process. A GitHub "workflow run" is
  translated into a build inside `@kalfa/ci/github`.
- A word that means two things in two contexts gets an entry in each glossary and a line here.
- **Capability vs permission:** a capability (Identity) is what a client can do; a permission is what
  someone may do. Permissions never says capability.
- **A limit is a wall, not a permission:** spend, quota and CPU caps belong to Program, never to
  Permissions.
- **Recovery** means two things: in Program, a process getting back its saved state; in Identity, a
  human getting back in after losing every device.

## Open clashes

Borders that are still fuzzy, one line each.

- **Permissions vs the Ledger's `WritePolicy`:** who may write is Permissions' question, but the
  ledger enforces it.
- **Frame:** in Transport, one piece of text on a socket; Clients and Frame uses it for the window around
  a program, which gets its own word (a lean: chrome) when that glossary is written.
- **Conversation vs Tracker:** Conversation carries a message and the app decides it is an ask; an
  ask in chat and an ask in the inbox may still be one thing.
