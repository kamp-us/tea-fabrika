# Code holds the loop, and an agent does one bounded job inside it

The order of steps, the retries and the stopping rule live in code, and an agent is called for one bounded job at a time inside that loop. A loop in code can be tested, resumed after a crash and read by a person; a loop held in an agent's head can do none of these.

## Considered Options

- An agent that runs the whole flow and decides each next step: rejected, because its loop cannot be tested or resumed.
