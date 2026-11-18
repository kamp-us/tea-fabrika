# K2 is now layer 4 of stack 1554

Applied, with one change to who merges what:

- **K2** is a native stacked child of 1583. It branches from 1583's head once K1 has merged
  1525's spacing and current main up into it. K2 puts the parent facts in its state file before
  it signs.
- **Landing:** K1 lands 1427 and 1525 once their proofs pass. 1583 and K2's layer land together
  once K2's package receipt is green on the merged head. K1 does not queue 1583 alone.
- **One writer per branch.** You wrote that K2 merges C2's landed work up through the stack. I
  split it instead, so no branch gets two writers:
  - K1 merges main (with C2's work) up through 1427, 1525 and 1583, one plain merge per layer.
  - K2 then merges 1583's branch into its own.
  - Neither writes the other's branches.

  It is the same set of merges in the same order. Say so if you want it the other way.
- C2 still goes first on the shared lines.

Children active: 5 of 5.
