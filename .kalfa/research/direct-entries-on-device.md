---
summary: For every write subcommand the kalfa package designs name (Incidents declare, acknowledge, fix, resolve and learned; Delivery ready and withdraw; Reconciliation reconcile and adopt; Identity accept; Secrets as the stated exception; Agents, which has none), what the program reads to turn the message into entries, whether the device has it with the app down, and which sort each command falls in (buildable on the device, buildable only if the Ledger can be read from far away, or not buildable and what is missing); every claim quoted from the design with its issue URL, and every gap named
---

# Can every write command build its entries on the device, with the app down?

Question (ticket https://github.com/kamp-us/tea-fabrika/issues/1872): decision 0075
(`.kalfa/decisions/0075-a-direct-entry-is-a-case-of-identitys-sender.md`) says that on a `--direct` write the package turns
its message into entries with a plain function on the device, the same one its program uses, and Program's command-line
helper only signs and appends. Nobody had checked that this works for every write command. This note checks it against the
designs.

Read on 2026-11-21. Sources are the closed design tickets under the suite map
(https://github.com/kamp-us/tea-fabrika/issues/1706), the two walks on who a command acts as
(https://github.com/kamp-us/tea-fabrika/issues/1852) and on presence (https://github.com/kamp-us/tea-fabrika/issues/1854),
decisions 0072, 0073, 0074 and 0075 in `.kalfa/decisions/`, and the glossaries (`kalfa/*/GLOSSARY.md`). Nothing was built,
typed or run. A line marked "my reading" is mine, not the design's. Where a design is silent, this note says "the design
does not say".

A note on numbers: the rule this ticket checks is decision 0075. Decision 0074 is a different one (where a laptop keeps
its key). It matters here only because the direct write is signed with that key.

## The short answer

1. **No guarded write command can be built from its message alone.** Every one of them needs something the message does
   not hold. The five Incidents commands and Delivery's `withdraw` need the stream's current state. That is the "needs to
   read the Ledger first" case, and it is open (https://github.com/kamp-us/tea-fabrika/issues/1862).
2. **Three commands need more than the Ledger.** Delivery's `ready` needs the host's view of the change request.
   Reconciliation's `reconcile` needs the host's live state, the config file as main has it, and a host write between two
   of its entries. Reconciliation's `adopt` needs git and the host, and the design does not say what entries it writes. For
   these three the design does not say that the device has a host login, so they sort as "cannot, and what is missing".
3. **Two commands fall outside the question.** `kalfa identity accept` builds a signed change on the device by design, but
   it is the way in, not a guarded write. `kalfa secrets` is the stated exception.
4. **Agents has no write subcommand.** Its design names two, `check` and `sessions`, and both only read. One table in the
   walk on who a command acts as lists Agents' command-line entry point among the write ones. The two do not match.
5. **Decision 0075 already half-answers this.** Its last consequence says: "A write that needs the app's live state to
   build its entries cannot be done direct." If the Ledger counts as the app's live state, then the first two groups above
   cannot be done direct today. Whether it counts is the question in 1862. Confidence in this reading is about 80%.

| Command | What the program reads that the message does not hold | Sort |
|---|---|---|
| `kalfa incidents declare` | the incident set (group, id), the settings | needs the Ledger first |
| `kalfa incidents acknowledge` | the incident set (does it exist, is it open, is there a commander) | needs the Ledger first |
| `kalfa incidents fix` | the incident set | needs the Ledger first |
| `kalfa incidents resolve` | the incident set (open alerts, commander) | needs the Ledger first |
| `kalfa incidents learned` | the incident set (does it exist) | needs the Ledger first |
| `kalfa delivery withdraw` | the queue (which run is current for this change request) | needs the Ledger first |
| `kalfa delivery ready` | the queue, and the host's view of the change request | cannot: no host access on the device is designed |
| `kalfa reconciliation reconcile` | the managed items, the host's live state, main's copy of the file, a host write in the middle | cannot: same gap, and one more |
| `kalfa reconciliation adopt` | git and the host; the entries it writes are not designed | cannot be sorted: the design does not say |
| `kalfa identity accept` | nothing from the app; the invite | built on the device, but not a direct case |
| `kalfa secrets generate`, `rotate` | the secret store | stated exception |
| `kalfa agents` | none: its commands only read | no write command |

## 1. What the rule asks for

The rule, from decision 0075:

> The package turns its message into entries with a plain function, the same one its program uses. No guarded service is
> called, so no permission proof is made or faked.
> Program's command-line entry point signs the entries with the command's client key and appends them to the app's Ledger.

The resolution on https://github.com/kamp-us/tea-fabrika/issues/1863
(https://github.com/kamp-us/tea-fabrika/issues/1863#issuecomment-7074392640) says the same in point 6: "On a direct write,
finished entries, built by a plain function the package's program also uses."

So the test for each command is: can the device run that plain function with what it has, and hand over finished entries?
The inputs to check are the ones the ticket names: the stream's state, a clock, an id the command makes, the host's API,
git, another package's service, a permission proof.

Two inputs are the same for every command, so they are said once here.

- **A permission proof is never needed on this path.** 0075 says "Every other direct entry passes with no permission
  check", and the plain function calls no guarded service. Every write call in the designs takes a `guard`, and that is the
  part the direct path skips. No command below is blocked by a missing proof.
- **A clock and an id.** The Ledger gives an entry its own time: its entry fields are "id, stream, revision, position,
  `arrivedAt`, `_tag`, body, metadata"
  (https://github.com/kamp-us/tea-fabrika/issues/1764#issuecomment-7050735307). The writer's clock "go[es] to Program"
  (same comment), so Program's helper sets it. The ids the commands need (an incident id, a ready id) are made by the
  caller: "`declare` takes an id the caller makes" (Incidents) and "The caller makes the ready id" (Delivery). A device has
  a clock and can make an id. The designs do not say which clock a direct entry carries, and a device clock may be wrong.
  That is minor next to the reads below.

## 2. Incidents

**Write subcommands.** The design says: "`kalfa incidents` ships in the package: `list`, `show`, `declare`, `acknowledge`,
`fix`, `resolve`, `learned`" (https://github.com/kamp-us/tea-fabrika/issues/1759#issuecomment-7068952807, ruling 14). Five
write. `list` and `show` only read. `escalate` and `deescalate` are calls on the handle, not commands.

**The message.** The design names no message type for a command. The nearest thing is the argument list of each call:
`declare({ id, severity, note, by, group? })`, `acknowledge(incident, { by })`, `fix(incident, change, { by })`,
`resolve(incident, { by })`, `learned(incident, text, { by })`. Decision 0072 says the program "lists that message in its
inputs".

**What the program reads to make entries.** The design says how a call runs:

> **Order.** The guard runs first, then one Ledger transaction checks the incident again and appends.

(same comment). The state it checks is `IncidentSet`: "two pure values: `IncidentSet`, folded from Ledger entries, and
`Due`". The pure function that comes closest to "message to entries" is `Facts.alert(set, settings, name, key, state)`,
"Result<what the call would append, UnknownAlert>; one per call". Its first argument is the set, folded from Ledger
entries. The design gives no such function by name for `declare`, `acknowledge`, `fix`, `resolve` or `learned`. It does
list each call's errors, and every one of those errors is decided from the set or the settings:

| Call | Errors the design lists | Decided from |
|---|---|---|
| `declare` | `UnknownSeverity \| IdReused \| GroupOpen` | the settings; the set |
| `acknowledge` | `NoSuchIncident \| IncidentResolved` (the result can be `AlreadyHeld`) | the set |
| `fix` | `NoSuchIncident \| IncidentResolved` | the set |
| `resolve` | `NoSuchIncident` | the set |
| `learned` | `NoSuchIncident` | the set |

Other inputs the design names:

- **Settings.** "A setting gives each alert name a severity and a group", and "Each entry that sets a severity carries that
  severity's responses" (rulings 2 and 5). The settings are a TOML file. Configuration reads "flag, environment variable,
  repo configuration, user configuration, default" in that order
  (https://github.com/kamp-us/tea-fabrika/issues/1749#issuecomment-7047836179). On a device with the repo checked out,
  the file is there. The design does not say which copy of the settings a direct declare should use (the device's or the
  app's).
- **Another package.** A fix "is named by Code hosting's change request id, a type-only import" (ruling 12). A type needs
  no service. The command takes the id from its argument. Whether the change request exists is not checked in the design.
- **Chat, CI, Delivery.** Pages, floors and holds follow entries after they are written ("Responders, pages and thread
  notes all follow entries already written"). The command builds none of that.
- **The commander.** "The first person to acknowledge becomes its commander" and "the commander or the owner may resolve"
  (rulings 4 and glossary `Acknowledge`). Who the commander is comes from the set. The permission to resolve is the guard's
  and is skipped on a direct write.

**On the device with the app down?** Settings: yes, if the repo file is there. An id and a clock: yes. A fix's change
request id: yes, from the argument. The set: the device has no Ledger of its own, and 0075 rejected one ("A Ledger on the
device, carried over when the app is back: rejected"). So the set is only reachable by reading the app's Ledger from
far away. That is https://github.com/kamp-us/tea-fabrika/issues/1862.

**Sort: all five need the Ledger read first.** One narrow point for `declare`: two of its three errors (`UnknownSeverity`,
and `IdReused` if the incident id is also the entry id) could be settled without the set. Only `GroupOpen` needs the set,
and only when a group is named. The design does not say that the incident id is the entry id, and the Ledger's own rule
("same id and same body gets the first answer; a different body is refused as `IdReused`") would only catch a repeat that
way. So a declare with no group might build from settings alone. The design does not say, and this note does not count it.

Direct writes also lose the atomic check. In the program the read and the append are one transaction ("one Ledger
transaction checks the incident again and appends"). A direct write reads, then appends. The design does not say what
happens when the set changes in between. The Ledger's design says an admission is "run inside the append's transaction"
(https://github.com/kamp-us/tea-fabrika/issues/1764#issuecomment-7050735307), and 0075 puts the signature and presence
checks there. The incident checks are the program's own, not an admission.

## 3. Delivery

**Write subcommands.** "`kalfa delivery` ships in the package: `queue`, `show`, `why`, `ready`, `withdraw`, `landings`.
... There is no `approve`; a person approves on the host."
(https://github.com/kamp-us/tea-fabrika/issues/1760#issuecomment-7069984199, ruling 23). Two write: `ready` and
`withdraw`.

### `ready`

**The message.** `AppDelivery.ready({ change, changeset, author }, id, { guard, discard? })`, where the id is the ready id
the caller makes.

**What the program reads.** Two things.

- **The queue.** "`Queue`, folded from Ledger entries, that does all the choosing." `IdReused` ("the same id with another
  change request or changeset"), `AlreadyReady` ("a new id while a run is still going") and the `Ended` refusal ("one that
  already ended") all come from it.
- **The host's view of the change request.** Ruling 2 says: "Refused at ready: no such change request, a draft, one that
  already ended, one aimed at another branch, or a changeset that is not the newest." Four of those five are the host's
  facts. They come from `ChangeRequests.snapshots(ref)` on Code hosting
  (https://github.com/kamp-us/tea-fabrika/issues/1760#issuecomment-7067355739). Ruling 1 softens one case: "A ready that
  names a changeset the host does not show yet also waits."

**Also not settled.** `author`: "Who is `author` when a person runs `kalfa delivery ready`? (lean: the app sets it from the
sender's linked host account; 70%)"
(https://github.com/kamp-us/tea-fabrika/issues/1760#issuecomment-7073446588). That is a drafting helper's lean, not a
ruling. If the app sets it, a direct write has no app to do so.

**On the device with the app down?** The queue: needs the Ledger read. The host: the design does not say that the device
holds a host login. Reconciliation's old ruling 9 said a person at the command acts "with their own host login", and
decision 0072 replaced that line. Identity keeps only an outside account's numeric id and "drops the token"
(https://github.com/kamp-us/tea-fabrika/issues/1766#issuecomment-7056626146). So there is no designed token on the device.

**Sort: cannot, as designed.** What is missing is the host's view of the change request on the device (and the Ledger
read). One open point: a direct `ready` could skip the host checks and write the entry, and the app's process would refuse
or wait on it when it returns. The design does not say whether a direct write may skip a check that is not a permission.
0072 says only "no guard runs".

One more thing the design does not say: `ready` normally returns the ending ("gets back the one ending: landed, failed,
replaced or withdrawn"). With the app down, no process builds or lands. What a direct `ready` prints is not designed.

### `withdraw`

**The message.** `AppDelivery.withdraw(change, { guard })`. It takes the change request, not the ready id.

**What the program reads.** The queue, to find the run that is current for that change request. The errors are
`NoSuchReady` and the result can be `Landed`. Ruling 15: "A withdraw that arrives while the push is in flight loses, and
the answer is Landed." Who wrote the entry is the Ledger's stamp, "so `withdraw` takes no person".

**On the device?** The queue needs the Ledger read. No host call is named. Nothing else is missing.

**Sort: needs the Ledger first.** (My reading: `withdraw` has no host dependency, so it is the cleanest of the
Ledger-reading commands.)

## 4. Reconciliation

**Write subcommands.** "The `kalfa reconciliation` command ships in the package ...: `check`, `reconcile`, `adopt`"
(https://github.com/kamp-us/tea-fabrika/issues/1758#issuecomment-7068417635, ruling 9). `reconcile` and `adopt` write.
`check` only reads. Whether `check` records its answers is open: "Does `kalfa reconciliation check` record its answers on
the Ledger? (lean: prints only; 75%)" (https://github.com/kamp-us/tea-fabrika/issues/1758#issuecomment-7073445077).

### `reconcile`

**The message.** The design does not rule. The lean is: "What does the reconcile message to the app carry? (lean: only
"reconcile now" with optional item names; 75%)" (same gaps comment). So the message would carry no live state at all.

**What the program reads.** More than any other command.

- **The managed items, from the Ledger.** "The state between runs is a pure value folded from Ledger entries"
  (`ManagedItems.fold(entries)`). It answers busy, fighting (the fight rule counts past reconciles) and "refused before".
- **The host's live state.** `CodeHost.get(Read.refRules(repo))` and `Read.hostSettings(repo)`, in the program's
  `LiveStateSource`. `send` "reads the item again first and does not send when the live state moved since the check
  (stale)".
- **Main's copy of the file.** Ruling 11: "`kalfa reconciliation reconcile` fetches the target branch and refuses with
  `reconciliation/not-main` unless the file's `[reconciliation]` part matches it". 0072 keeps this: "`kalfa reconciliation
  reconcile` takes it too and keeps its own check that the file matches main"
  (https://github.com/kamp-us/tea-fabrika/issues/1852#issuecomment-7071566192). That needs git and the network.
- **A host write between two entries.** "Order inside `send`: one Ledger transaction checks the item is free and appends
  the reconcile with the live value it replaces; then the write goes out; then how it ended is appended." The last entry
  says how the write ended, and the design makes an unclear write "ended by the next read". So the entries are not all
  known before the write. A plain function from a message to a finished list of entries does not fit this shape. That is a
  finding about the shape, not about the missing inputs. Point 6 of the 1863 resolution says "finished entries".

**On the device with the app down?** The file and git: yes if there is a checkout and network. The Ledger: needs the read.
The host: the design does not say there is a login on the device. The host write after the first entry: the design does not
say a direct `reconcile` may make it.

**Sort: cannot, as designed.** It is missing the host on the device, and a plain entries function that covers a host write
in the middle. It also needs the Ledger read.

### `adopt`

**What it does.** Ruling 3: "It edits the kalfa config with `SettingGroup.set`, commits on a branch with `@kalfa/git` and
opens with `ChangeRequests.openOrFind`." The call is `Repo.adopt(adoption)` with `MayAdopt` and `CodeHost` in its
requirements.

**What entries it writes.** The design does not say. The open question is: "Is an adopt recorded on the Ledger? (lean: yes;
60%)" (gaps comment above). Ruling 4 says "Everything is on the Ledger" and names check answers and reconciles only.

**Its reads.** The check answer it starts from comes from the desired state (a file), the live state (the host) and
`Repo.compare`, which is "pure, no host and no ledger". Git needs "read one file's text at a commit, and write a commit with
one file's text replaced, no working copy", marked as a confirmed need on Git (gaps comment above). The 1863 resolution
names "its proof on `send` and `adopt`" as one of the gaps it answers.

**Sort: cannot be sorted from the design.** If adopt writes no entry, there is nothing to build direct. If it writes one,
the inputs are git and the host, not the Ledger. The design does not say which. In both cases the device would need a host
login to open a change request, and the design does not say it has one.

## 5. Identity: `kalfa identity accept`

**What it is.** "a new `/cli` entry point gives `kalfa identity accept`"
(https://github.com/kamp-us/tea-fabrika/issues/1766#issuecomment-7071567026). It is the one step a device needs, "once"
(https://github.com/kamp-us/tea-fabrika/issues/1852#issuecomment-7071566192, ruling 3). It picks the client key's store
and saves the route in the user configuration (https://github.com/kamp-us/tea-fabrika/issues/1766#issuecomment-7074394873).

**What it reads.** The change is built on the client: `Signed.make(change, signer)` is "the client signs", over "exact
bytes (schema-ordered JSON plus a line feed) and naming the project". The invite is "a one-time link, also a QR code". The
refusal is `project.apply`, a pure rule in the app's admission. So building the signed change needs the invite and the
device's own key, both on the device.

**Why it is not a direct case.** A direct entry needs a key already in: "Identity's admission checks ... that the key is
still in" (0075). A device running `accept` has no granted key yet. The design says how this reaches the app only as a
lean: "How does `kalfa identity accept` reach the app with a key not granted yet? (lean: it signs in and waits at the
gateway; 55%)" (https://github.com/kamp-us/tea-fabrika/issues/1766#issuecomment-7073444874). A human already in must also
grant the key, and that is a second signed entry from another device. The design does not say whether `accept` takes
`--direct`. My reading: it cannot, since a key that is not in cannot sign a direct entry.

**Sort: the change is built on the device by design. The direct question does not apply.**

## 6. The stated exception: `kalfa secrets`

"`kalfa secrets` is the one exception. It talks to the secret store, and the store's own login gates it"
(`.kalfa/decisions/0072-a-write-command-goes-through-the-running-app.md`). Its commands are `names`, `generate`, `rotate`
and `public-half` (https://github.com/kamp-us/tea-fabrika/issues/1752). One loose end for this ticket: "The `kalfa secrets`
command takes no proof ... The record is still written", and the open question is "What does `kalfa secrets` record, with
which recorder and sender?". So `generate` and `rotate` may still write a Ledger entry through the Recorder. The design does
not say whether that entry needs the app up, or whether `--direct` applies to it.

## 7. Packages with no write command, or none that writes entries

| Package | What its designs say | Source |
|---|---|---|
| Agents | `./cli` is `kalfa agents check` and `kalfa agents sessions`. Both only read. | https://github.com/kamp-us/tea-fabrika/issues/1784#issuecomment-7069956992 |
| Chat | "No `./cli` subcommand." | https://github.com/kamp-us/tea-fabrika/issues/1757#issuecomment-7068087199 |
| CI | `kalfa ci paths` and a build lookup. Both read. | https://github.com/kamp-us/tea-fabrika/issues/1756 |
| Code hosting, Source control, `@kalfa/github`, Ledger, Transport, Permissions | the designs name no `kalfa` subcommand | their protocol tickets, 1755, 1750, 1753, 1764, 1767, 1768 |
| Leak guard | the package was dropped; a `kalfa leak-guard` command "fall[s] away with the package" | https://github.com/kamp-us/tea-fabrika/issues/1754 |
| Telemetry | `kalfa trace <id>` prints a tree. It reads. | https://github.com/kamp-us/tea-fabrika/issues/1775#issuecomment-7068738060 |
| Records | `kalfa records` lists and checks. It reads. | https://github.com/kamp-us/tea-fabrika/issues/1761 |
| Quality | `kalfa quality stryker plant`, `survey` and `text` work on files and run a test tool. No Ledger entry. | https://github.com/kamp-us/tea-fabrika/issues/1763#issuecomment-7049702827 |
| Configuration | `kalfa config get \| set \| remove ...` edits a settings file on disk. No Ledger entry. | https://github.com/kamp-us/tea-fabrika/issues/1749#issuecomment-7047836179 |
| Program | `kalfa program ps`, `kill <name>` and `mcp <process name>`. | https://github.com/kamp-us/tea-fabrika/issues/1782#issuecomment-7069055763, https://github.com/kamp-us/tea-fabrika/issues/1817 |

Notes on the rows that look like writes:

- **Agents.** Decision 0072 does not list Agents. The walk's entry-point table does: "`@kalfa/incidents/cli`,
  `@kalfa/reconciliation/cli`, `@kalfa/agents/cli` | write subcommands send a message; a setting names the process;
  `--direct`" (https://github.com/kamp-us/tea-fabrika/issues/1852#issuecomment-7071566192). The same walk's last open
  point says: "Which of `kalfa agents`' subcommands write. Today's two (`check`, `sessions`) only read." So the table's
  row has no command behind it today. Summon and dismiss are "its own line" in the shell, not `kalfa` subcommands:
  "`summon <agent> [model] [effort] as <name> [on <hands>]` ... always its own line"
  (https://github.com/kamp-us/tea-fabrika/issues/1784#issuecomment-7069956992 and the settled input before it). Whether a
  summon from a `kalfa` command is ever wanted, and whether it could be direct, the design does not say.
- **Configuration.** A `set` changes a file on the device. The walk says "A command that only reads stays on the device"
  and a write goes to the app. A settings file is not the app's state. The design does not say whether `config set` is a
  "write command" in 0072's sense. It builds no entries, so this question does not apply to it.
- **Program.** `kalfa program kill` "sends `shutdown`, or `kill`" to a process in the registry. That is a signal to a
  running process, so the app has to be up. The design does not say it writes an entry from the device. `kalfa program mcp`
  is the dial-in pipe that sends a message; it is the same helper the write commands use, not one of them.

## 8. Three things the designs leave open that every command shares

1. **How the helper reaches the store with no gateway.** 0075 says a direct entry goes "straight into the app's own Ledger".
   Its resolution says: "How the helper reaches the store with no gateway. That is the same reach as [1862]". The Ledger
   protocol's `read` and `append` exist, but the designs do not say who may call them from a device. My reading: the door a
   direct append uses might also serve a read, and then the "needs the Ledger first" commands become buildable. The
   designs do not say that, and https://github.com/kamp-us/tea-fabrika/issues/1871 asks whether the store answers at all
   while the app's process does not.
2. **Which stream, which entry id.** A direct entry must land in the right stream with the right id. The designs say the
   Ledger "never takes the same id twice" (0073) but not who picks the stream or entry id on a direct write. The plain
   function would have to, and no design shows it.
3. **Whether the plain function exists.** 0075 says the program "also uses" it. The designs show `Facts.alert` (Incidents)
   and `Queue.apply(queue, entry, settings)` (Delivery, "Result<{ queue, work }, BadEntry>") as pure values, and `Repo.compare`
   and `checks.reconciles` (Reconciliation) as pure. None of them is shaped "message in, entries out". Each takes the
   folded state as an argument. That is why the state is the whole question.

## What this cannot tell us

- Whether the Ledger can be read from a device with the app down. That decides the whole first group (six commands).
  Tickets 1862 and 1871 hold it.
- Whether a device has a host login. The designs never say. It decides `ready`, `reconcile` and `adopt`.
- Whether a direct write may skip a check that is not a permission (a refused `ready` for a draft, say), and whether it may
  skip the check-then-append atomicity. 0072 says "no guard runs", and 0075 says "no permission check". Neither speaks to
  these.
- What entries `adopt` writes, what a direct `ready` prints, and whether `kalfa secrets` writes a record with the app down.
- Whether any command's entries really can be built by a pure function, since no design shows one shaped message in,
  entries out. Nothing was built, typed or run, and this note read the designs only, never the code in `next/` or `kalfa/`.
- The messages themselves. The designs name no message type for any command, so the "message" column is the call's
  argument list, which is my reading.
- Comments added to these tickets after 2026-11-22 04:49 UTC were not read, except the correction on decision numbers.
