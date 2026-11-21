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
An open incident's severity goes up, by an escalation rule, by a person, or by a worse alert joining. Which severities
a rule or a person may escalate to is a permission.
_Avoid_: upgrade, raise, bump

**Escalation rule**:
The setting that escalates an incident from one severity to another after it has been open, or acknowledged, for a
set time. A rule with no permission moves nothing: the refusal is recorded and the people of the severity it wanted
are paged.
_Avoid_: escalation policy, timeout, auto-escalate

**De-escalate**:
An open incident's severity goes down, by a person. No rule de-escalates.
_Avoid_: downgrade, lower, step down

**Response**:
What a severity makes other contexts do while its incident is open, such as a hold or fixes first. A setting names
each severity's responses. The responses in force are those of every open incident together.
_Avoid_: policy, playbook, mode

**Responder**:
The part that carries out one response in another context, such as the one that tells Delivery about a hold. A
response with no responder is refused at start.
_Avoid_: handler, listener, hook

**Declare**:
A person opens an incident at a severity. Who may declare which severity is a permission. A declared incident may
name a group, so that group's alerts join it.
_Avoid_: call, raise, page, open by hand

**Alert**:
What a check or another context saw that may need an incident, such as a broken main or a test failing again and again.
It has a name and a key that says what is broken, and it is firing or cleared. Whoever saw it does the counting and
decides when it fires. It opens an incident, joins an open one, or resolves one. Which alerts exist, what severity each
opens and which group each is in is a setting.
_Avoid_: signal, alarm, trigger, event

**Group**:
The alerts that fold into one incident. A group has at most one open incident: a firing alert joins it, or opens one.
_Avoid_: bucket, cluster, service

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
An incident ends. One that an alert opened ends when every alert in it has cleared. The commander or the owner may end
any incident. An alert that fires after that opens a new incident.
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
A person says they have the incident. The first one to do so becomes its commander. Who may acknowledge is a
permission.
_Avoid_: ack, accept, claim

**Paging rule**:
The setting that says, for one severity, who is paged, in what order, how long to wait before paging the next one, and
how many times to go through the list. Paging stops at the first acknowledgment.
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
