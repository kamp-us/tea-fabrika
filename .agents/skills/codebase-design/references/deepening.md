# Deepening

How to deepen a cluster of shallow modules safely, given its dependencies. It uses the words in
[the codebase-design skill](../SKILL.md): **module**, **interface**, **seam** and **adapter**.

## Dependency categories

When you assess a candidate for deepening, classify its dependencies. The category decides how the
deepened module is tested across its seam.

### 1. In-process

Pure computation, in-memory state, no I/O. Always deepenable: merge the modules and test through the
new interface directly. No adapter is needed.

### 2. Local-substitutable

Dependencies that have a local stand-in for tests: PGLite for Postgres, or an in-memory filesystem.
Deepenable when the stand-in exists. The deepened module is tested with the stand-in running in the
test suite. The seam is internal; the external interface gets no extra seam for it.

### 3. Remote but owned

Your own servers across a network. The deep module owns the logic, and the transport is injected as
an adapter behind an interface of its own, at the seam. Tests use an in-memory adapter; production
uses an HTTP, gRPC or queue adapter.

Recommendation shape: "Define an interface at the seam, implement an HTTP adapter for production and
an in-memory adapter for testing, so the logic sits in one deep module even though it is deployed
across a network."

### 4. True external

Third-party services you do not control, such as a payment provider or a messaging provider. The
deepened module takes the external dependency as an injected interface, and tests provide a mock
adapter.

## Seam discipline

- **One adapter means a hypothetical seam. Two adapters means a real one.** Do not add an interface
  at a seam unless at least two adapters are justified, usually production and test. A single-adapter
  seam is just indirection.
- **A seam a decision already settled stays.** The test above judges only new seams.
- **Internal seams and external seams.** A deep module can have internal seams, private to its
  implementation and used by its own tests, as well as the external seam at its interface. Do not
  expose an internal seam through the interface just because tests use it.

## Testing: replace, do not layer

- Once tests at the deepened module's interface exist, the old unit tests on the shallow modules are
  waste. Retire them, and say in the pull request why. A removed test is a loosening, which
  [loosening.sh](../../lead/scripts/loosening.sh) reports for the review.
- Write new tests at the deepened module's interface. The **interface is the test surface**.
- Tests assert on observable outcomes through the interface, not on internal state.
- Tests should survive internal refactors, since they describe behavior, not implementation. If a
  test has to change when the implementation changes, it is testing past the interface.

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT license).
