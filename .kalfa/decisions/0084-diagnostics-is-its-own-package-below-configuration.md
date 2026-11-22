# Diagnostics is its own package, ranked below Configuration

CLI's protocol (https://github.com/kamp-us/tea-fabrika/issues/1751) put the diagnostic's shape and the `Diagnostics`
service inside `@kalfa/cli`, and Configuration may not import CLI, so a settings error could not become a
`config/...` diagnostic without CLI translating each one by hand. We decided that what a diagnostic is moves into a
small `@kalfa/diagnostics` package that imports no kalfa package: the shape, a code declared once with its long text,
the `Diagnostics` service and its test Layer. A typed error may carry its own diagnostic, and `kalfa` reports that
diagnostic when a subcommand fails with such an error. We chose this because a code then lives beside the error it
describes, and every package gets the same way in. The design ticket is
https://github.com/kamp-us/tea-fabrika/issues/1890.

## Considered Options

- `@kalfa/cli` catches Configuration's typed errors and reports them under `config/...` codes it declares itself:
  rejected, because every new Configuration error needs a line in CLI, and no other package could do the same.
- Configuration imports `@kalfa/cli`: rejected, because CLI imports Configuration for `kalfa config`, and the ranked
  import order allows no cycle (decision 0049).

## Consequences

- Configuration gains its first kalfa import, so a Worker that loads settings carries this package too. The package
  never prints and never picks an exit code, which keeps it small: printing, `--format json`, exit codes,
  `kalfa explain` and `Subcommand` stay in `@kalfa/cli`.
- A handler reports only through a declared code, so a code nobody declared cannot be reported. Severity is given
  when reporting, because a setting may choose it.
- A subcommand that fails with an error that carries a diagnostic ends with exit code 1, as one that reported an
  error. Any other failure stays exit code 2.
- A package that reports imports `@kalfa/diagnostics`. It imports `@kalfa/cli` only for `Subcommand`.
- Nothing here was type-checked when it was decided.
