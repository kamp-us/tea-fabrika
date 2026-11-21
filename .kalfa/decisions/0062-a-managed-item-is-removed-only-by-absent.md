# A managed item is removed only when its desired state says absent

Reconciliation removes a live item only when the kalfa config names it and says it is absent. Taking an item out of
the file does not remove it: the item becomes an unmanaged item, which is reported and never changed. We chose this
because the items are things like the rule on who may push to main, and a line deleted by mistake, or a file read
half, must never delete one. A removal is then written down and goes through a change request like every other
change to the desired state.

## Considered Options

- Remove what the file no longer names, as Terraform does: rejected, because a missing line and a wish to remove look
  the same, so a bad edit or a wrong copy of the file deletes live rules.
- Never remove, and leave it to a person on the host: rejected, because a rule could then be added from the file and
  not taken away, and the removal would leave no record.

## Consequences

Removing an item takes two change requests: one that says absent, and a later one that takes the lines out once the
check answers that it matches. A live state source that cannot remove refuses an absent desired state when the
process starts. An item that is still live while its desired state says absent is drift like any other, so it is only
reported unless that item is set to reconcile.
