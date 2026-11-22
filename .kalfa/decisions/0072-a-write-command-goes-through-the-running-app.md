# A write command goes through the running app

A `kalfa` command that changes something does not write the Ledger entry itself. It signs in with its own client key and sends one message to a process the app runs; the gateway stamps the sender, the program's guard decides, and the program writes. The sender is a new kind, `command`, acting for the human who owns the device. We chose this because one guard then covers the app's window and the command alike: with the earlier rule (a person at the command gives no proof and the command writes by itself) any human in the project could declare a severity that only the owner may declare. The design ticket is https://github.com/kamp-us/tea-fabrika/issues/1852.

This replaces ruling 14 of Incidents' protocol (https://github.com/kamp-us/tea-fabrika/issues/1759) and the same line of Reconciliation's protocol (https://github.com/kamp-us/tea-fabrika/issues/1758).

How a write command runs:

1. It builds its package's own message.
2. It signs in with the command's client key. A device gets that key once, with `kalfa identity accept`; on a device that is already in, the device's own key grants it with no second step.
3. It sends the message to the process named by the package's setting (`incidents.process`). The app's program lists that message in its inputs, or the command is refused before anything is sent.

A command that only reads stays local and sends nothing.

## Considered Options

- The command writes the Ledger entry itself and no permission is checked: rejected, because a rule that holds in the window would not hold at the command.
- The command checks the permission itself: rejected, because the permission model is the app's, and a `kalfa` built from any repo's packages does not have it.
- No way to write while the app is down: rejected, because an outage is when a person most needs to declare an incident.

## Consequences

- A write command needs the app running and reachable. With no client key (a fresh machine, a CI job) it refuses with a diagnostic and exit code 1.
- Every write command whose entries need only the Ledger takes `--direct`, the way to write while the app is down (decision 0081 names which). The entry is signed by the client key and marked as direct, no guard runs, and a write-up and a state page show direct entries apart from the rest. A flag that skips the check can become a habit; the mark is what makes that visible.
- `kalfa secrets` is the one exception. It talks to the secret store, and the store's own login gates it.
- The sending is written once, in Program's command-line entry point, beside the dial-in that `kalfa program mcp` already does. Each package with write commands gets one setting that names its process, and `@kalfa/cli` gains nothing.
- The command's key is its own, so a human can revoke the command on a device and keep the window.
- Anything that can run a shell on a human's device can run a command as that human, an agent included. An agent is meant to act through the inputs a program opened to it. This is a known limit, the same one every command-line tool with a stored login has.
