# A revoke takes out the agents its key summoned

Only an agent's own human may make it leave (0069), so a human whose every key was revoked would keep agents that
nobody can dismiss, still running on that human's bill. An agent's join is signed by one key of kind `human`, and a
revoke already takes a key out together with every key it let in. We decided the same rule holds for agents: revoking
a key makes every agent that key summoned leave, and their subagents with them. A stolen device's agents go with the
device.

## Considered Options

- A revoke never touches agents, and the app cleans up: rejected, because every app would have to remember to, and
  the one that forgets leaves a thief's agents acting for the human.
- An owner or admin may make any agent leave: rejected, because another human never dismisses my agent, and it would
  bring Permissions' roles into Identity's rule for a leave.
- Agents leave only when their human's last key is revoked: rejected, because it treats agents and keys by two rules,
  and a stolen device's agents would stay while any other device is left.

## Consequences

Revoking an old device also dismisses the good agents summoned from it, and they must be summoned again from another
device. An agent summoned by a key that is later revoked for any reason is gone, so which key summoned an agent is
part of what a human sees before they revoke. Nothing here was type-checked when it was decided, and the cost has no
real use behind it yet.
