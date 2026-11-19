---
name: codebase-design
description: Design deep modules and place their seams. Use when you design or reshape a module's interface, look for what to deepen, decide where a seam goes, or judge whether a Layer, a service or a package earns its place.
---

# codebase-design

Aim for a lot of behavior behind a small interface, put at a clean seam, tested through that
interface. Callers gain leverage and maintainers gain locality.

## The words

Use these exactly. Do not swap in "component", "API" or "boundary".

- **Module:** anything with an interface and an implementation: a function, a Layer, a package.
- **Interface:** everything a caller must know: the types, and also the invariants, the order of
  calls, the errors, the config it needs. Not only the type signature.
- **Depth:** how much behavior a caller gets per unit of interface it must learn. Deep is a lot
  behind a little. Shallow is an interface about as complex as what is behind it.
- **Seam:** a place where behavior can change without editing there. It is where an interface
  lives. Say "seam", not "boundary": boundary already means a bounded context here.
- **Adapter:** a concrete thing that fills an interface at a seam. It names a role, not contents.
- **Leverage:** what callers get from depth. **Locality:** what maintainers get: change and bugs
  stay in one place.

## Judgment

- **The deletion test.** Imagine the module gone. If the complexity vanishes, it was a
  pass-through. If it reappears in many callers, it was earning its keep.
- **The interface is the test surface.** If you must test past it, the module has the wrong shape.
- **One adapter is a hypothetical seam. Two adapters is a real one.** Add a seam only when
  something varies across it.
- **Depth is about the interface.** A deep module may be many small parts inside.
  Accept dependencies and return results; do not build a gateway or mutate a caller's value inside.

## In Effect and kalfa

- **A protocol package's service is the interface.** A `Context.Service` tag with its types is what
  a caller learns ([0616](../../../.decisions/0616-providers-are-one-package-each.md)).
- **A provider's Layer is an adapter.** `@kalfa/provider-github` fills several seams, one Layer each.
- **The test Layer counts as an adapter only when the protocol's conformance laws run against it.**
  Until then a protocol has one real adapter, so its seam is still a guess.
- **Join Layers at the top** ([kalfa guidelines](../../../kalfa/AGENTS.md),
  [0613](../../../.decisions/0613-kalfa-package-imports-are-a-guideline.md)). A package that builds
  another's Layer inside itself hides a seam.
- **A package's root files are its entry points,** its interface; the rest is implementation.
  `boundary-rules.json` enforces what each package type may import.

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT license).
