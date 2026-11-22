# A diagnostic's place says what kind of place it is

A diagnostic's place was a path from the repo root, with `.` for the whole repo (the first answer on CLI's protocol,
https://github.com/kamp-us/tea-fabrika/issues/1751, written for CLI's own diagnostics before decision 0084 let
Configuration's errors carry one). A bad value in the user's file under the home folder, in an environment variable or
in a flag has no place in the repo, and the place check would read `~/.demo/demo.toml` as a folder named `~`. We decided
that a place says what kind of place it is: a file in the repo (a path from the repo root, with a line and column when
known), a file under the home folder (written `~/...` or `$NAME/...`, so no login name is printed, with a line and
column when known), an environment variable (its name) or a command-line flag (its name). A repo path whose first part
is `~` or starts with `$` is refused. We chose this because Cargo records where a config value came from as a file, an
environment variable or a command-line option
(https://github.com/rust-lang/cargo/blob/master/crates/cargo-util-config/src/definition.rs), and git does the same with
its origin types (https://git-scm.com/docs/git-config#Documentation/git-config.txt---show-origin). The build ticket is
https://github.com/kamp-us/tea-fabrika/issues/1929.

This narrows the first answer on issue 1751: a repo-relative path is now the first kind of place, not the only one.
Decision 0084 says nothing about a place, so it stands as written.

## Considered Options

- The whole repo, `.`, for anything outside the repo, with the message naming the file and line: rejected, because `.`
  would then mean both "the whole repo" and "somewhere else", an agent reading the JSON would be told something untrue,
  and it would have to parse the message to find the file and line.
- One path that may also start at the home folder, with an environment variable and a flag still placed at `.`:
  rejected, because the kind would hide in the first characters of a string and `.` would still mean two things.
- An absolute path for a file outside the repo, as Cargo and git print it: rejected, because it prints a login name
  into terminal output and CI logs, which SARIF names as the reason to leave absolute paths out
  (https://docs.oasis-open.org/sarif/sarif/v2.1.0/os/sarif-v2.1.0-os.html), and this repo's text names no machine.

## Consequences

- The place that issue 1917 builds changes: its path check, its generators and its README. Issue 1918 and
  Configuration's error ticket wait on that change. Nothing is released and only the unmerged build uses a place, so
  the change is cheapest now.
- Configuration's `SettingsError` has to say where its error came from as data (the repo file, the user file, an
  environment variable or a flag), not as text, so Configuration can build the place without parsing a path or a
  message.
- The package never reads the home folder or the environment: a place only names where, and a reader's own shell
  expands `~` and `$NAME`.
- Printing a place, and `--format json`, stay in `@kalfa/cli`, which has to show every kind.
- Nothing here was type-checked when it was decided.
