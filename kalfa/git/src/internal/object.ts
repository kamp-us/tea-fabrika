// The objects of a git repository as bytes, as git writes them: the memory adapter hashes them for an id and measures a
// commit's for the byte limit.
import type * as Commit from "../Commit.ts";
import { joined } from "./bytes.ts";

const encoder = new TextEncoder();

const FORMATS = { sha1: 40 } as const;

/** The form of an object's id: lowercase hex of a length git uses. The length lives in `FORMATS`, in one place. @internal */
export const OBJECT_ID = new RegExp(
  `^(?:${Object.values(FORMATS)
    .map((length) => `[0-9a-f]{${length}}`)
    .join("|")})$`,
);

type Fields = Pick<Commit.Commit, "tree" | "parents" | "author" | "committer" | "message">;

const ident = (signature: Commit.Signature): string =>
  `${signature.name} <${signature.email}> ${signature.at.seconds} ${signature.at.offset}`;

/** @internal */
export const bytes = (fields: Fields): Uint8Array => {
  const head = [
    `tree ${fields.tree}`,
    ...fields.parents.map((parent) => `parent ${parent}`),
    `author ${ident(fields.author)}`,
    `committer ${ident(fields.committer)}`,
  ].join("\n");

  return encoder.encode(`${head}\n\n${fields.message}`);
};

/** What git hashes for an object: its type word, the size, a NUL byte, then the object's bytes. @internal */
export const hashed = (type: "blob" | "tree" | "commit", object: Uint8Array): Uint8Array =>
  joined([encoder.encode(`${type} ${object.length}\0`), object]);

/** git sorts names by their UTF-8 bytes. JavaScript's `<` sorts by UTF-16 units, which differ past U+E000. @internal */
export const byBytes = (a: string, b: string): number => {
  const x = encoder.encode(a);
  const y = encoder.encode(b);

  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const delta = (x[i] ?? 0) - (y[i] ?? 0);

    if (delta !== 0) {
      return delta;
    }
  }

  return x.length - y.length;
};

/** The mode git writes for a folder in a tree. @internal */
export const FOLDER = "40000";

/** One line of a folder: a file's mode or a folder's, its name, and the id of its blob or its tree. @internal */
export interface Line {
  readonly mode: string;
  readonly name: string;
  readonly id: string;
}

// A folder sorts as if its name ended in `/`, so `a.b` comes before a folder `a`, and `a0` after it.
const sortName = (line: Line): string => (line.mode === FOLDER ? `${line.name}/` : line.name);

const rawId = (hex: string): Uint8Array =>
  Uint8Array.from({ length: hex.length / 2 }, (_, at) => Number.parseInt(hex.slice(at * 2, at * 2 + 2), 16));

/** One folder's bytes: each line as `<mode> <name>`, a NUL byte and the id's raw bytes, in git's order. @internal */
export const treeBytes = (lines: ReadonlyArray<Line>): Uint8Array =>
  joined(
    [...lines]
      .sort((a, b) => byBytes(sortName(a), sortName(b)))
      .flatMap((line) => [encoder.encode(`${line.mode} ${line.name}\0`), rawId(line.id)]),
  );
