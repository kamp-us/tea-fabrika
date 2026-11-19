# Oxlint lints, oxfmt formats, and our rules are oxlint plugins

The repo is linted by oxlint and formatted by oxfmt, and every rule of our own is an oxlint plugin. Both are fast enough to run on every save, and over 70 of our rules are already written against oxlint's plugin interface, so moving away would mean writing them all again.

## Considered Options

- Biome: rejected; its plugin story could not hold our own rules.
