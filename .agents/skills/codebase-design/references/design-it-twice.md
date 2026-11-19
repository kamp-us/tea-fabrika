# Design it twice

When the owner wants to explore alternative interfaces for a chosen deepening candidate, use this
pattern. It comes from "Design It Twice" in John Ousterhout's *A Philosophy of Software Design*:
your first idea is unlikely to be the best.

It uses the words in [the codebase-design skill](../SKILL.md): **module**, **interface**, **seam**,
**adapter** and **leverage**.

## Process

### 1. Frame the problem space

Before you sketch, write a plain explanation of the problem space for the chosen candidate:

- The constraints any new interface would need to satisfy.
- The dependencies it would rely on, and which category each falls into (see
  [deepening](deepening.md)).
- A rough code sketch to ground the constraints. It is not a proposal. It only makes the
  constraints concrete.

Show this to the owner, then go on to step 2. The owner reads while the sketches are made.

### 2. Sketch the designs

Make three or more sketches. Each must be a **radically different** interface for the deepened
module. In a session with the owner, sub-agents with a fresh context each can make the sketches in
parallel. A pipeline step does not start sub-agents: see [the build skill](../../build/SKILL.md).

Give each sketch a different design constraint:

- Minimize the interface: aim for one to three entry points. Maximize leverage per entry point.
- Maximize flexibility: support many use cases and extension.
- Optimize for the most common caller: make the default case trivial.
- Design around adapters for cross-seam dependencies, when there are any.

Give each sketch the words of [the codebase-design skill](../SKILL.md) and the words of the map, so
each names things in both the architecture's language and the project's domain language.

Each sketch says:

1. The interface: types, methods, parameters, plus invariants, ordering and error modes.
2. A usage example, showing how a caller uses it.
3. What the implementation hides behind the seam.
4. The dependency strategy and the adapters (see [deepening](deepening.md)).
5. Trade-offs: where leverage is high, and where it is thin.

### 3. Present and compare

Present the designs one at a time, so the owner can take in each. Then compare them in prose, by
**depth** (leverage at the interface), **locality** (where change concentrates) and **seam
placement**.

Then give your own recommendation: which design is strongest, and why. If parts of different
designs would combine well, propose the hybrid. Be opinionated. Say what the recommendation costs,
and how sure you are. Under about 80% sure, name the doubt and what would settle it.

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT license).
