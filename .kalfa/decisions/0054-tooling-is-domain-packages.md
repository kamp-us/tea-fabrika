# Our tooling is a few domain packages behind one kalfa command

Tooling is grouped by domain (config, ci, codehost, records, quality, cli), each tool a subpath, never one small package per tool. Each package exports its command tree as `./cli`, and the one `kalfa` command finds them from the project's own dependencies, never by scanning `node_modules`. Tooling never takes a `FABRIKA_` name or a `~/.fabrika` path, because fabrika is the product and tooling must not leak into it.
