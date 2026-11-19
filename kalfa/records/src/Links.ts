/**
 * The link check (decision 0607): every link lands on a live record. A Markdown link, or a
 * `.decisions/NNNN-slug.md` path in a code comment, to a superseded record is one finding that names
 * its successor.
 *
 * Read: `AGENTS.md` and `CLAUDE.md` files, `.agents/skills/`, `docs/guidelines/`, `.runbooks/`,
 * `docs/plan/`, `.patterns/` and `.glossary/` (Markdown), and the comments of tracked `.ts`, `.tsx`,
 * `.js`, `.mjs`, `.sh` and `.yaml` files. Not read: `.decisions/`, `experiments/`, `field/` and
 * `docs/direction/`, which are history, fenced code, symlinks, and a bare number, which is too often a
 * count or a port.
 */
import { Effect, Path, Result } from "effect";
import { comments } from "./Comments.ts";
import { Finding } from "./Finding.ts";
import { decisions, parse } from "./Frontmatter.ts";
import { markdown } from "./Markdown.ts";
import { decodeStatus } from "./Status.ts";
import { read, Tracked } from "./Tracked.ts";

const HISTORY = [".decisions/", "experiments/", "field/", "docs/direction/"];

const MARKDOWN = [".agents/skills/", "docs/guidelines/", ".runbooks/", "docs/plan/", ".patterns/", ".glossary/"];

const INSTRUCTION = /(^|\/)(AGENTS|CLAUDE)\.md$/;

const CODE = /\.(ts|tsx|js|mjs|sh|yaml)$/;

const RECORD = /^\.decisions\/(\d{4})-[^/]+\.md$/;

/** A record's path in a comment, from the repo root. */
const CITED = /\.decisions\/(\d{4})-[A-Za-z0-9._-]+\.md/g;

const inHistory = (file: string, folders: ReadonlyArray<string>) => folders.some((folder) => file.startsWith(folder));

const page = (file: string) =>
  file.endsWith(".md") &&
  !inHistory(file, HISTORY) &&
  (INSTRUCTION.test(file) || MARKDOWN.some((folder) => file.startsWith(folder)));

const source = (file: string) => CODE.test(file) && !inHistory(file, ["experiments/", "field/"]);

/** The part of a link target that names a file: no `#anchor`, and nothing that is not a path in this repo. */
const target = (written: string) => {
  const file = written.split(/[#?]/, 1)[0] ?? "";

  return /^[a-z][a-z0-9+.-]*:/i.test(file) || file.startsWith("/") ? "" : file;
};

/**
 * The `link` findings of the whole repo, from the status of each decision.
 *
 * @category constructors
 */
export const check = Effect.fnUntraced(function* (root: string) {
  const path = yield* Path.Path;
  const tracked = yield* Tracked;
  const all = yield* decisions(root);

  // Number to successor, for the records that are superseded.
  const superseded = new Map<string, string>();

  for (const { path: file, number, text } of all) {
    const parsed = parse(text);
    const status = Result.isFailure(parsed) ? undefined : decodeStatus(parsed.success.values, { path: file, line: 1 });

    if (status !== undefined && Result.isSuccess(status) && status.success._tag === "superseded") {
      superseded.set(number, status.success.successor);
    }
  }

  /** The record at the end of the chain of successors from `number`, and `undefined` if `number` is not superseded. A chain that loops stops before it follows a record twice. */
  const live = (number: string) => {
    const first = superseded.get(number);

    if (first === undefined) {
      return undefined;
    }

    const seen = new Set([number, first]);
    let end = first;

    for (let next = superseded.get(end); next !== undefined && !seen.has(next); next = superseded.get(end)) {
      seen.add(next);
      end = next;
    }

    return end;
  };

  const finding = (file: string, line: number, number: string | undefined) => {
    const end = number === undefined ? undefined : live(number);

    return number === undefined || end === undefined
      ? []
      : [Finding.cases.link.make({ path: file, line, target: number, live: end })];
  };

  const files = (yield* tracked.files).filter((entry) => !entry.symlink).map((entry) => entry.path);

  const texts = yield* read(
    root,
    files.filter((file) => page(file) || source(file)),
  );

  return texts.flatMap(({ path: file, text }) => {
    if (page(file)) {
      return markdown(text).links.flatMap(({ url, line }) => {
        const there = target(url);
        const resolved = there === "" ? "" : path.normalize(path.join(path.dirname(file), there));

        return finding(file, line, RECORD.exec(resolved)?.[1]);
      });
    }

    return comments(file, text).flatMap(({ line, text: each }) =>
      [...each.matchAll(CITED)].flatMap((match) => finding(file, line, match[1])),
    );
  });
});
