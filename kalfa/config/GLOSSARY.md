# Configuration

The values an app's programs run with, declared once, read from the app's own inputs, and where each value came from.
Configuration never reads a host.

## Language

**App**:
The name that owns a group of settings. It picks the app's configuration files and its environment variable prefix,
and one app never reads another's.
_Avoid_: project, tool, namespace

**Setting**:
One named value an app declares once, with its type, its default and a sentence a person reads. Its value is plain
data: text, numbers, booleans, and arrays and records of those. It may hold a secret's name, never a secret's value.
_Avoid_: option, config key, parameter, variable, host setting

**Setting group**:
The settings one program reads together, under one app. A program reads its group only through the group's layer,
which starts it.
_Avoid_: config object, settings bag, namespace

**Default**:
The value a setting has when no source gives one.
_Avoid_: fallback, initial value

**Required setting**:
A setting with no default. The start stops when no source gives it.
_Avoid_: mandatory setting

### Where values come from

**Source**:
One place values are read from: command-line flags, environment variables, the repo configuration, the user
configuration, or the defaults.
_Avoid_: provider, input, layer, live state source

**Flag**:
One value given on the command line when the app starts.
_Avoid_: option, argument, arg, switch

**Environment variable**:
One value read from the environment, named by the app's prefix and the setting's name.
_Avoid_: env, env var

**Repo configuration**:
The app's settings file inside a repository. It changes through a change request.
_Avoid_: project config, local config, repo file

**User configuration**:
The app's settings file in a person's config home. User means the person whose config home it is.
_Avoid_: person file, global config, home file, dotfile

**File format**:
How an app's configuration files are written: how its text is read, and how one key of it is set or removed. TOML is
the only one built. It is inside the package, and no public name is a format.
_Avoid_: syntax, grammar, parser, serializer

**Edit**:
One change to one setting in a configuration file's text: setting its value or removing it. Every other line and
comment stays as it was, and the whole edited text is checked before any text comes back. A record is compared key by
key: only the keys that differ are written, and a table that leaves takes its comments.
_Avoid_: patch, update, write, mutation

**File scope**:
Which of the repo configuration and the user configuration may set a setting.
_Avoid_: scope, level, layer

**File-only setting**:
A setting only a configuration file may set. No flag is made for it, and an environment variable that names it stops
the start.
_Avoid_: protected setting, locked setting, repo-only setting

**Precedence**:
The order in which sources win: a flag, then an environment variable, then the repo configuration, then the user
configuration, then the default.
_Avoid_: priority, override order, cascade

**Origin**:
Where one value actually came from: the default, a flag by name, an environment variable by name, or a file and line.
_Avoid_: provenance, from, source

**Minimum version**:
The oldest app version a repo configuration accepts. An older app refuses to load it.
_Avoid_: required version, engine, pin

### When a change applies

**Live setting**:
A setting whose new value reaches a running process as an input. Nothing restarts.
_Avoid_: hot reload, reload, dynamic setting

**Restart setting**:
A setting a process gets among its args, so a new value applies only when the process starts again.
_Avoid_: reload, static setting, cold setting

### What was loaded

**Snapshot**:
A checked record of every loaded value of one app and its origin. A process that cannot read files starts from a stream of them.
_Avoid_: dump, export, resolved config

**Loading process**:
The process that reads an app's configuration files and gives a stream of snapshots to a process that cannot read them, as a Worker.
_Avoid_: main process, parent, host, server

**Reference**:
The Markdown page of every setting of an app: its files, its environment variable and flag, its default and when a change applies. It is made from the declarations alone, never from a loaded value.
_Avoid_: docs, manual, settings page
