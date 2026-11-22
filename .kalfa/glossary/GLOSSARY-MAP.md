# Glossary map

This is the map of the project's words. It names the contexts, says where each context's glossary
will live, and says how the contexts relate. It defines no term. The rule for it is.

**Draft.** This context list is being checked with Event Storming on real flows. Borders may move.

Each context gets its own `GLOSSARY.md` when its words are decided, and not before. Twenty-one exist so
far: Shared names, Ledger, Program, Identity, Transport, Permissions, Delivery, Incidents, Reconciliation, Secrets, CI, Source control, Conversation, Code hosting, Configuration, Diagnostics, CLI, Code quality, Telemetry, Agents and Markdown. Its shape is in the `domain-modeling` skill's
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
- **Markdown** ([`kalfa/markdown/GLOSSARY.md`](../../kalfa/markdown/GLOSSARY.md)): a Markdown file as a
  thing code reads and writes: its frontmatter, its body, and the body as a tree.
- **Clients and Frame** (`next/packages/tuval/GLOSSARY.md`): the app side: how clients reach the
  brain, and the window a person sees.
- **Delivery** ([`kalfa/delivery/GLOSSARY.md`](../../kalfa/delivery/GLOSSARY.md)): getting a change request onto
  main safely, in an order we choose.
- **CI** ([`kalfa/ci/GLOSSARY.md`](../../kalfa/ci/GLOSSARY.md)): one CI execution for one commit (a build), its
  pieces (jobs), and choosing which builds start first (priority class, slot, admission, floor, triage).
- **Identity** ([`kalfa/identity/GLOSSARY.md`](../../kalfa/identity/GLOSSARY.md)): who is acting:
  keys, clients, and the humans and agents they act for, in one project, and who is behind an outside account.
- **Transport** ([`kalfa/transport/GLOSSARY.md`](../../kalfa/transport/GLOSSARY.md)): how values
  move between two places: socket, connection, gateway and frame.
- **Permissions** ([`kalfa/permissions/GLOSSARY.md`](../../kalfa/permissions/GLOSSARY.md)): what a
  subject may do: relations, relationships, permissions built by union, intersection and arrow, checks and roles.
- **Configuration** ([`kalfa/config/GLOSSARY.md`](../../kalfa/config/GLOSSARY.md)): the values an app's programs run
  with, read from flags, environment variables and two files, and where each one came from. It never reads a host.
- **Reconciliation** ([`kalfa/reconciliation/GLOSSARY.md`](../../kalfa/reconciliation/GLOSSARY.md)): the
  project's kalfa config says what should be true (desired state), it is compared with what is live,
  and drift is reported or reconciled.
- **Incidents** ([`kalfa/incidents/GLOSSARY.md`](../../kalfa/incidents/GLOSSARY.md)): an incident and its
  severity, the alerts that open and resolve it, its fixes, and paging the people who run it.
- **Secrets** ([`kalfa/secrets/GLOSSARY.md`](../../kalfa/secrets/GLOSSARY.md)): a value few may read, known to others only by its name;
  fetched, or used to sign without leaving.
- **Conversation** ([`kalfa/chat/GLOSSARY.md`](../../kalfa/chat/GLOSSARY.md)): hearing and answering people in a room of
  a chat app someone else runs, or in a pull request's comments, the comments under a line of code included.
- **Source control** ([`kalfa/git/GLOSSARY.md`](../../kalfa/git/GLOSSARY.md)): git itself, in git's own words:
  repository, ref, commit, push, rebase. Not GitHub.
- **Code hosting** ([`kalfa/codehost/GLOSSARY.md`](../../kalfa/codehost/GLOSSARY.md)): what a remote host adds on top of git: a proposal
  to merge one ref into another, reviews, the host's checks, its rules, and access grants
  (short-lived credentials the host gives out). Built from Source control's words.
- **Diagnostics** ([`kalfa/diagnostics/GLOSSARY.md`](../../kalfa/diagnostics/GLOSSARY.md)): what a package reports
  about a place, for an agent to act on: a diagnostic's code, severity, message, place and hint.
- **CLI** ([`kalfa/cli/GLOSSARY.md`](../../kalfa/cli/GLOSSARY.md)): the `kalfa` command, which finds each
  package's subcommand, and the contract every subcommand keeps: root name, failure and exit code. It prints
  Diagnostics' diagnostics.
- **Code quality** ([`kalfa/quality/GLOSSARY.md`](../../kalfa/quality/GLOSSARY.md)): what a repo's tests are
  built from (laws, depth, recorder, stub, test database), and the checks that show its code and tests are good:
  plants, lint rules and size limits.
