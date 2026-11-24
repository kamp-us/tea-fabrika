/**
 * The Ledger's one id shape, an entry name, and `child`, which builds one entry id from another.
 *
 * **Details**
 *
 * Every package that keeps entries in the Ledger names them with an `EntryId`, so the writer's own id is this type under its own name with no mapping.
 * `child` is pure and never fails: a name and a parent always give a valid id, as the plain text `<name>:<parent>` when that fits in 255 characters and
 * as `<name>.h:<hash of the parent>` when it does not.
 */
import { Schema } from "effect";
import { Base64Url } from "effect/encoding";
import { hash } from "fast-sha256";

/**
 * The longest entry id, in characters.
 *
 * @category constants
 */
const ID_LIMIT = 255;

// The hashed form is `<name>.h:` and the 43 characters of a SHA-256 in base64url: so a name of 209 characters still fits it exactly.
const NAME_LIMIT = ID_LIMIT - ".h:".length - 43;

/**
 * An entry's id, the one its writer makes: 1 to 255 characters of letters, digits, `-`, `_`, `.` and `:`.
 *
 * @category models
 */
export const EntryId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_.:-]{1,255}$/u)).pipe(
  Schema.brand("@kalfa/ledger/EntryId"),
);

export type EntryId = typeof EntryId.Type;

/**
 * A fixed word a package picks to tell one kind of its entries from another: 1 to 209 characters of letters, digits, `-` and `_`, so never `.` or `:`.
 *
 * @category models
 */
export const EntryName = Schema.String.check(
  Schema.isPattern(new RegExp(`^[A-Za-z0-9_-]{1,${NAME_LIMIT}}$`, "u")),
).pipe(Schema.brand("@kalfa/ledger/EntryName"));

export type EntryName = typeof EntryName.Type;

const encoder = new TextEncoder();

/**
 * The id of an entry that follows from another: `<name>:<parent>` when that is 255 characters or fewer, else `<name>.h:` and the parent's SHA-256 in
 * base64url, 43 characters.
 *
 * **Details**
 *
 * A plain id's text before its first `:` is its name, and a hashed id's is `<name>.h`. No name holds `.`, so the two never meet, and no name holds `:`,
 * so a plain id splits back into one name and one parent.
 *
 * @category constructors
 */
export const child = (name: EntryName, parent: EntryId): EntryId => {
  const plain = `${name}:${parent}`;

  if (plain.length <= ID_LIMIT) {
    return Schema.decodeUnknownSync(EntryId)(plain);
  }

  return Schema.decodeUnknownSync(EntryId)(`${name}.h:${Base64Url.encode(hash(encoder.encode(parent)))}`);
};
