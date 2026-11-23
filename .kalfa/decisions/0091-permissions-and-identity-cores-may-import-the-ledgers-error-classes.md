# Permissions' and Identity's cores may import the Ledger's error classes

The protocols of the five settled packages say no package's core imports another of the five
(https://github.com/kamp-us/tea-fabrika/issues/1748). A later ruling says `IdentityUnavailable` and
`PermissionsUnavailable` each carry the Ledger's failure that happened as their `reason`
(https://github.com/kamp-us/tea-fabrika/issues/1870), so each core must name the Ledger's classes. We decided that the
cores of Permissions and Identity may import the Ledger's error classes, and nothing else from the Ledger. This is an
exception to the rule in issue 1748, and the rule stands for every other import between the five. We chose this because
the other ways lose something: copying the classes gives two names for one fault, and a reason typed as plain data
keeps a caller from telling a retryable failure from a broken row.

## Considered Options

- Each package declares its own copy of the classes: rejected, because a caller would meet the same fault under
  different names and a copy can drift from the Ledger's.
- A shared package holding only the error classes: rejected, because it adds a package for a few names and one more
  package to keep, and the Ledger's own errors have one home already.
- Move the wrapping to each package's `/ledger` entry point: rejected, because the error type is part of the core's
  own calls, such as `checkIn` and `apply`, and an entry point cannot widen it.

## Consequences

- The import is of the error classes only: no service, no `Entry`, no `Ledger`, no helper. The layer rules name the
  exception when those two packages are built.
- Both cores now rank above the Ledger in the import order (decision 0049). The Ledger's core imports no kalfa package,
  so no cycle forms.
- Permissions still imports nothing from Identity, and Identity nothing from Permissions.
- Program and Transport are not covered. Their cores stay free of the other four.
- A change to the Ledger's error classes now reaches both cores, so renaming one is a change to three packages.
