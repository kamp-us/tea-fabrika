// `pnpm lint:node-kinds`: every name in `node-kinds.json` is real (0524, ticket 933, L6). The file
// names exports that code-graph treats as used, so a made-up name would hide a dead export. Each name
// must be exported by a file its glob matches, and bound by that same string somewhere else in
// `next/`, as the platform binds a class by its name. This was the exam's `node-kinds.test.ts` until
// 0591 made it a lint command; its laws are in `node-kinds.test.ts`.
//
// The glob is package-relative, as in code-graph 0.15.0's `conventionMatcher`: "src/brain.ts" matches
// `src/brain.ts` inside the nearest folder with a package.json. Test files are left out, as code-graph
// and exam-paths.json class them.
//
//   node oxlint-plugins/node-kinds.ts            # this repo
//   node oxlint-plugins/node-kinds.ts <folder>   # another tree, as the test does
//
// Exit 0 when every name is real, 1 on a name that is not.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, matchesGlob } from "node:path";
import { Schema } from "effect";
import { parseSync } from "oxc-parser";

const CODE = /\.[cm]?[jt]sx?$/;
const TEST = /(?:\.test\.tsx?|Test\.ts|\.test-support\.ts)$/;

const Kinds = Schema.fromJsonString(
  Schema.Struct({
    entryExportConventions: Schema.Record(
      Schema.String,
      Schema.Struct({ files: Schema.String, exports: Schema.Array(Schema.String) }),
    ),
  }),
);

/** A folder git never tracks here: installs, builds, run logs at the top, and dot folders. */
const untracked = (path: string, name: string) =>
  name === "node_modules" || name === "dist" || name.startsWith(".") || path === "runs";

/** What is wrong with `root`'s `node-kinds.json`, one line per problem; empty when every name is real. */
export const nodeKindProblems = (root: string): ReadonlyArray<string> => {
  /** The tree's files, from the top, read with no git, as the exam's law read them. */
  const walk = (dir: string): ReadonlyArray<string> =>
    readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
      const path = dir === "" ? entry.name : `${dir}/${entry.name}`;
      return entry.isDirectory() ? (untracked(path, entry.name) ? [] : walk(path)) : entry.isFile() ? [path] : [];
    });
  const tracked = walk("");
  const packages = tracked
    .filter((p) => p === "package.json" || p.endsWith("/package.json"))
    .map((p) => dirname(p))
    .sort((a, b) => b.length - a.length);
  /** A path inside its nearest package, as code-graph matches a convention's glob against it. */
  const inPackage = (path: string) => {
    const dir = packages.find((d) => d === "." || path.startsWith(`${d}/`)) ?? ".";
    return dir === "." ? path : path.slice(dir.length + 1);
  };
  const sources = tracked.filter((p) => p.startsWith("next/") && CODE.test(p) && !TEST.test(p));
  const read = (path: string) => readFileSync(join(root, path), "utf8");
  /** A file's text with every comment blanked, so a name in a comment is no binding. */
  const code = (path: string) => {
    const text = read(path);
    const { comments } = parseSync(path, text);
    return comments.reduce((out, c) => out.slice(0, c.start) + " ".repeat(c.end - c.start) + out.slice(c.end), text);
  };
  const exported = (path: string) =>
    parseSync(path, read(path)).module.staticExports.flatMap((e) => e.entries.map((x) => x.exportName.name));
  const kinds = Schema.decodeUnknownSync(Kinds)(read("node-kinds.json"));
  const found: Array<string> = [];

  for (const [name, { files, exports }] of Object.entries(kinds.entryExportConventions)) {
    const homes = tracked.filter((p) => CODE.test(p) && !TEST.test(p) && matchesGlob(inPackage(p), files));

    if (homes.length === 0) {
      found.push(`${name}: its glob ${files} matches no file`);
      continue;
    }

    const names = new Set(homes.flatMap(exported));
    const others = sources.filter((p) => !homes.includes(p)).map(code);

    for (const binding of exports) {
      if (!names.has(binding)) {
        found.push(`${name}: ${binding} is not exported by ${homes.join(", ")}`);
      }

      const literal = new RegExp(`(["'\`])${binding.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1`);

      if (!others.some((text) => literal.test(text))) {
        found.push(`${name}: ${binding} is bound by no string in next/ outside ${homes.join(", ")}`);
      }
    }
  }

  return found;
};

if (import.meta.main) {
  const found = nodeKindProblems(process.argv[2] ?? join(import.meta.dirname, ".."));

  for (const line of found) {
    console.error(`node-kinds.json: ${line}`);
  }

  console.info(`lint:node-kinds: ${found.length} findings`);
  process.exitCode = found.length === 0 ? 0 : 1;
}
