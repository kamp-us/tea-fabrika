# Leak word file: checking the running children

- **This coordinator session: missing.** I ran `test -s ~/.fabrika/leak-words`. My container was
  built before the setup script changed, so for any PR I arm myself, your "leak ok <sha>" gate
  stays.
- **The five children (B1, K1, K2, L16, C2):** each got the same one-line test, with the rule:
  - **present:** it runs the full check itself and drops your gate. Its leakgrep report must not
    say "private word list is missing", or the list counts as missing.
  - **missing:** it keeps the gate.

  I expect all five to say missing, since they started before the change and a setup script only
  runs when a container is first built. Their answers follow in the next message.
- **Children started from now on:** they run the full check themselves. Each brief will also
  require the report line above, so a container without the file still fails closed onto your
  gate.
- The leakgrep path is confirmed: `leakgrep.sh` reads `FABRIKA_LEAK_WORDS`, or else
  `~/.fabrika/leak-words`.

Children active: 5 of 5.
