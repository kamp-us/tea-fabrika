# The recovery sheet is the last way back, and an invite as the same human is a full reset

A human can lose every device, every passkey and the recovery sheet, and decision 0085 lets no key of kind `human` add a passkey alone, so something has to say how such a human comes back. We decided that every human always has one live recovery sheet, that someone above them can bring them back with an invite as the same human, which starts that human over, and that nobody can do this to the owner. We chose this because a way back that needs no secret and no second human is also open to a thief, and because the owner agreed that a lost or leaked sheet is the holder's own risk. The design ticket is https://github.com/kamp-us/tea-fabrika/issues/1901.

How it works:

1. A sheet belongs to one human. The owner's is made when the project is created, and every other human's is made by their new device when it accepts an invite.
2. A sheet is used once (decision 0023). The change that spends it carries the next sheet's public key, so a human is never without one.
3. Outside a recovery, a new sheet follows decision 0085's rule for a passkey: once the human has held a passkey, it needs an approval from a passkey they hold, or the live sheet.
4. Nobody makes a sheet for another human, because whoever makes it sees the words.
5. An invite as the same human is a full reset. When its key is granted, all of that human's old keys, passkeys and sheets are out, and the new device makes a new sheet and may grant a first passkey.
6. Who may invite whom as the same human is the app's permission rule. Fabrikalfa's goes downward only: an admin for a member, the owner for an admin, and nobody for the owner.

## Considered Options

- A reset that takes effect after a wait unless a passkey cancels it: rejected, because the sheet and the invite as the same human cover every case but the owner's, with less to build.
- An admin makes a new sheet for the locked-out human: rejected, because the admin would hold that human's words.
- One sheet for the whole project: rejected, because a leak cannot be traced to anyone and it would bring back anyone as anyone.
- A sheet that is not spent, or one that also passes a guarded act: rejected, because a leaked one-use sheet shows on the Ledger the first time it is used, and a reusable one works quietly.

## Consequences

- An owner who loses every device and the sheet has lost the project. Recovery by email, which could soften this on the cloud setup, comes later.
- An admin who invites a member as the same human can then give presence as that member. The Ledger shows who invited and who granted, but only after the fact.
