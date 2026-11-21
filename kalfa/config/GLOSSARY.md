# Configuration

The values an app's programs run with, declared once, read from the app's own inputs, and where each value came from.
Configuration never reads a host.

## Language

**App**:
The name that owns a group of settings. It picks the app's configuration files and its environment variable prefix,
and one app never reads another's.
_Avoid_: project, tool, namespace

**Setting**:
One named value an app declares once, with its type, its default and a sentence a person reads. It may hold a
secret's name, never a secret's value.
_Avoid_: option, config key, parameter, variable, host setting

**Default**:
The value a setting has when no source gives one.
_Avoid_: fallback, initial value

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
A checked record of every loaded value and its origin.
_Avoid_: dump, export, resolved config
