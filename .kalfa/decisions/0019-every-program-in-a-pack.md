# Every program is in a pack, and settings belong to the pack

There are no loose programs: even a repo's own program lives in a pack and is named `<pack>/<program>`. A pack declares one settings schema that all its programs read; a program has no settings of its own and sees only its own pack's values. The price is that a one-file program needs a `pack.toml`.
