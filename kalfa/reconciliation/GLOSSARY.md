# Reconciliation

Keeping live things the way a file says they should be: comparing the two, reporting where they differ, and fixing it.

## Language

**Managed item**:
One thing that has a written desired state and a live state, such as a repo rule or a repo setting.
_Avoid_: resource, object, setting, target

**Desired state**:
What the project's kalfa config says a managed item should be. It changes only through a change request.
_Avoid_: spec, target, config

**Absent**:
A desired state that says a managed item should not exist. It is the only way an item is ever removed.
_Avoid_: removed, deleted, destroyed, tombstone

**Live state**:
What a managed item is right now, as the system that holds it says.
_Avoid_: actual, current, status

**Live state source**:
The adapter that reads, and may write, the live state of one kind of managed item.
_Avoid_: provider, backend, driver

**Unmanaged item**:
Something live that no desired state names. It is reported, and never changed or deleted.
_Avoid_: orphan, extra, unknown item

### A check and its answers

**Check**:
Comparing the desired state with the live state and reporting the drift. It changes nothing.
_Avoid_: plan, diff, audit, scan

**Drift**:
A field the desired state names whose live value differs from it. A named list is compared whole.
_Avoid_: diff, mismatch, out of sync

**Read-only field**:
A field the live state source can read and cannot write. Its drift is reported and never reconciled.
_Avoid_: locked, immutable, unwritable

**Missing**:
A check's answer for an item the desired state names and the live state source does not find.
_Avoid_: not found, gone, deleted

**Still live**:
A check's answer for an item whose desired state is absent and that is still there.
_Avoid_: unwanted, leftover, stale

**Looks renamed**:
A check's answer for a missing item when an unmanaged item is the same in every named field. Nothing is created.
_Avoid_: duplicate, moved, clash

**Unknown**:
A check's answer when the live state could not be read. It never means no drift: a source that could not read says so,
and never answers with an empty live state.
_Avoid_: no drift, empty, skipped, passed

### Reconcile and how it ends

**Reconcile**:
Changing the live state so it matches the desired state: writing drifted fields, creating a missing item, or removing
one that is still live. Whether drift is reconciled or only reported is a setting for each managed item, and the
default is report.
_Avoid_: apply, sync, enforce, fix

**Busy**:
Why a reconcile was not sent: another reconcile of the same item has not ended.
_Avoid_: locked, in progress, claimed

**Stale**:
Why a reconcile was not sent: the live state changed after the check it came from.
_Avoid_: outdated, expired, conflict

**Fighting**:
Why a reconcile was not sent: the same item was reconciled too many times in a short while, so something keeps
changing it back. A person decides.
_Avoid_: flapping, loop, thrashing

**No proof**:
Why a reconcile was not sent: the caller's permission check gave no proof for this item.
_Avoid_: denied, forbidden, unauthorized

**Written**:
A reconcile ended and the live state now has the desired values.
_Avoid_: applied, done, succeeded, found

**Refused**:
A reconcile ended because the system that holds the item said no to this value. Nothing changed, and the same value
is not sent again.
_Avoid_: rejected, failed, invalid

**Not written**:
A reconcile ended with nothing changed, for a reason that may pass. A later check may try again.
_Avoid_: failed, errored, skipped

**Unclear**:
A reconcile was sent and no clear answer came back, so it may have changed the live state. It has not ended: the next
read of the live state ends it.
_Avoid_: timed out, maybe, pending

**Overtaken**:
A reconcile ended with the live state holding neither the old values nor the desired ones: something else changed it
meanwhile.
_Avoid_: conflict, raced, clobbered

### Adopt

**Adopt**:
Opening a change request that writes the live state into the desired state, when the live change was right: a drifted
field takes its live value, an unmanaged item becomes a managed item, and a missing item leaves the desired state.
_Avoid_: import, accept, absorb
