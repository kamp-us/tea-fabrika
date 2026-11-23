// A commit object's bytes, as git writes them: the memory adapter hashes them for an id and measures them for the byte limit.
import type * as Commit from "../Commit.ts";

const encoder = new TextEncoder();

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

type Fields = Pick<Commit.Commit, "parents" | "author" | "committer" | "message">;

const ident = (signature: Commit.Signature): string =>
  `${signature.name} <${signature.email}> ${signature.at.seconds} ${signature.at.offset}`;

/** @internal */
export const bytes = (fields: Fields): Uint8Array => {
  const head = [
    `tree ${EMPTY_TREE}`,
    ...fields.parents.map((parent) => `parent ${parent}`),
    `author ${ident(fields.author)}`,
    `committer ${ident(fields.committer)}`,
  ].join("\n");

  return encoder.encode(`${head}\n\n${fields.message}`);
};

/** What git hashes for a commit: the word, the size, a NUL byte, then the object's bytes. @internal */
export const hashed = (object: Uint8Array): Uint8Array => {
  const header = encoder.encode(`commit ${object.length}\0`);
  const whole = new Uint8Array(header.length + object.length);
  whole.set(header);
  whole.set(object, header.length);

  return whole;
};
