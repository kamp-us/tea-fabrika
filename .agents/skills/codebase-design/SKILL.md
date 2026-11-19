---
name: codebase-design
description: Design deep modules and place their seams. Use when you design or reshape a module's interface, look for what to deepen, decide where a seam goes, or judge whether a `Layer`, a service or a package earns its place.
---

# codebase-design

Design **deep modules**: a lot of behavior behind a small interface, placed at a clean seam, tested
through that interface. Use this language and these principles wherever code is being designed or
restructured. The aim is leverage for callers, locality for maintainers, and testability for
everyone.

## The words

Use these terms exactly. Do not swap in "component", "API" or "boundary". Consistent language is
the whole point.

- **Module:** anything with an interface and an implementation: a function, a `Layer`, a package,
  or a slice that cuts across packages. Deliberately scale-agnostic. In `next/`, "module" also means
  one libfabrika folder ([0091](../../../.decisions/0091-modules-and-layers.md)).
- **Interface:** everything a caller must know to use the module correctly: the types, and also the
  invariants, the order of calls, the errors, the config it needs, and its performance. Not only the
  type signature. Avoid "API" and "signature": they name only the type-level surface.
- **Implementation:** what is inside a module, its body of code. It is distinct from an adapter: a
  small adapter can have a large implementation (a Postgres repository), and a large adapter can
  have a small one (an in-memory fake). Reach for "adapter" when the seam is the topic, and
  "implementation" otherwise.
- **Depth:** leverage at the interface: how much behavior a caller, or a test, gets per unit of
  interface it must learn. A **deep** module has a small interface and a lot behind it. A
  **shallow** module has an interface nearly as complex as what is behind it, and you should avoid
  building one. The term "deep module" is from John Ousterhout, *A Philosophy of Software Design*.
- **Seam:** a place where behavior can change without editing there (Michael Feathers, *Working
  Effectively with Legacy Code*). It is where a module's interface lives. Where to put the seam is
  its own design decision, distinct from what goes behind it. Say "seam", not "boundary": boundary
  already means a bounded context here.
- **Adapter:** a concrete thing that fills an interface at a seam. It names a role, not contents.
- **Leverage:** what callers get from depth: more capability per unit of interface they learn. One
  implementation pays back across every call site and every test.
- **Locality:** what maintainers get from depth: change, bugs, knowledge and verification stay in
  one place instead of spreading across callers. Fix once, fixed everywhere.

## Judgment

- **The deletion test.** Imagine the module gone. If the complexity vanishes, it was a pass-through.
  If it reappears across many callers, it was earning its keep.
- **The interface is the test surface.** Callers and tests cross the same seam. If you must test
  past the interface, the module has the wrong shape.
- **One adapter is a hypothetical seam. Two adapters is a real one.** Add a seam only when something
  varies across it. A seam a decision already settled is not reopened by this test; only a new seam
  is judged by it.
- **Depth is a property of the interface, not the implementation.** A deep module can be made of
  many small, mockable, swappable parts; they just are not part of the interface. A module can have
  **internal seams**, private to its implementation and used by its own tests, as well as the
  external seam at its interface. Do not expose an internal seam through the interface just because
  tests use it.
- **When you design an interface, ask:** can I reduce the number of methods? Can I simplify the
  parameters? Can I hide more complexity inside?

## Designing for testability

Good interfaces make testing natural:

1. **Accept dependencies, don't create them.** A function that takes its payment client as an
   argument can be tested with a fake. One that builds its own client inside cannot.
2. **Return results, don't produce side effects.** A function that returns a discount is testable.
   One that changes the cart in place is not. Never change a caller's value inside.
3. **Keep the surface small.** Fewer methods mean fewer tests. Fewer parameters mean simpler test
   setup.

## Relationships

- A **module** has exactly one **interface**: the surface it presents to callers and tests.
- **Depth** is a property of a module, measured against its interface.
- A **seam** is where a module's interface lives.
- An **adapter** sits at a seam and satisfies the interface.
- **Depth** produces **leverage** for callers and **locality** for maintainers.

## Rejected framings

- **Depth as a ratio of implementation lines to interface lines.** It rewards padding the
  implementation. This skill uses depth as leverage instead.
- **"Interface" as the `interface` keyword of a language, or as a class's public methods.** Too
  narrow: the interface here holds every fact a caller must know.
- **"Boundary".** It is overloaded with the bounded context of Domain-Driven Design. Say **seam** or
  **interface**.

## In Effect and kalfa

- **A protocol package's service is the interface.** A `Context.Service` tag with its types is what
  a caller learns ([0616](../../../.decisions/0616-providers-are-one-package-each.md)).
- **A provider's `Layer` is an adapter.** `@kalfa/provider-github` fills several seams, one `Layer`
  each.
- **The test `Layer` counts as an adapter only when the protocol's conformance laws run against it.**
  Until then a protocol has one real adapter, so its seam is still a guess. That test does not
  reopen the seams settled in [0325](../../../.decisions/0325-agents-behind-one-service-of-ours.md),
  [0612](../../../.decisions/0612-kalfa-ci-holds-the-ci-protocol-once.md),
  [0614](../../../.decisions/0614-kalfa-codehost-holds-the-code-host-protocol-once.md) and
  [0616](../../../.decisions/0616-providers-are-one-package-each.md).
- **Join `Layer`s at the top** ([kalfa guidelines](../../../kalfa/AGENTS.md)). A package that builds
  another's `Layer` inside itself hides a seam.
- **A package's interface is what its `package.json` `exports` map lists**
  ([0585](../../../.decisions/0585-kalfa-is-six-domain-packages.md)).
- **In `next/` libraries, private code lives in `internal/`**
  ([0032](../../../.decisions/0032-libraries-take-effects-file-layout.md)).
- **[`boundary-rules.json`](../../../boundary-rules.json) limits which package types may import
  which.**

## Going deeper

- **Deepening a cluster, given its dependencies:** see [deepening](references/deepening.md): the
  dependency categories, seam discipline, and testing at the interface.
- **Exploring alternative interfaces:** see [design it twice](references/design-it-twice.md):
  sketch the interface several radically different ways, then compare them on depth, locality and
  seam placement.

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT license).
