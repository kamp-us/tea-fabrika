// Names: the exported names a pull request adds, and whether its description names each one under
// `## New names` (0587). A name added there says what the industry calls it, with the source; the
// review judges that line, and this file only checks that it is there. Queue.add and Arm.arm read
// it before they ask GitHub to merge. Pure. Today's lead tooling, run on our own laptop. Read
// through its module: `Names.refusal(...)`.
import type { Patch } from "./PullRequests.ts";

/**
 * A file whose exports are names: code, no test and no fixture. A test's exports are its own, and a
 * fixture is a toy project's code, data to the tests that read it (AGENTS.md).
 */
const CODE = /\.(?:[cm]?ts|tsx|[cm]?js)$/;
const TEST = /\.test\.[cm]?[jt]sx?$/;
const FIXTURE = /(?:^|\/)fixtures\//;

export const isCode = (path: string): boolean => CODE.test(path) && !TEST.test(path) && !FIXTURE.test(path);

const DECLARED =
  /^export\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:(?:const|let|var|class|interface|type|enum|namespace)\s+|function\s*\*?\s*)([A-Za-z_$][\w$]*)/;

const LISTED = /^export\s+(?:type\s+)?\{([^}]*)\}/;

/** The names one line of code exports: a declaration's name, or each name of an export list. */
export const exported = (line: string): ReadonlyArray<string> => {
  const text = line.trimStart();
  const declared = DECLARED.exec(text);

  if (declared?.[1] !== undefined) {
    return [declared[1]];
  }

  const listed = LISTED.exec(text);

  if (listed?.[1] === undefined) {
    return [];
  }

  return listed[1]
    .split(",")
    .map(
      (part) =>
        part
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)
          .at(-1)
          ?.trim() ?? "",
    )
    .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name) && name !== "default");
};

/** The names the `+` or `-` lines of one patch export. */
const side = (patch: string, mark: "+" | "-"): ReadonlyArray<string> =>
  patch
    .split("\n")
    .filter((line) => line.startsWith(mark))
    .flatMap((line) => exported(line.slice(1)));

/**
 * The names a change exports that it did not export before, each once, in order: on a `+` line of a
 * code file and on no `-` line of any code file. A name moved between files, or an export line
 * reformatted, is not new.
 */
export const added = (patches: ReadonlyArray<Patch>): ReadonlyArray<string> => {
  const code = patches.filter((p) => isCode(p.path));
  const gone = new Set(code.flatMap((p) => (p.patch === null ? [] : side(p.patch, "-"))));
  return [...new Set(code.flatMap((p) => (p.patch === null ? [] : side(p.patch, "+"))))].filter((n) => !gone.has(n));
};

/** The code files GitHub shows no patch for, whose names cannot be read. */
export const unread = (patches: ReadonlyArray<Patch>): ReadonlyArray<string> =>
  patches.filter((p) => isCode(p.path) && p.patch === null).map((p) => p.path);

/** The text under the description's `## New names` heading, up to the next heading; none without one. */
export const section = (body: string): string | null => {
  const lines = body.replaceAll("\r", "").split("\n");
  const start = lines.findIndex((line) => /^##\s+new names\s*$/i.test(line.trim()));

  if (start === -1) {
    return null;
  }

  const end = lines.findIndex((line, i) => i > start && /^#{1,2}\s/.test(line));
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
};

const escape = (name: string) => name.replaceAll("$", "\\$");

/** Whether `text` holds `name` as a whole word. */
const says = (text: string, name: string): boolean => new RegExp(`(?<![\\w$])${escape(name)}(?![\\w$])`).test(text);

/**
 * Why a pull request may not merge on its names, or `null` when it may: each new exported name is
 * named under `## New names`, and a change with a code file GitHub shows no patch for has the
 * section at all, since its names cannot be read.
 */
export const refusal = (body: string, patches: ReadonlyArray<Patch>): string | null => {
  const names = added(patches);
  const hidden = unread(patches);
  const said = section(body);

  if (said === null && hidden.length > 0) {
    return `GitHub shows no patch for ${hidden.join(", ")}, so its new names cannot be read; add a ## New names section with a line for each (0587, the pr skill)`;
  }

  const missing = names.filter((name) => said === null || !says(said, name));
  return missing.length === 0
    ? null
    : `its diff exports new names its ## New names section does not name: ${missing.join(", ")}; add one line each, what the industry calls it, with the source (0587, the pr skill)`;
};
