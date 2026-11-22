# Delivery's wait for the host never blocks a landing

Decision 0071 has Delivery move a change request's branch, wait until the host shows the change request at the new commit, and put the branch back when that wait runs out, so the change request does not land. The trial behind 0071 then showed merged 6 times out of 6 with no wait, while the host's read still showed the old commit (https://github.com/kamp-us/tea-fabrika/issues/1831). We decided that the wait stays but never blocks: when it runs out, Delivery moves main anyway. We chose this because the wait protects only the merged mark, and a change request that passed its build should not fail to land over a mark. The design ticket is https://github.com/kamp-us/tea-fabrika/issues/1886.

Steps 3 and 4 of decision 0071 become:

3. Delivery waits until the host's snapshot shows the change request at the new commit, up to the branch wait limit. The limit is a setting, default 10 seconds. At 0 Delivery does not wait.
4. It pushes main, whether the wait got its answer or ran out. The branch is put back only when main is refused.
5. After main moves, Delivery reads what the host shows for each change request in the landing. Where the host shows closed and not merged, Delivery adds the note and the landing says so, the same way as for a branch Delivery may not push to.

Steps 1 and 2, the crash rule and the rest of decision 0071 stay as written.

## Considered Options

- Keep the wait as a gate, as 0071 had it: rejected, because a slow read at the host would undo a landing that was good, and the trial gave no sign that the read is what the host decides merged from.
- Drop the wait: rejected for now, because 6 landings on one quiet evening is thin proof, and a few seconds is a cheap margin. A limit of 0 gives this without a new decision.
- A larger trial with no wait before deciding: rejected, because more landings on a quiet day cannot show a slow day at the host, and with this decision a slow day costs a mark and not a landing.

## Consequences

- A landing by rebase or squash can end with the host showing closed though Delivery could push the branch. The landing records which of the two the host showed, so real use will say how often.
- The `unmovable` setting's `fail` value still covers only a branch Delivery may not push to. It cannot cover a wait that ran out, because main has moved by the time Delivery sees closed.
- In a candidate of several change requests, every branch moves, then Delivery waits once for all of them under one limit, then moves main.
- Delivery reads the host once more after each landing by rebase or squash. That read holds up nothing in the queue.
- CI's triage is not touched: the branch push starts the same build with or without the wait.
- bors-ng made the same call for its squash style: it never stops a landing for the mark, closes the change request and renames it (https://forum.bors.tech/t/use-a-squash-merge-in-bors/349).
