# Code holds the loop, and an agent does one bounded job inside it

Code holds the loop: which step comes next, what to wait for, when to stop, when to ask a person, and how many tries are left. An agent does one bounded job inside it, and does not decide what the pipeline does next. Code is cheap, fast, testable and the same every time, and an agent is none of those.

## Considered Options

- An agent that decides what the pipeline does next, as today's operator agents do: rejected, because they wake up to check state that code can check for free, and most of those wakes had nothing to act on. A stage written as prose can only be carried out by an agent, even when every step in it is fixed; in two measured runs the shipper made the same ten calls in the same order with nothing to decide.

## Consequences

Every agent still in the loop is a stage waiting to become a machine, not the design, and a stage can lose one step at a time while the pipeline keeps working. A stage keeps an agent where its steps turn out not to be fixed: where real tickets keep needing judgment that no rule and no narrow question covers.
