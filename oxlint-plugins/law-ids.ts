// `pnpm lint`'s hold on law ids: two different laws in one `kalfa/` package may not share an id. A law id is the short
// code that starts a test name, like `"S9 ..."` or `"P12 ..."`, in the first argument of an `it` or `test` call (any
// chain, such as `it.effect.prop`), in any `.ts` or `.tsx` file (a support file such as `Repository.test-support.ts`
// or `RepositoryTest.ts` names laws too). A package is a folder with its own package.json. It is a lint step and not
// an oxlint rule, since a rule sees one file at a time.
//
// What marks one law: its subject, the words after the id up to the first colon, once a kind word (`vector`,
// `scenario`, `property`, `type`, `plant`, `pinned`) is dropped. One law may have many cases, so two names are the
// same law when their full text is equal (a law in a support file run by a test file), or their subjects are equal,
// or one subject is the start of the other (`it reads back` and `it reads back under S2`). A name with no subject,
// only a kind word or no colon, is the same law as any other such name: nothing in its text tells them apart.
//
// Only `kalfa/` is checked. In `next/` an id such as `L11` is numbered again in each ticket and file, so one id is
// on purpose many laws in one package.
//
//   node oxlint-plugins/law-ids.ts            # this repo
//   node oxlint-plugins/law-ids.ts <folder>   # another git tree, as the test does
//
// Exit 0 when clean, 1 on a clash, 2 when git listed nothing, which must never read as clean.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** A test name opening a call: `it(`, `test(`, `it.effect.prop(`, `it.each(rows)(`, then the name's quote and id. */
const NAME =
  /\b(?:it|test)(?:\.\w+)*(?:\.each\([^)]*\))?\(\s*(["'`])([A-Z]{1,3}\d+[a-z]?)(?=[ :])((?:\\.|(?!\1)[^\\])*)\1/g;

const SOURCE = /\.tsx?$/;

const KIND = /^(?:vector|scenario|property|type|plant|pinned)\b:?\s*/;

type Place = { readonly name: string; readonly at: string };

/** The words after the id and its kind word, up to the first colon; empty when the name has none. */
const subject = (name: string): string => {
  const rest = name.replace(/^\S+\s+/, "").replace(KIND, "");
  const colon = rest.indexOf(":");

  return colon > 0 && colon < 80 ? rest.slice(0, colon).trim() : "";
};

const sameLaw = (a: string, b: string): boolean => {
  const [x, y] = [subject(a), subject(b)];

  return a === b || x === y || (x !== "" && y !== "" && (x.startsWith(`${y} `) || y.startsWith(`${x} `)));
};

const root = process.argv[2] ?? join(import.meta.dirname, "..");

const listed = spawnSync("git", ["ls-files", "-z", "--", "kalfa"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 2 ** 30,
});

const tracked = listed.stdout.split("\0").filter((file) => file !== "");

if (listed.status !== 0 || tracked.length === 0) {
  console.error(`law-ids: git found no files to check.\n${listed.stderr}`);
  process.exit(2);
}

const manifests = new Set(tracked.filter((file) => file.endsWith("/package.json")).map((file) => dirname(file)));

/** The nearest folder up from a file that holds a package.json. */
const packageOf = (file: string): string => {
  let folder = dirname(file);

  while (folder !== "." && !manifests.has(folder)) {
    folder = dirname(folder);
  }

  return folder;
};

const found = new Map<string, Place[]>();

for (const file of tracked.filter((f) => SOURCE.test(f))) {
  const text = readFileSync(join(root, file), "utf8");

  for (const match of text.matchAll(NAME)) {
    const line = text.slice(0, match.index + match[0].indexOf(match[1])).split("\n").length;
    const key = `${packageOf(file)}|${match[2]}`;

    found.set(key, [...(found.get(key) ?? []), { name: match[2] + match[3], at: `${file}:${line}` }]);
  }
}

const lines: string[] = [];

for (const [key, places] of found) {
  if (places.some((one) => places.some((other) => !sameLaw(one.name, other.name)))) {
    lines.push(
      `${key}: different laws share this id`,
      ...places.map((place) => `  ${place.at}  ${place.name.slice(0, 90)}`),
    );
  }
}

if (lines.length > 0) {
  console.error(`law-ids: two laws in one package may not share an id.\n${lines.join("\n")}`);
  process.exit(1);
}
