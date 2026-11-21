# CI

Running builds of commits, and choosing which builds start first when there is not room for all of them. CI knows
commits, never change requests, incidents or tests.

## Language

**Build**:
One CI execution for one commit. CI does not know whether the commit is a change candidate, a changeset or main's
head; it knows only the commit.
_Avoid_: run, workflow run, pipeline, CI run

**Job**:
One piece of a build that passes or fails on its own. Which jobs a build has is a setting, or the asker's choice.
_Avoid_: leg, shard, step, check

**Build request**:
An ask for one build: one commit and one priority class, and the jobs to run when the asker picks them. Every build
starts from one. A build the host starts by itself, such as on a push to main, is turned into a build request whose
class comes from triage, unless triage answers not needed.
_Avoid_: trigger, event, dispatch

**Request id**:
The asker's own name for one build request. Asking again with the same request id gives the same build; a new
request id is a new build.
_Avoid_: build key, idempotency key, token

**Passed**:
The build ended and every job that counts passed. Which jobs count is a setting.
_Avoid_: green, success, ok

**Failed**:
The build ended and a job that counts failed, or ran past its time limit.
_Avoid_: red, failure, broken

**Canceled**:
The build was stopped because something chose to stop it: its asker, a person, a preempt, the floor, or triage. A canceled
build keeps which one stopped it, and CI does not start it again. Running past a time limit is failed, never canceled.
_Avoid_: aborted, killed, cut off, timed out

**Verdict**:
A build's answer: passed or failed. A canceled build, or one still going, has no verdict, and never counts as either.
_Avoid_: status, result, conclusion, outcome

**Ending**:
How a build is over: passed, failed or canceled. An ending never changes.
_Avoid_: result, conclusion, final status

**New build**:
Running the same commit again makes a new build; it never adds an attempt to the old one. Both builds stay on record,
each with its own ending.
_Avoid_: retry, attempt, rerun

### Choosing what starts first

**Priority class**:
The rank a build request carries, such as fix, main or normal. The asker picks the class; CI's setting ranks the
classes, and a higher class starts first. A build's class never changes; to change it, the asker cancels the build
and asks again.
_Avoid_: priority level, lane, urgency

**Triage**:
Answering a build the host started by itself: it gets a priority class, or it is not needed. Every triage rule is
asked. Any not needed wins; otherwise the highest class a rule gave; otherwise a setting answers.
_Avoid_: classifier, class rule

**Triage rule**:
One answer to triage that an app adds, such as a fix's build gets the fix class. A rule answers a class, not
needed, or nothing. The order the rules are listed in means nothing, and a rule that cannot read its facts answers
nothing.
_Avoid_: triager, classifier, handler

**Not needed**:
Triage's answer for a build whose commit already has its verdict, such as the build a host starts when a landed
change request's branch is moved. CI cancels the build on arrival, with triage as what stopped it and the rule's
reason kept. The answer is for the push, so the host running that build again is canceled again; a build request
is never triaged.
_Avoid_: skipped, duplicate, wasted, ignored

**Slot**:
Room for one build to run. How many slots there are is a setting. A build the host started by itself runs and is
counted even when no slot is free.
_Avoid_: runner, worker, concurrency

**Admission**:
A waiting build gets a free slot and starts. A waiting build of a higher class is admitted before one of a lower class.
_Avoid_: queue, schedule, enqueue

**Preempt**:
A waiting build of a higher class cancels a running build of a lower class to take its slot. Whether a class may
preempt is a setting.
_Avoid_: kill, abort, bump

**Floor**:
A priority class the app sets and lifts. While it is set, no build below it is admitted, and setting it cancels every
waiting and running build below it.
_Avoid_: freeze, flush, drain, hold, cancel below a class
