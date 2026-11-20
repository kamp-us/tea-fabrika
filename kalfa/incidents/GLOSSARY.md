# Incidents

A time something is broken badly enough that landing changes until it ends: how one opens, how bad it is, what it
makes others do, and how it ends. Which levels exist and what each makes others do is a setting in the project's kalfa
config.

## Language

**Incident**:
A time something is broken badly enough that landing changes until it is resolved. Many may be open at once.
_Avoid_: sev (as a noun), outage, emergency

**Severity**:
How bad an incident is, one of the levels the project's config lists, such as sev0 or sev1. It may move while the
incident is open.
_Avoid_: priority, level, urgency

**Escalate**:
An open incident's severity goes up, by a rule in config or by a person. Which severities a rule may raise to is a
permission.
_Avoid_: upgrade, raise, bump

**De-escalate**:
An open incident's severity goes down, by a rule in config or by a person.
_Avoid_: downgrade, lower, step down

**Response**:
What a severity makes other contexts do while its incident is open, such as a hold or fixes first.
_Avoid_: policy, playbook, mode

**Declare**:
A person opens an incident at a severity. Who may declare which severity is a permission.
_Avoid_: call, raise, page, open by hand

**Alert**:
What a check or another context saw that may need an incident, such as a broken main or a test failing again and again.
It opens an incident, joins an open one, or resolves one. Which alerts exist, what severity each opens and which fold
together is a setting.
_Avoid_: signal, alarm, trigger, event

**Broken main**:
Main's own build failed after a landing, as CI tells it. It raises an alert.
_Avoid_: red main, main is red, main is down

**Fix**:
A change request named as the fix for an open incident. Delivery puts it at the front of the queue.
_Avoid_: hotfix, revert, urgent

**Commander**:
The one who runs an incident: names its fixes and decides when a declared one is over. The first person to acknowledge
becomes it.
_Avoid_: IC, lead, owner, on-call

**Resolve**:
An incident ends: by its alerts when an alert opened it, by its commander or the owner when a person declared it.
_Avoid_: close, call off, recover

**Write-up**:
The account an incident leaves behind once resolved: what broke, each severity and when, each fix, what it cost, what
was learned.
_Avoid_: postmortem, retro, RCA, report

### Telling people

**Page**:
Tell a person an incident needs them, through Conversation.
_Avoid_: notify, alert someone, ping

**Acknowledge**:
A paged person says they have the incident, and becomes its commander.
_Avoid_: ack, accept, claim

**Paging rule**:
The setting that says who is paged for an incident, in what order, and how long to wait before paging the next one.
_Avoid_: escalation policy, on-call schedule, rota

### An incident's steps

**Open**:
Declared, or opened by an alert, and nobody has acknowledged it yet.
_Avoid_: triggered, new, firing

**Acknowledged**:
A commander has the incident.
_Avoid_: acked, assigned, in progress

**Resolved**:
The incident has ended. A severity move changes no step.
_Avoid_: closed, done, fixed
