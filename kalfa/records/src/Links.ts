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
import { prose } from "./Prose.ts";
import { decodeStatus } from "./Status.ts";
import { read, Tracked } from "./Tracked.ts";

const HISTORY = [".decisions/", "experiments/", "field/", "docs/direction/"];

const MARKDOWN = [".agents/skills/", "docs/guidelines/", ".runbooks/", "docs/plan/", ".patterns/", ".glossary/"];

const INSTRUCTION = /(^|\/)(AGENTS|CLAUDE)\.md$/;

const SLASHES = /\.(ts|tsx|js|mjs)$/;

const HASH = /\.(sh|yaml)$/;

/** `[text](target "title")`, the target alone or in angle brackets. */
const INLINE = /\[[^\]]*\]\(\s*(<[^>]*>|[^\s)]*)/g;

/** `[name]: target "title"` at the start of a line. */
const DEFINITION = /^ {0,3}\[[^\]]+\]:\s*(<[^>]*>|\S+)/;

const RECORD = /^\.decisions\/(\d{4})-[^/]+\.md$/;

/** A record's path in a comment, from the repo root. */
const CITED = /\.decisions\/(\d{4})-[A-Za-z0-9._-]+\.md/g;

const inHistory = (file: string, folders: ReadonlyArray<string>) => folders.some((folder) => file.startsWith(folder));

const markdown = (file: string) =>
  file.endsWith(".md") &&
  !inHistory(file, HISTORY) &&
  (INSTRUCTION.test(file) || MARKDOWN.some((folder) => file.startsWith(folder)));

const code = (file: string) => (SLASHES.test(file) || HASH.test(file)) && !inHistory(file, ["experiments/", "field/"]);

/** The part of a link target that names a file: no `<>`, no `#anchor`, and nothing that is not a path in this repo. */
const target = (written: string) => {
  const bare = written.startsWith("<") ? written.slice(1, -1) : written;
  const file = bare.split(/[#?]/, 1)[0] ?? "";

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

  const finding = (file: string, line: number, number: string | undefined) => {
    const live = number === undefined ? undefined : superseded.get(number);

    return number === undefined || live === undefined
      ? []
      : [Finding.cases.link.make({ path: file, line, target: number, live })];
  };

  const files = (yield* tracked.files).filter((entry) => !entry.symlink).map((entry) => entry.path);

  const texts = yield* read(
    root,
    files.filter((file) => markdown(file) || code(file)),
  );

  return texts.flatMap(({ path: file, text }) => {
    if (markdown(file)) {
      return prose(text).flatMap(({ line, text: each }) => {
        const written = [...each.matchAll(INLINE)].map((match) => match[1] ?? "");
        const defined = DEFINITION.exec(each)?.[1];

        return [...written, ...(defined === undefined ? [] : [defined])].flatMap((link) => {
          const there = target(link);
          const resolved = there === "" ? "" : path.normalize(path.join(path.dirname(file), there));

          return finding(file, line, RECORD.exec(resolved)?.[1]);
        });
      });
    }

    return comments(text, HASH.test(file) ? "hash" : "slashes").flatMap(({ line, text: each }) =>
      [...each.matchAll(CITED)].flatMap((match) => finding(file, line, match[1])),
    );
  });
});
