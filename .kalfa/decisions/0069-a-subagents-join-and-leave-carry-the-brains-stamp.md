# A subagent's join and leave carry the brain's stamp, not a signature

Every change to a project is signed by a key (0053), and a summoned agent holds no key (0054), so an agent that summons
a subagent (0067) has nothing to sign the subagent's join with. We decided that this join, and the leave its parent
writes, carry the brain's stamp in place of a signature: the brain already knows which agent made the write, as it does
for every other write of a summoned agent. The project accepts an unsigned change only for these two, and only when the
stamped sender is a joined agent and is the parent the change names. A subagent's join records its parent, so a
parent's leave takes its subagents with it and frees their names.

## Considered Options

- Leave subagents out of Identity until an app opens them: rejected, because the hole comes back the day one does, and
  by then the membership log's rule would have to change under real data.
- The human signs every subagent's join: rejected, because a parent summons in the middle of a turn, and a person
  would have to touch a key each time.
- A key made for each agent so it can sign: rejected in 0054, since a key the brain holds for itself proves nothing.

## Consequences

The membership log has two ways in, a signature and a stamp, and the stamp is only as good as the brain: nothing
outside the brain can check who summoned a subagent. A human's own summon and dismiss stay signed. A subagent's leave
may be written by its parent, stamped, or by its human, signed, and by no one else. Nothing here was type-checked when
it was decided.
