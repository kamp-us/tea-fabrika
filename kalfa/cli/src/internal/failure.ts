/**
 * Every refusal that stops the start of a run: exit code 2, one line, no handler run.
 *
 * **Details**
 *
 * A message names a package and never a path or an error's own text, since an absolute path may hold a login name.
 */
import { Schema } from "effect";

/** What a refusal is made of, by reason: only a reason that reads an entry names its field and its subpath. */
type Fields =
  | { readonly reason: "no-manifest" | "bad-manifest" | "not-installed"; readonly packages: ReadonlyArray<string> }
  // A `kalfa` field that is not an object has no field of its own to name.
  | { readonly reason: "bad-field"; readonly packages: ReadonlyArray<string>; readonly field?: "cli" }
  | {
      readonly reason: "load" | "no-subcommand" | "not-exported";
      readonly packages: ReadonlyArray<string>;
      readonly field: "cli";
      readonly subpath: string;
    };

// The fields are optional here and required by `Refused`'s constructor, so a message reads what the reason gives it.
class Refusal extends Schema.TaggedError<Refusal, { readonly brand: unique symbol }>()("Refused", {
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
          : `${name}'s kalfa.${this.field} field must be "." or a "./" path inside the package.`;
      case "not-exported":
        return `${name} names ${this.subpath} in its kalfa.${this.field} field, but its exports give that path no "default" condition, so kalfa cannot load it.`;
      case "load":
        return `${name}'s kalfa.${this.field} entry ${this.subpath} failed to load.`;
      case "no-subcommand":
        return `${name} names ${this.subpath} in its kalfa.${this.field} field, but that entry exports no subcommand. Expected: export const subcommand = Subcommand.make(command, { layer, diagnostics }), from @kalfa/cli/Subcommand.`;
    }
  }
}

/** `kalfa` cannot start: what is wrong, which package it names, and for an entry the field and subpath it was reading. */
export type Refused = Refusal;

/** Makes a refusal from the fields its reason has: an entry that cannot be loaded cannot be written without its field and subpath. */
export const Refused: new (refusal: Fields) => Refused = Refusal;
