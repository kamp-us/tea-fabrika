# A program's processes are managed as OTP manages them

`@kalfa/program` manages processes with Erlang/OTP's model and words, and unix's where they match: a process name and
a pid, an exit reason, `monitor`, `link`, an exit signal, `whereis`, `start_child` and `terminate_child`. We chose this
because Program is process management spread over many places, OTP is the best-known working answer to that, and a
reader who knows OTP can then read Program. It differs from OTP in five places. There is no `trap_exit` flag: a
program traps exits by listing the exit message among its inputs, so a trap can never be set with nobody handling it. A
takeover keeps the pid, because it is one life moving to another place, so no monitor or link sees it. Nothing in
the core checks who may monitor, link, signal or start: the app pipes the Permissions guard on each call. A timer
(`startTimer`, `cancelTimer`) has no target and no message of its own: a process sets only its own, and the timeout
carries the timer's ref and its time. And a timer lives with the state saved in the journal, not with the pid, so
saved state never holds a ref to a dead timer.

## Considered Options

- Read an `exited` entry from the ledger in place of saved monitors, with no links and no children service: rejected,
  because a name alone cannot tell one life from the next, and each app would write its own start and stop.
- Monitors without links, as OTP advises for most application code: rejected, because ending together is part of the
  model and supervision is described with it.
- Keep "stopping adds no API" everywhere: rejected, because a process in another place has no input stream or fiber
  the sender can reach. It still holds inside one place.

## Consequences

A program in another place is stopped with an exit signal, `shutdown` or `kill`, which amends the earlier ruling that
stopping adds no API. The exit reason `taken_over` is seen only in the Supervisor's records. An app that forgets the
guard lets any sender monitor, link, signal and start, as OTP itself does. `Program.supervise` keeps its shape; whether
it is built on links underneath is the build's choice. There is no repeating timer: the program sets the next
one when a timeout arrives. A timer that fell due while the process was down fires once, late, at the next start. A
process that wants to wake another sends it a message. `kalfa program ps` shows each process's next timeout, read from its journal, and
shows none for a process whose journal is in memory.
