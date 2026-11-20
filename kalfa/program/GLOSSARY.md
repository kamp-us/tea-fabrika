# Program

What a program is, how it runs as processes, and what happens when one fails. Only words a program's author sees are here; how tea runs a program underneath is tea's.

## Language

**Program**:
A named piece of work, written `Program.make(name)(fn)`.
_Avoid_: Machine, actor

**Process**:
One running copy of a program, started with its flags, with its own state. One program can have
many processes.
_Avoid_: Instance, run

**Flags**:
The values a process is started with. They stay fixed for the process's whole life.
_Avoid_: Config, options, params

**Init**:
What runs once when a process starts, and makes its first state. If it fails, the process does not
start.
_Avoid_: Setup, constructor

**State**:
What a process remembers between messages. It is private to that process.
_Avoid_: Model, store

**Input**:
The stream a process reads, declared with `Program.inputs`.
_Avoid_: Event stream, mailbox

**Message**:
One value that comes from the input stream.
_Avoid_: Msg, event, command, letter

**Output**:
What a process shows from its state, declared with `Program.outputs`.
_Avoid_: View, render, result

**Error**:
A typed failure, sent on the `errors` pipe. The process keeps going.
_Avoid_: Exception

**Defect**:
A failure no type expects. It stops the process.
_Avoid_: Crash, panic

**Step**:
Handling one message, from the message to the new state. A confirmed step never runs twice.
_Avoid_: Tick, update, reduce, turn

**Supervisor**:
The service a stopped process asks: restart, or stop.
_Avoid_: Watchdog, manager

**Recovery**:
After a crash, a process getting back its saved state and running again only the steps that had
not finished. Nothing is replayed from the start.
_Avoid_: Replay, rebuild, restore

**Journal**:
Where a process's steps are saved, so a confirmed step never runs twice. A program asks for one,
and the app gives it a backend, such as a ledger.
_Avoid_: Journal driver, journal store, log