- **Telemetry** ([`kalfa/telemetry/GLOSSARY.md`](../../kalfa/telemetry/GLOSSARY.md)): what every step of every kalfa
  package did: traces made of spans, the trace stamp and build stamp on ledger entries, and where spans are kept.
- **Agents** ([`kalfa/agents/GLOSSARY.md`](../../kalfa/agents/GLOSSARY.md)): starting a coding harness and talking to
  it, in the Agent Client Protocol's words: session, prompt, turn, update, stop reason. Also the words of a summoned
  agent: summon, dismiss, down, tell, ask and subagent.

GitHub is not a context. `@kalfa/github` is an Effect client for GitHub's API in GitHub's own words, and it
implements no context's interface. Each context that reaches GitHub translates in its own entry point
(`@kalfa/codehost/github`, `@kalfa/chat/github`, `@kalfa/ci/github`, `@kalfa/identity/github`), so none of GitHub's
words are ours. The client names no operation: each entry point declares the GitHub operations it uses.

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
  credential, made from an access grant.
- **Checking what goes public is no context** (decision 0059). A repo does it with its own tooling, which can fill
  git's pre-push hook; no kalfa package names it.
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
  setting ranks the classes. A build the host starts by itself gets its class from CI's triage.
- **Revision and head** are the Ledger's. Delivery says changeset and latest changeset.
- **HEAD** (Source control) is what a working copy has checked out; **head** (Ledger) is a stream's newest entry.
- **A changeset is a commit** seen from Delivery, and a build runs on a commit. Delivery builds a change candidate
  with Source control's rebase, squash or a merge commit; which one is Delivery's landing style, a setting.
- **Land vs merge commit:** landing is Delivery's word; a merge commit is only a commit with two parents.
- **Delivery obeys Incidents.** An open incident's severity has a response, such as a hold; Delivery
  lands only fixes during a hold and puts each fix first. Delivery never reads Incidents: an entry point in
  Incidents (`@kalfa/incidents/delivery`) tells it about the hold and each fix mark, so there is no watch context. A hold sets CI's floor, which cancels the builds of anything that is not a
  fix, and a fix mark answers CI's triage. An entry point in Incidents (`@kalfa/incidents/ci`) connects the two, the
  app picks it, and CI never reads a hold.
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
- **Sender** is Identity's word in Secrets too: a fetch or a signing is recorded with its sender. Permissions' subject
  is the one whose allowance is checked.
- **Version** in Secrets is one signing key a secret name has held. A protocol's version (Transport) and a package's
  version are other things, and none is bare across contexts.
- **Check** means three things: in Permissions, running a permission; in Reconciliation, comparing the
  desired state with the live state; in Code hosting, a named mark the host keeps on one commit. CI's builds show on
  the host as checks.
- **Host** is Code hosting's word: a remote that adds change requests, reviews, checks, rules and access grants.
  Shared names' platform and Identity's device avoid "host" because they mean other things.
- **Change request** is one word for one thing in Delivery and Code hosting. Code hosting knows its source and target
  branches and its state; Delivery adds changesets, approvals and the queue.
- **Merge** means three things, and none is bare: Delivery lands; Source control makes a merge commit; Code hosting
  reports a change request merged when the host shows it so. Delivery lands with git and never asks the host to
  merge (decision 0060). For a landing by rebase or squash it moves the change request's branch first, so the host
  still shows merged (decision 0071).
- **Approve vs approval:** approving is a Code hosting review; Delivery's approval is read from one or handed in by a
  caller such as Pipeline. Delivery's approver setting says whose yes counts, and its carry rule alone says how long
  it covers.
- **Rule** in Code quality is one thing a lint looks for in a repo's files. In Code hosting, a ref rule (a limit on matching refs) is never called a bare rule.
- **Host gate:** Code quality's host gate says whether this machine may run test files; it checks no text.
- **Host account vs speaker vs sender:** a host account is a name the host knows; Identity says who is behind it through
  a link, as it does for Conversation's speaker. A sender is only the client or summoned agent the gateway or the brain stamped.
- **Code hosting uses Secrets** to sign an access grant's request with a signing key, which never leaves Secrets.
- **Verdict** means two things: in Delivery, whether a change candidate passed its checks; in CI, a build's passed
  or failed, which Delivery's is read from.
- **Identity, Permissions and Configuration are asked by many.** Any context may ask who is acting,
  what they may do, or read a setting, and none owns the question's words.
- **Permissions checks a subject, never a sender.** It imports nothing from Identity: the app turns a sender into a
  subject, and Permissions answers what that subject may do, never who it is.
