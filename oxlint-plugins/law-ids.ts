// `pnpm lint`'s hold on law ids: two different laws in one package may not share an id. A law id is the short code that
// starts a test name, like `"S9 ..."` or `"P12 ..."`, in the first argument of an `it` or `test` call (any chain, such
// as `it.effect.prop`) in a `*.test.ts` or `*.test-support.ts` file. A package is a folder with its own package.json
// under `kalfa/` or `next/`. The same law named from two places (a support file run by one test file) has one full name
// text, so it is one law. It is a lint step and not an oxlint rule, since a rule sees one file at a time.
//
// A law split over several tests with one id already exists in many packages. Those sit in
// `law-ids-baseline.json` as `<package>|<id>`: the number of different names that id may have. The list only shrinks: a
// count above its line fails, and so does a line above the real count.
//
//   node oxlint-plugins/law-ids.ts            # this repo
//   node oxlint-plugins/law-ids.ts <folder>   # another git tree, as the test does
//
// Exit 0 when clean, 1 on a clash, 2 when git listed nothing, which must never read as clean.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** A test name opening a call: `it(`, `test(`, `it.effect.prop(`, `it.each(rows)(`, then the name's quote and id. */
const NAME =
  /\b(?:it|test)(?:\.\w+)*(?:\.each\([^)]*\))?\(\s*(["'`])([A-Z]{1,3}\d+[a-z]?)(?=[ :])((?:\\.|(?!\1)[^\\])*)\1/g;

const TEST_FILE = /\.test(?:-support)?\.tsx?$/;

type Place = { readonly name: string; readonly at: string };

const root = process.argv[2] ?? join(import.meta.dirname, "..");

const listed = spawnSync("git", ["ls-files", "-z", "--", "kalfa", "next"], {
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

for (const file of tracked.filter((f) => TEST_FILE.test(f))) {
  const text = readFileSync(join(root, file), "utf8");

  for (const match of text.matchAll(NAME)) {
    const line = text.slice(0, match.index + match[0].indexOf(match[1])).split("\n").length;
    const key = `${packageOf(file)}|${match[2]}`;

    found.set(key, [...(found.get(key) ?? []), { name: match[2] + match[3], at: `${file}:${line}` }]);
  }
}

const baselineFile = join(root, "oxlint-plugins", "law-ids-baseline.json");

const baseline: Readonly<Record<string, number>> = existsSync(baselineFile)
  ? JSON.parse(readFileSync(baselineFile, "utf8"))
  : {};

const lines: string[] = [];

for (const [key, places] of found) {
  const names = new Set(places.map((place) => place.name)).size;
  const allowed = baseline[key] ?? 1;

  if (names > allowed) {
    lines.push(
      `${key}: ${names} different laws share this id (${allowed} allowed)`,
      ...places.map((place) => `  ${place.at}  ${place.name.slice(0, 90)}`),
    );
  } else if (names < allowed) {
    lines.push(`${key}: law-ids-baseline.json allows ${allowed} but only ${names} remain; lower it or delete the line`);
  }
}

for (const key of Object.keys(baseline)) {
  if (!found.has(key)) {
    lines.push(`${key}: law-ids-baseline.json names an id that no test has; delete the line`);
  }
}

if (lines.length > 0) {
  console.error(`law-ids: two laws in one package may not share an id.\n${lines.join("\n")}`);
  process.exit(1);
}
