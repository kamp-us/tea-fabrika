# kalfa/

Small Effect libraries, one domain each, each usable alone in any repo ([0047](../.kalfa/decisions/0047-kalfa-is-small-libraries-usable-alone.md)).
The [root map](../AGENTS.md) holds here too. This page adds guidelines for imports between kalfa
packages. They are guidelines, not laws: no check enforces them, and a reviewer may accept a break
with a reason.

- **Depend on a protocol, not a Layer.** A kalfa package imports another's service tags and types,
  never its Layers.
- **Join Layers at the top.** The `kalfa` command and libfabrika provide the Layers. A package that
  builds another's Layer inside itself hides the choice from them.
- **An adapter is an entry point of the package whose interface it implements,** named for what it
  adapts to, such as `@kalfa/ledger/cloudflare` ([0048](../.kalfa/decisions/0048-each-adapter-is-an-entry-point.md)).
- **No import cycles.** If two packages need each other, the shared part is a third package. Packages import each other in one
  ranked order: the ledger sits below Program, and Markdown sits below Records, which reads and writes its records' frontmatter
  through it ([0087](../.kalfa/decisions/0087-a-record-is-data-on-top-and-free-text-below.md)).
  The Ledger (`@kalfa/ledger`) imports Diagnostics for `Hidden.Cause` and no other kalfa package, so it ranks just above Diagnostics.
  Diagnostics ranks below Configuration, which imports it ([0084](../.kalfa/decisions/0084-diagnostics-is-its-own-package-below-configuration.md)), and Configuration ranks below CLI. Secrets (`@kalfa/secrets`) ranks just above
  Configuration and imports Configuration and Diagnostics. Source control (`@kalfa/git`) imports no kalfa
  package and ranks lowest; CI, Code hosting, Delivery and Reconciliation rank above it. GitHub (`@kalfa/github`) ranks above Secrets
  and Configuration and below Code hosting, CI, Conversation and Identity, which reach GitHub through it
  ([0050](../.kalfa/decisions/0050-a-vendor-client-is-its-own-package.md)).
  Transport (`@kalfa/transport`) imports no kalfa package and ranks lowest, beside Source control.
  Permissions (`@kalfa/permissions`) imports no kalfa package in its first slice and ranks lowest, beside Source control and Transport.
- **Keep the import graph small.** Each new edge needs a reason. Fewer edges keep each package
  usable alone.
