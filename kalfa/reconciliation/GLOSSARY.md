# Reconciliation

Keeping live things the way a file says they should be: comparing the two, reporting where they differ, and fixing it.

## Language

**Managed item**:
One thing that has a written desired state and a live state, such as a repo rule or a repo setting.
_Avoid_: resource, object, setting, target

**Desired state**:
What the project's kalfa config says a managed item should be. It changes only through a change request.
_Avoid_: spec, target, config

**Live state**:
What a managed item is right now, as the system that holds it says.
_Avoid_: actual, current, status

**Live state source**:
The adapter that reads, and may write, the live state of one kind of managed item.
_Avoid_: provider, backend, driver

**Drift**:
A field the desired state names whose live value differs from it. A named list is compared whole.
_Avoid_: diff, mismatch, out of sync

**Unmanaged item**:
Something live that no desired state names. It is reported, and never changed or deleted.
_Avoid_: orphan, extra, unknown item

**Check**:
Comparing the desired state with the live state and reporting the drift. It changes nothing.
_Avoid_: plan, diff, audit, scan

**Reconcile**:
Changing the live state so it matches the desired state. Whether drift is reconciled or only reported is a setting for
each managed item, and the default is report.
_Avoid_: apply, sync, enforce, fix

**Adopt**:
Opening a change request that writes a live value into the desired state, when the live change was right.
_Avoid_: import, accept, absorb

**Unknown**:
A check's answer when the live state could not be read. It never means no drift: a source that could not read says so,
and never answers with an empty live state.
_Avoid_: no drift, empty, skipped, passed
