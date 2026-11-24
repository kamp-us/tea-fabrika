/**
 * Every refusal that stops the start of a run: exit code 2, one line, no handler run.
 *
 * **Details**
 *
 * A message names a package and never a path or an error's own text, since an absolute path may hold a login name.
 */
import { Schema } from "effect";

/** `kalfa` cannot start: what is wrong, which package it names, and the field and subpath it was reading. */
export class Refused extends Schema.TaggedError<Refused, { readonly brand: unique symbol }>()("Refused", {
  reason: Schema.Literals([
    "no-manifest",
    "not-installed",
    "bad-manifest",
    "bad-field",
    "not-exported",
    "load",
    "no-subcommand",
  ]),
  /** The packages named: none for a missing or unreadable `package.json` in the current folder. */
  packages: Schema.Array(Schema.String),
  field: Schema.optionalKey(Schema.Literal("cli")),
  subpath: Schema.optionalKey(Schema.String),
}) {
  override get message(): string {
    const name = this.packages.join(", ");
    const field = `kalfa.${this.field ?? "cli"}`;
    const subpath = this.subpath ?? ".";

    switch (this.reason) {
      case "no-manifest":
        return "There is no package.json in this folder. Run kalfa from the repo's root.";
      case "not-installed":
        return `${name} is listed in package.json but not installed. Run your package manager's install.`;
      case "bad-manifest":
        return `${name === "" ? "This folder" : name}'s package.json is not a JSON object kalfa can read.`;
      case "bad-field":
        return this.field === undefined
          ? `${name}'s kalfa field must be an object.`
          : `${name}'s ${field} field must be "." or a "./" path inside the package.`;
      case "not-exported":
        return `${name} names ${subpath} in its ${field} field, but its exports give that path no "default" condition, so kalfa cannot load it.`;
      case "load":
        return `${name}'s ${field} entry ${subpath} failed to load.`;
      case "no-subcommand":
        return `${name} names ${subpath} in its ${field} field, but that entry exports no subcommand. Expected: export const subcommand = Subcommand.make(command, { layer, diagnostics }), from @kalfa/cli/Subcommand.`;
    }
  }
}
