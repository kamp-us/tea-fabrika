# Program

What a program is, how it runs as processes, and what happens when one fails. Only words a program's author sees are here; how tea runs a program underneath is tea's.

## Language

**Program**:
A named piece of work, written `Program.make(name)`.
_Avoid_: Machine, actor

**Process**:
One running copy of a program, started with its args, with its own states. One program can have
many processes.
_Avoid_: Instance, run

**Args**:
The values a process is started with, declared with a schema. They stay fixed for the process's
whole life.
_Avoid_: Flags, config, options, params

**Init**:
What runs once when a process starts, before its first message. It can set states. If it fails, the
process does not start. A program can have none.
_Avoid_: Setup, constructor

**State**:
One named thing a process remembers between messages, declared once with its schema and its first
value. Each process has its own value, private to that process.
_Avoid_: Model, store

**Input**:
The stream a process reads, declared with `Program.inputs`.
_Avoid_: Event stream, mailbox

**Message**:
One value that comes from the input stream.
_Avoid_: Msg, event, command, letter

**Output**:
What a process shows from its states, declared with `Program.outputs`.
_Avoid_: View, render, result

**Error**:
A typed failure of a step. What the step wrote is dropped, the failure is reported, and the process
keeps going.
_Avoid_: Exception

**Defect**:
A failure no type expects. It stops the process.
_Avoid_: Crash, panic

**Step**:
Handling one message. What it writes to states is kept together when it ends well, and dropped when
it fails. A confirmed step never runs twice.
_Avoid_: Tick, update, reduce, turn

**Restart policy**:
How often and how soon a stopped process starts again, given where the program is supervised.
When it runs out, the process stops and waits for a person.
_Avoid_: Retry policy, backoff

**Supervisor**:
The service that records each restart and each stop of a supervised process. It does not decide
them; the restart policy does.
_Avoid_: Watchdog, manager

**Recovery**:
After a crash, a process getting back its saved states and running again only the steps that had
not finished. Nothing is replayed from the start.
_Avoid_: Replay, rebuild, restore

**Journal**:
Where a process's steps are saved, so a confirmed step never runs twice. Every process has one,
and the app always picks its backend: memory, which is lost at a restart, or a ledger, which is
kept. Nothing is picked by default.
_Avoid_: Journal driver, journal store, log

**Tool**:
One named piece of outside work a step can use, such as posting a comment or starting a build,
declared once with what it takes, what it answers and how it can fail. Its answer is saved, so a
step that runs again gets the saved answer instead of doing the work again, and it hands the work a
key, so the outside side can tell a repeat.
_Avoid_: Activity, work, side effect, call

**Deferred tool**:
A tool whose answer comes later, as a message to the program, such as a build's verdict. Until the
answer arrives, the hand-off is sent again on each wake. A hand-off failure the tool lists as an
error is the answer; any other failure is tried again.
_Avoid_: Ask, owed tool, callback

**Opened input**:
A kind of message a program lets an agent send as a tool, named when that agent's tools are made.
Nothing is opened by default, and a message that is not opened is one the agent cannot send.
_Avoid_: Exposed input, allowed tool, person-only input

**Taken over**:
How a process ends when the same process is opened again somewhere else. The newest open owns the
journal, counted by opens and never by clock; the older copy's next save is refused as stale, and it
stops without a restart.
_Avoid_: Kicked, evicted

**Process name**:
The name a process is started under, picked by whoever starts it: one or more parts joined by `/`,
such as `tracker:1` or `ada/scout`. It says who, not where and not which program, and it stays the
same across restarts and a takeover.
_Avoid_: Address, handle, key

**Pid**:
The id of one life of a process, from its start to its exit. A restart under the same process name
is a new pid.
_Avoid_: Process id, instance id, run id

**Exit reason**:
Why a process ended: `normal`, `shutdown`, `killed`, `defect` or `taken_over`. A defect's reason
names the error's class, never its message. A monitor or a link on a name with no live process is
answered with the reason `noproc`.
_Avoid_: Exit code, status, cause

**Exit signal**:
What one process sends to end another: `shutdown` asks it to stop, `kill` stops it at once.
_Avoid_: Stop request, cancel

**Monitor**:
One process's watch on another's pid. When that pid ends, the watcher gets one message with the
exit reason. The watched process is not told.
_Avoid_: Watch, subscription, listener

**Link**:
A tie between two processes: when one ends for a reason other than `normal`, the other ends too,
unless it traps exits. A program traps exits by listing the exit message among its inputs; `kill`
cannot be trapped.
_Avoid_: Bind, pair

**Child**:
A process another process started. The one that started it is its parent.
_Avoid_: Subprocess, worker

**Registry**:
The list of live processes: each process name with its pid and its place.
_Avoid_: Directory, process table, lookup

**Place**:
Where a process runs, such as one browser tab or one server. The app names its places; a program
never reads one.
_Avoid_: Host, node, location

**Timer**:
A process's ask to get one message at a set time. It is saved with the process's state and lives as
long as that state. A process sets only its own.
_Avoid_: Alarm, wake-up, deadline, schedule

**Timeout**:
The message a timer sends when its time comes, with the timer's ref and the time it was set for. It
never comes early. After the process was down it comes late, once.
_Avoid_: Tick, alarm
