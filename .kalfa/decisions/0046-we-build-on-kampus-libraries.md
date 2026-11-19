# We build on kampus libraries and fix them upstream

fabrika builds on the kampus community's own libraries, tea for programs and Manti for the UI, and when one falls short we fix it upstream instead of wrapping or forking it. They are made by people we work with, so a fix lands where every user of the library gets it, and the price is waiting on their releases.

## Considered Options

- Widely used libraries from outside kampus for state machines and UI: rejected, because we could not shape them to fabrika.
- A wrapper of our own around tea or Manti: rejected, because it hides the library and drifts from it.
