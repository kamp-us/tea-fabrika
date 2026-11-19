---
name: codebase-design
description: Design deep modules and place their seams. Use when you design or reshape a module's interface, look for what to deepen, decide where a seam goes, or judge whether a `Layer`, a service or a package earns its place.
---

# codebase-design

Aim for a lot of behavior behind a small interface, put at a clean seam, tested through that
interface. Callers gain leverage and maintainers gain locality.

## The words

Use these exactly. Do not swap in "component", "API" or "boundary".

- **Module:** anything with an interface and an implementation: a function, a `Layer`, a package.
  In `next/`, "module" also means one libfabrika folder
  ([0091](../../../.decisions/0091-modules-and-layers.md)).
- **Interface:** everything a caller must know: the types, and also the invariants, the order of
  calls, the errors, the config it needs. Not only the type signature.
- **Depth:** how much behavior a caller gets per unit of interface it must learn. Deep is a lot
  behind a little. Shallow is an interface about as complex as what is behind it. The term deep
  module is from John Ousterhout, *A Philosophy of Software Design*.
- **Seam:** a place where behavior can change without editing there (Michael Feathers, *Working
  Effectively with Legacy Code*). It is where an interface lives. Say "seam", not "boundary": boundary
  already means a bounded context here.
- **Adapter:** a concrete thing that fills an interface at a seam. It names a role, not contents.
- **Leverage:** what callers get from depth. **Locality:** what maintainers get: change and bugs
  stay in one place.

## Judgment

- **The deletion test.** Imagine the module gone. If the complexity vanishes, it was a
  pass-through. If it reappears in many callers, it was earning its keep.
- **The interface is the test surface.** If you must test past it, the module has the wrong shape.
- **One adapter is a hypothetical seam. Two adapters is a real one.** Add a seam only when
  something varies across it. A seam a decision already settled is not reopened by this test; only
  a new seam is judged by it.
- **Depth is about the interface.** A deep module may be many small parts inside.
  Accept dependencies and return results. Never change a caller's value inside.

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

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT license).