- **Conversation reaches people.** Pipeline and Tracker speak to it, and it translates chat-app
  words into ours. `@kalfa/chat/github` implements it: a pull request's comment list is a room, and the comments
  under one line of code are a thread in it.
- **Conversation keeps what it hears and says on the Ledger.** A reply is recorded before it is sent.
- **An app's own rooms are not Conversation's.** Rooms with members who join, leave and fork belong to the app that
  has them. Conversation is only the way to chat apps someone else runs.
- **A review is Code hosting's; the talk under it is Conversation's.** Approving or asking for changes is Code
  hosting's. A comment thread under a line of code is a Conversation thread, in the pull request's room, whose anchor Code hosting's words fill in
  (file, line, commit).
- **Speaker vs sender:** a sender (Identity) is the client or summoned agent the gateway or the brain stamped; a speaker (Conversation) is the human
  or agent Identity knows behind a chat app's account (Conversation's word for the name a chat app knows someone by). An unknown speaker may ask for nothing, which Permissions
  enforces.
- **Feature vs capability:** a feature is what a Conversation provider may offer, such as starting a thread; a capability
  (Identity) is what a client can do.
- **When work starts on a timer is Program's.** There is no Scheduling context.
- **Clients and Frame speak to Program** over a published protocol, and show what Tracker and
  Pipeline say.
- **Records talk about every context** and translate nothing.
- **Records reads and writes a record through Markdown.** Markdown knows the file's parts; what a record's
  data means is Records'.
- **CLI is the edge of every kalfa package that has a subcommand.** Each package's subcommand speaks its own
  context's words; CLI owns only how it is found, named, and how it ends. A flag (Configuration) is still
  Configuration's word.
- **Every package traces; Telemetry keeps.** Every kalfa package traces every step with Effect's own spans and imports
  no Telemetry. Telemetry's trace stamp and build stamp fill slots on Ledger entries, and its span log is a separate
  Ledger log.
- **Span vs entry:** a span is Telemetry's, one step with a start and an end; an entry is the Ledger's, one kept fact.
  The span log keeps each finished span as an entry.
- **Link vs parent:** Telemetry's parent runs a span inside another; a link only points. The reader of an entry links
  to the writer's span by default.
- **Harness vs agent:** a harness (Agents) is the maker's program we start; an agent (Identity) is who acts for a
  human. The Agent Client Protocol calls the harness an "agent" and us a "client", and we use neither word that way.
- **No context owns a summoned agent** (decision 0066). It is Identity's join, a process Program starts under the
  name `<human>/<agent>`, and a session Agents opens, joined in `@kalfa/agents/program`. Program's registry is the
  only list of live agents, and Identity answers which agents a human has.
- **Turn vs step:** a turn (Agents) is what a harness does with one prompt; a step (Program) is a process handling one
  message. A turn is a deferred tool of the agent's program, so its end arrives as a message and starts a step.
- **Prompt vs message:** a prompt is text sent to a session; a message (Program) is a value on a process's input. A
  message to an agent's process becomes a prompt.
- **Stop reason vs exit reason:** a stop reason (Agents) says why a turn ended; an exit reason (Program) says why a
  process ended.
- **Session** means a harness session only. Telemetry and Identity avoid the word for a trace and for a client.
- **Tool vs lent tool:** a tool (Program) is outside work a step uses; a lent tool (Agents) is one a harness may call.
  Showing a program's inputs as tools is Program's, and which inputs a session may call is the program's own list of
  opened inputs.
- **Permission request vs permission:** a permission request (Agents) is a harness asking before one tool call, a
  courtesy; a permission (Permissions) is what a subject may do. Whether an agent may summon is a permission.
- **Ask** in Agents is one agent sending a prompt to another and waiting. An ask in Tracker is a question put to a
  person.
- **Subagent vs child:** a subagent (Agents) is an agent another agent summoned, and its process is a child (Program)
  linked to its parent.
- **Agents' updates are not spans.** The core makes a span per turn and per tool call with no text in it; the text is
  in the session's updates, which `@kalfa/agents/ledger` keeps on the session's own stream.
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
- **Admission** means two things: in CI, a waiting build getting a free slot; in the Ledger, a rule
  that lets an entry in or refuses it, inside the append.

## Open clashes

Borders that are still fuzzy, one line each.

- **Frame:** in Transport, one piece of text on a socket; Clients and Frame uses it for the window around
  a program, which gets its own word (a lean: chrome) when that glossary is written.
- **Conversation vs Tracker:** Conversation carries a message and the app decides it is an ask; an
  ask in chat and an ask in the inbox may still be one thing.
