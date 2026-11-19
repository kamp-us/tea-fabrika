# Program

What a program is, how it runs, and how running programs talk. The words follow Erlang/OTP and the
Elm architecture, which tea is. Settled with the owner on 2026-11-18, one at a time.

| Term | Definition | Not |
|---|---|---|
| Program | The definition of one job: its state, how it changes on each message, and what it asks for. | Machine, service, actor, app |
| Process | One running copy of a program, with its own state and its own mailbox. | Instance, run, job, worker |
| Message | What one process sends another, taken from the mailbox one at a time. | Letter, event, mail, signal |
| Supervisor | A process that starts other processes and restarts them when they crash, by OTP's restart rules (one-for-one, one-for-all, rest-for-one). | Watcher, manager, host |
| Mailbox | Where a process's incoming messages wait, in order, until it takes the next one. | Inbox, queue |
| Journal | A program's record that tea replays on boot. tea defines its driver; the ledger provides one. | Log, history |
| Trace | A program's spans: what each part took, which model ran, what it cost. It lives in its own storage, never on the ledger. | Journal, log, telemetry stream |
| Command | One bounded job a process asks for, such as fetching a page or running an agent session. Its answer comes back to the process as a message. | Cmd (tea's spelling in code), effect, task, job, activity |
| Subscription | A standing source of messages a process listens to, such as a timer, a webhook or a ledger stream. In Ledger, a subscription is a stream's live read; a process's subscription may wrap one. | Sub (tea's spelling in code), listener, watch |
| Update | A program's one function that takes its state and one message, and gives back the new state and any commands. | Handler, reducer, step |
| Recovery | A process getting its state back from its journal when it starts again, by whatever way the journal driver does it. | Replay, rehydrate, rebuild, restore, boot |
| State | A process's current data, which only its update changes. | Model, store, context |
| Pending command | A command a process asked for whose answer has not come back yet. | Owed, in flight, outstanding |
| Registry | The place that finds a running process by its name. | Directory, lookup, router |
| Name | What a process is found by in the registry. One name points at one process at a time. | Address, handle, id |
| Monitor | One process watching another: when the watched one stops, the watcher gets a message saying why. | Watch, observer |
| Link | Two processes tied together: when one crashes, the other stops too, unless it chose to turn that into a message. | Bond, binding |
