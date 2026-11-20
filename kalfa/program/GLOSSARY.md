# Program

What a program is, how it runs as processes, and what happens when one fails. Only words a program's author sees are here; how tea runs a program underneath is tea's.

## Language

**Program**:
A named piece of work, written `Program.make(name)(fn)`.
_Avoid_: Machine, actor

**Process**:
One running copy of a program, started with its args, with its own state. One program can have
many processes.
_Avoid_: Instance, run

**Args**:
The values a process is started with, declared with a schema. They stay fixed for the process's
whole life.
_Avoid_: Flags, config, options, params

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

**Restart policy**:
How often and how soon a stopped process starts again, given where the program is supervised.
When it runs out, the process stops and waits for a person.
_Avoid_: Retry policy, backoff

**Supervisor**:
The service that records each restart and each stop of a supervised process. It does not decide
them; the restart policy does.
_Avoid_: Watchdog, manager

**Recovery**:
After a crash, a process getting back its saved state and running again only the steps that had
not finished. Nothing is replayed from the start.
_Avoid_: Replay, rebuild, restore

**Journal**:
Where a process's steps are saved, so a confirmed step never runs twice. A program asks for one,
and the app gives it a backend, such as a ledger.
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
