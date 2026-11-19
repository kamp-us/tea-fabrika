# kalfa/

Our tooling packages, one domain each ([0054](../.kalfa/decisions/0054-tooling-is-domain-packages.md)).
The [root map](../AGENTS.md) holds here too. This page adds guidelines for imports between kalfa
packages. They are guidelines, not laws: no check enforces them, and a reviewer may accept a break
with a reason.

- **Depend on a protocol, not a Layer.** A kalfa package imports another's service tags and types,
  never its Layers.
- **Join Layers at the top.** The `kalfa` command and libfabrika provide the Layers. A package that
  builds another's Layer inside itself hides the choice from them.
- **No import cycles.** If two packages need each other, the shared part is a third package.
- **Keep the import graph small.** Each new edge needs a reason. Fewer edges keep each package
  usable alone.
