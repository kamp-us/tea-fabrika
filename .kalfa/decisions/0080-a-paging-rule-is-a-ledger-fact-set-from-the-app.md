# A paging rule is a Ledger fact set from the app

Incidents' protocol sketched every rule in the settings file, paging rules included, which made a room and a chat account need a text form. We decided that a paging rule is a fact on the Ledger that a person sets from the app, and that a paging step holds a human Identity knows and no chat account. We chose this because who is paged changes when a person is away, which should not need a change request, and because only a known speaker can acknowledge a page. The design ticket is https://github.com/kamp-us/tea-fabrika/issues/1868.

Severities, responses, alerts and escalation rules stay in the settings file: code depends on them, so a change to one is reviewed.

How it runs:

1. **Setting a rule** is a sixth Incidents permission. The proof names the severity (`severity:sev0`), as with `declare` and `escalate`. A human with no account in the room's chat app is refused when the rule is set.
2. **A room as text** is the provider's name, a colon, then the provider's own id, split at the first colon. Conversation owns that one Schema. Its use is a command's argument, such as `--room github:<owner>/<repo>#<number>`.
3. **An account has no text form.** The paging process finds the human's account in the room's chat app when it pages, through a lookup Incidents declares and Identity's links fill.
4. **A page that cannot be sent** is recorded on the incident and paging carries on. A page that ends Undeliverable in the incident's thread is tried once more in the room. A human whose link is gone is recorded and the next step runs with no wait.
5. **A severity with no rule:** the incident still opens, the missing rule is recorded on it, and nobody is paged. The app shows such a severity as a warning.
6. **A changed rule** applies at a running list's next step, and the list starts again from its first step. Each page's entry names the revision of the rule it used.

This replaces ruling 10's place for the rule and the `[incidents.paging]` part of the file in [Incidents' protocol](https://github.com/kamp-us/tea-fabrika/issues/1759). The rule's parts (a room, steps, a wait, how many times the list runs) are unchanged.

## Considered Options

- Paging rules in the repo configuration: rejected, because a change of who is paged would need a change request, and account ids would sit in a public repository.
- A step holds a chat account: rejected, because an account Identity does not know cannot acknowledge, and a rule could then name an account from one chat app and a room in another.
- Every Incidents rule moves to the Ledger: rejected, because a responder must handle each response name at start, and that check needs the names in the file.

## Consequences

- A sev0 can open with nobody paged until its rule is set once.
- If the room itself is gone, every step is recorded as Undeliverable and nobody is reached. Nothing louder is raised yet.
- With the Ledger down, no rule can be changed. Paging needs the Ledger too, so nothing new is lost.
- Until another chat app has a provider, the paging room is one standing issue on the code host, and every incident's pages share its flat list.
- Not tested: the lookup from a human to an account is read from Identity's design. Nothing here was typed or run.
