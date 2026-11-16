// records.ts: lists one folder of records as it is on origin/main, one line per record, and for the
// numbered folders gives the next free number (decision 0522). It also ranks the records a few
// words are about, and says which decision a cited one lands on. Today's lead tooling, run on our
// own laptop; it is not product. No folder keeps an index table, so this is the list a table was.
//
//   node records.ts list <folder>      one line per record, then `next NNNN` for a numbered folder
//   node records.ts next <folder>      only the next free number
//   node records.ts find <words>...    the records these words are about, best first
//   node records.ts resolve <id>...    each decision's status, and the live one a superseded one names
//
// <folder> is `.decisions`, `experiments`, `.patterns`, `docs/direction` or `.runbooks`, with or
// without a trailing slash. It runs in the checkout it is started in.
//
// `find` searches those five folders and each row of `.glossary/TERMS.md`, and ranks them the way
// phoenix's `fabrika adr sweep` does (experiment 270): each word the query shares with a record is
// worth its rarity, ln(N / records that hold it), over the live records. It reads only the text
// that says what a record is: a decision's title, its "What this decides" line and its
// `## Decision` section; a note's title and its `summary` (`where` and `when` for a pattern); a
// glossary row whole. Context sections and long bodies are left out on purpose: experiment 270
// found that whole notes swamp the ranking. A superseded decision is shown as the live decision it
// lands on, and an amended one names its amendments, so a citation lands on what is in force;
// `--all` shows each record as itself. A shortlist is never a clearance: a record that says the same
// thing in other words is not found.
//
// It fetches origin's main first, then reads `origin/main` through git (`ls-tree`, `cat-file`),
// never the working tree, so a file that is only local or only on an unmerged branch never takes a
// number or a line. The next number is the highest on main plus one, never a gap below it: a gap
// is a number some pull request held and never merged, as phoenix's `fabrika adr next` says. An
// open pull request can still hold the same number; the adr skill's check of open pull requests
// covers that.
//
// Each record says what it is at its own top. A decision's frontmatter gives `title` and `status`.
// The other folders keep a small frontmatter block of their own, read with the file's `# `
// heading as the title:
//
//   experiments/NN-title.md    date, scripts (only when the write-up does not name them), summary
//   .patterns/name.md          where, when
//   docs/direction/name.md     state (when it has one), summary; a subfolder's README.md is a record
//   .runbooks/operation.md     summary (decision 0571)
//
// A value is one line: plain, or a JSON string in double quotes. A record whose block lacks a key
// prints `(no <key>)`, so a missing top shows instead of hiding.
//
// Exit 0 with an answer. Exit 1 when origin/main cannot be fetched or read: it prints that the list
// is unknown, never "0 records" and never a next number. Exit 2 when the command line is wrong.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Exit, Option, Predicate, Schema, Stream } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { ChildProcess } from "effect/process";

/** The ref every answer is read from. */
const BASE = "origin/main";

/** The five folders of records. */
export type Folder = ".decisions" | "experiments" | ".patterns" | "docs/direction" | ".runbooks";

/** How one folder's records say what they are. */
type Spec = {
  /** The digits a number pads to, for a numbered folder; `undefined` for a folder with no numbers. */
  readonly width: number | undefined;
  /** Where the title comes from: the frontmatter's `title`, or the file's `# ` heading. */
  readonly title: "frontmatter" | "heading";
  /** Frontmatter keys printed bare, before the title. */
  readonly before: ReadonlyArray<string>;
  /** Frontmatter keys printed as `key: value`, after the title. */
  readonly after: ReadonlyArray<string>;
  /** Keys of `after` left out when a record has none, as a note with no state. */
  readonly optional: ReadonlyArray<string>;
  /** Whether a subfolder's own README.md is a record too. */
  readonly nested: boolean;
  /** Frontmatter keys `find` reads besides the title. A decision adds two parts of its body. */
  readonly words: ReadonlyArray<string>;
};

const specs: Record<Folder, Spec> = {
  ".decisions": {
    width: 4,
    title: "frontmatter",
    before: ["status"],
    after: [],
    optional: [],
    nested: false,
    words: [],
  },
  experiments: {
    width: 2,
    title: "heading",
    before: ["date"],
    after: ["summary"],
    optional: [],
    nested: false,
    words: ["summary"],
  },
  ".patterns": {
    width: undefined,
    title: "heading",
    before: ["where"],
    after: ["when"],
    optional: [],
    nested: false,
    words: ["where", "when"],
  },
  "docs/direction": {
    width: undefined,
    title: "heading",
    before: [],
    after: ["state", "summary"],
    optional: ["state"],
    nested: true,
    words: ["summary"],
  },
  ".runbooks": {
    width: undefined,
    title: "heading",
    before: [],
    after: ["summary"],
    optional: [],
    nested: false,
    words: ["summary"],
  },
};

const recordNumber = (name: string): number | undefined => {
  const digits = /^(\d+)[a-z]?-/.exec(name)?.[1];
  return digits === undefined ? undefined : Number(digits);
};

/**
 * Whether a path from the top of the repo is one of the folder's records: a Markdown file in it
 * that is not its README, or, in a nested folder, a subfolder's README.
 */
export const isRecord = (folder: Folder, path: string): boolean => {
  if (!path.startsWith(`${folder}/`) || !path.endsWith(".md")) {
    return false;
  }

  const parts = path.slice(folder.length + 1).split("/");

  if (parts.length === 1) {
    return parts[0] !== "README.md" && (folder !== ".decisions" || recordNumber(parts[0] ?? "") !== undefined);
  }

  return specs[folder].nested && parts.length === 2 && parts[1] === "README.md";
};

/** What a record's top says: its frontmatter keys, and its first `# ` heading. */
type Top = { readonly fields: ReadonlyMap<string, string>; readonly heading: string | undefined };

const JsonString = Schema.fromJsonString(Schema.String);

const unquoted = (raw: string): string =>
  raw.startsWith('"') ? Option.getOrElse(Schema.decodeUnknownOption(JsonString)(raw), () => raw) : raw;

/** Reads a record's top: a frontmatter block when the text opens with one, then the first heading. */
export const readTop = (text: string): Top => {
  const lines = text.split("\n");
  const fields = new Map<string, string>();
  let rest = lines;

  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);

    if (end > 0) {
      for (const line of lines.slice(1, end)) {
        const pair = /^([a-z]+):\s*(.*)$/.exec(line);

        if (pair?.[1] !== undefined && pair[2] !== undefined) {
          fields.set(pair[1], unquoted(pair[2].trim()));
        }
      }

      rest = lines.slice(end + 1);
    }
  }

  const heading = rest
    .find((line) => line.startsWith("# "))
    ?.slice(2)
    .trim();
  return { fields, heading };
};

const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

// A heading often repeats the record's number: "# 286. Can ...", "# 153: Codex ...", "# Experiment 176: ...".
const withoutNumber = (heading: string) => heading.replace(/^(experiment\s+)?\d+[a-z]?[.:]\s+/i, "");

/** A record's title, from where its folder keeps it. */
const recordTitle = (folder: Folder, top: Top): string | undefined =>
  specs[folder].title === "frontmatter"
    ? top.fields.get("title")
    : top.heading === undefined
      ? undefined
      : withoutNumber(top.heading);

/** The line a record prints: its id, the bare keys, its title, then the `key: value` keys. */
export const recordLine = (folder: Folder, path: string, text: string): string => {
  const spec = specs[folder];
  const top = readTop(text);
  const name = path.slice(folder.length + 1).replace(/\.md$/, "");
  const id = spec.width === undefined ? name : (/^\d+[a-z]?(?=-)/.exec(name)?.[0] ?? name);
  const field = (key: string) => {
    const value = top.fields.get(key);
    return value === undefined ? `(no ${key})` : oneLine(value);
  };
  const title = recordTitle(folder, top);
  return [
    id,
    ...spec.before.map(field),
    title === undefined ? "(no title)" : oneLine(title),
    ...spec.after
      .filter((key) => top.fields.has(key) || !spec.optional.includes(key))
      .map((key) => `${key}: ${field(key)}`),
  ].join("  ");
};

/**
 * The next free number in a numbered folder, padded: the highest number among these paths plus one.
 * `undefined` for a folder with no numbers. The paths are a read that succeeded, so none means 1.
 */
export const nextNumber = (folder: Folder, paths: ReadonlyArray<string>): string | undefined => {
  const width = specs[folder].width;

  if (width === undefined) {
    return undefined;
  }

  const numbers = paths
    .filter((path) => isRecord(folder, path))
    .map((path) => recordNumber(path.slice(folder.length + 1)))
    .filter((n) => n !== undefined);
  return String(Math.max(0, ...numbers) + 1).padStart(width, "0");
};

/**
 * The folder's records among these paths, in the order a reader expects: by number in a numbered
 * folder, so 65 comes before 203 and a record with no number after them, then by name.
 */
export const inOrder = (folder: Folder, paths: ReadonlyArray<string>): ReadonlyArray<string> =>
  paths
    .filter((path) => isRecord(folder, path))
    .map((path) => ({ path, number: recordNumber(path.slice(folder.length + 1)) ?? Infinity }))
    .sort((a, b) => a.number - b.number || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((r) => r.path);

// ---------------------------------------------------------------- find and resolve

/** The folders `find` searches, and the one file whose table rows it searches too. */
const searched: ReadonlyArray<Folder> = [".decisions", ".runbooks", ".patterns", "docs/direction", "experiments"];
const GLOSSARY = ".glossary/TERMS.md";

/** Below this many live records, every word looks common, so a ranking says nothing (phoenix's floor). */
const FLOOR = 10;

/**
 * Plain English stopwords, as phoenix's sweep lists them. Our own common words need no list: a word
 * most records hold is worth almost nothing.
 */
const STOPWORDS = new Set(
  `a about above after again against all also although always am an and any are as at be because
  been before being below between both but by can cannot could did do does doing done down during
  each either else even ever every few for from further had has have having her here hers him his
  how however if in instead into is it its itself just less let like made make makes many may
  might more most much must never new no nor not now of off on once one only or other our out over
  own per rather same shall she should since so some still such than that the their them then
  there these they this those though through thus to too two under until up upon use used uses
  using very was way we well were what when where whether which while who whom whose why will with
  within without would yet you your`.split(/\s+/),
);

/** A text's words: lowercase, three letters or more, never only digits (that is an id), no stopword. */
export const wordsIn = (text: string): ReadonlySet<string> =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 3 && !/^\d+$/.test(word) && !STOPWORDS.has(word)),
  );

/** A decision's status, read from its frontmatter. An amendment narrows a decision; it is still in force. */
export const Status = Schema.TaggedUnion({
  accepted: { amendedBy: Schema.Array(Schema.String) },
  superseded: { by: Schema.Array(Schema.String) },
  other: { status: Schema.String },
});
export type Status = typeof Status.Type;

/** Reads `accepted`, `amended-in-part by [0525](...), [0530](...)` or `superseded by [0043](...)`. */
export const readStatus = (raw: string | undefined): Status => {
  const status = (raw ?? "").trim();
  const ids = [...status.matchAll(/\[(\d{4})\]/g)].map((m) => m[1] ?? "");

  if (/^superseded by\b/i.test(status)) {
    return Status.cases.superseded.make({ by: ids });
  }

  return status === "accepted" || /^amended-in-part by\b/i.test(status)
    ? Status.cases.accepted.make({ amendedBy: ids })
    : Status.cases.other.make({ status: status === "" ? "(no status)" : status });
};

/** One thing `find` ranks: a record, or one row of the glossary. A decision carries its id and status. */
export type Entry = {
  readonly path: string;
  readonly title: string;
  readonly words: ReadonlySet<string>;
  readonly decision: { readonly id: string; readonly status: Status } | undefined;
};

/** The part of a decision that says what it decides: its gloss line and its `## Decision` section. */
const decidingText = (text: string): string => {
  const body = text.replace(/^---\n[\s\S]*?\n---/, "");
  const gloss = /^\*\*What this decides:\*\*([^\n]*(?:\n(?!\n)[^\n]*)*)/m.exec(body)?.[1] ?? "";
  // A decision with no Decision section gives its whole body, so it is still found.
  const decision = body.split(/^##\s+/m).find((section) => /^Decision\b/.test(section)) ?? body;
  return `${gloss}\n${decision}`;
};

/** A glossary table's rows, header rows left out: the first cell is the term, the row is its words. */
const glossaryEntries = (path: string, text: string): ReadonlyArray<Entry> => {
  const lines = text.split("\n");
  const separator = (line: string | undefined) => line !== undefined && /^\|\s*:?-{3}/.test(line);
  return lines.flatMap((line, i) => {
    if (!line.startsWith("|") || separator(line) || separator(lines[i + 1])) {
      return [];
    }

    const term = (line.split(/(?<!\\)\|/)[1] ?? "").trim();
    return term === "" ? [] : [{ path, title: term, words: wordsIn(line), decision: undefined }];
  });
};

/** What `find` ranks in one file from main: one entry for a record, one per row for the glossary. */
export const readEntries = (path: string, text: string): ReadonlyArray<Entry> => {
  if (path === GLOSSARY) {
    return glossaryEntries(path, text);
  }

  const folder = searched.find((at) => isRecord(at, path));

  if (folder === undefined) {
    return [];
  }

  const top = readTop(text);
  const title = oneLine(recordTitle(folder, top) ?? "(no title)");
  const keys = specs[folder].words.map((key) => top.fields.get(key) ?? "");
  const id = recordNumber(path.slice(folder.length + 1));
  const decision =
    folder === ".decisions" && id !== undefined
      ? { id: String(id).padStart(4, "0"), status: readStatus(top.fields.get("status")) }
      : undefined;
  const body = decision === undefined ? "" : decidingText(text);
  return [{ path, title, words: wordsIn([title, ...keys, body].join("\n")), decision }];
};

/** Where a cited decision lands: itself when it is in force, or the live decisions that superseded it. */
export const Resolution = Schema.TaggedUnion({
  accepted: { id: Schema.String, amendedBy: Schema.Array(Schema.String) },
  superseded: { id: Schema.String, by: Schema.Array(Schema.String) },
  other: { id: Schema.String, status: Schema.String },
  absent: { id: Schema.String },
  broken: { id: Schema.String, reason: Schema.String },
});
export type Resolution = typeof Resolution.Type;

/**
 * Follows `superseded by` links from one decision to the accepted decisions they end on. A link to
 * a decision that is not there, to one that is neither accepted nor superseded, or in a loop, is
 * broken: the answer says so and never guesses.
 */
export const resolve = (id: string, statuses: ReadonlyMap<string, Status>): Resolution => {
  const start = statuses.get(id);

  if (start === undefined) {
    return Resolution.cases.absent.make({ id });
  }

  const landed = new Set<string>();
  // `trail` is the chain walked to `from`, so two links that meet again are not a loop.
  const follow = (from: string, by: ReadonlyArray<string>, trail: ReadonlySet<string>): string | undefined => {
    if (by.length === 0) {
      return `${from} names no decision that superseded it`;
    }

    for (const next of by) {
      if (trail.has(next)) {
        return `${from} and ${next} supersede each other in a loop`;
      }

      const status = statuses.get(next);
      const broken =
        status === undefined
          ? `${from} is superseded by ${next}, which is not on main`
          : Status.match(status, {
              accepted: () => {
                landed.add(next);
                return undefined;
              },
              superseded: (s) => follow(next, s.by, new Set([...trail, next])),
              other: (s) => `${from} is superseded by ${next}, whose status is ${s.status}`,
            });

      if (broken !== undefined) {
        return broken;
      }
    }

    return undefined;
  };

  return Status.match(start, {
    accepted: (s) => Resolution.cases.accepted.make({ id, amendedBy: s.amendedBy }),
    other: (s) => Resolution.cases.other.make({ id, status: s.status }),
    superseded: (s) => {
      const reason = follow(id, s.by, new Set([id]));
      return reason === undefined
        ? Resolution.cases.superseded.make({ id, by: [...landed].sort() })
        : Resolution.cases.broken.make({ id, reason });
    },
  });
};

/** One line of a shortlist: where, its title, its score, the shared words, and what to read with it. */
export const Hit = Schema.Struct({
  path: Schema.String,
  title: Schema.String,
  score: Schema.Number,
  words: Schema.Array(Schema.String),
  notes: Schema.Array(Schema.String),
});
export type Hit = typeof Hit.Type;

/**
 * What `find` answers. `noOverlap` and `indeterminate` stay apart, as in phoenix: no record shares
 * a rare word, or the corpus or the query is too thin for a ranking to mean anything.
 */
export const Found = Schema.TaggedUnion({
  shortlist: { hits: Schema.Array(Hit), ranked: Schema.Number },
  noOverlap: { ranked: Schema.Number },
  indeterminate: { reason: Schema.String },
});
export type Found = typeof Found.Type;

const byScore = (a: Hit, b: Hit) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/**
 * Ranks the entries a query is about: each word they share is worth ln(N / df) over the N live
 * entries, and a word every live entry holds is worth nothing. A superseded decision's score goes
 * to the live decisions it lands on, unless `all` asks for each record as itself.
 */
export const find = (
  query: string,
  entries: ReadonlyArray<Entry>,
  options: { readonly limit: number; readonly all: boolean },
): Found => {
  const live = entries.filter((e) => e.decision === undefined || Status.isAnyOf(["accepted"])(e.decision.status));

  if (live.length < FLOOR) {
    return Found.cases.indeterminate.make({
      reason: `only ${live.length} live records, below ${FLOOR}: every word looks common`,
    });
  }

  const df = new Map<string, number>();

  for (const entry of live) {
    for (const word of entry.words) {
      df.set(word, (df.get(word) ?? 0) + 1);
    }
  }

  const weights = new Map(
    [...wordsIn(query)]
      .filter((word) => (df.get(word) ?? 0) < live.length)
      .map((word) => [word, Math.log(live.length / Math.max(df.get(word) ?? 0, 1))] as const),
  );

  if (weights.size === 0) {
    return Found.cases.indeterminate.make({ reason: "the words hold nothing rarer than a stopword" });
  }

  const statuses = new Map(
    entries.flatMap((e) => (e.decision === undefined ? [] : [[e.decision.id, e.decision.status] as const])),
  );
  const decisions = new Map(entries.flatMap((e) => (e.decision === undefined ? [] : [[e.decision.id, e] as const])));
  const byPath = new Map([...decisions.values()].map((e) => [e.path, e.decision] as const));
  // A proposed or unknown decision is in force nowhere, so only `all` ranks it.
  const ranked = options.all
    ? entries
    : entries.filter((e) => e.decision === undefined || !Status.isAnyOf(["other"])(e.decision.status));
  const hits = new Map<string, Hit>();
  const add = (entry: Entry, score: number, words: ReadonlyArray<string>, note?: string) => {
    const key = `${entry.path}\0${entry.title}`;
    const was = hits.get(key);
    const notes = [...(was?.notes ?? []), ...(note === undefined ? [] : [note])];
    hits.set(key, {
      path: entry.path,
      title: entry.title,
      score: Math.max(score, was?.score ?? 0),
      // In the query's order, whichever record brought each word.
      words: [...weights.keys()].filter((word) => words.includes(word) || was?.words.includes(word) === true),
      notes,
    });
  };

  for (const entry of ranked) {
    const words = [...weights.keys()].filter((word) => entry.words.has(word));
    const score = Math.round(words.reduce((sum, word) => sum + (weights.get(word) ?? 0), 0) * 100) / 100;

    if (score === 0) {
      continue;
    }

    const decision = entry.decision;

    if (decision === undefined || options.all) {
      add(entry, score, words);
      continue;
    }

    Resolution.matchOrElse(
      resolve(decision.id, statuses),
      {
        broken: (r) => add(entry, score, words, `broken: ${r.reason}`),
        superseded: (r) => {
          for (const id of r.by) {
            const live = decisions.get(id);

            if (live !== undefined) {
              add(live, score, words, `supersedes: ${decision.id}`);
            }
          }
        },
      },
      () => add(entry, score, words),
    );
  }

  const shown = [...hits.values()].map((hit) => {
    const decision = byPath.get(hit.path);
    const status =
      decision === undefined
        ? []
        : Status.match(decision.status, {
            accepted: (s) => (s.amendedBy.length === 0 ? [] : [`amended by: ${s.amendedBy.join(", ")}`]),
            superseded: (s) => [`superseded by: ${s.by.join(", ")}`],
            other: (s) => [`status: ${s.status}`],
          });
    return { ...hit, notes: [...status, ...hit.notes] };
  });

  if (shown.length === 0) {
    return Found.cases.noOverlap.make({ ranked: ranked.length });
  }

  return Found.cases.shortlist.make({
    hits: shown.sort(byScore).slice(0, Math.max(options.limit, 0)),
    ranked: ranked.length,
  });
};

/** The lines `find` prints for its answer. */
export const foundLines = (found: Found): ReadonlyArray<string> =>
  Found.match(found, {
    indeterminate: (f) => [`indeterminate: ${f.reason}`],
    noOverlap: (f) => [`no overlap: none of ${f.ranked} records shares a rare word; that is not a clearance`],
    shortlist: (f) => [
      `shortlist: ${f.hits.length} of ${f.ranked} records, by rare shared words; not a clearance`,
      ...f.hits.map((hit) =>
        [hit.score.toFixed(2).padStart(6), hit.path, hit.title, ...hit.notes, `words: ${hit.words.join(", ")}`].join(
          "  ",
        ),
      ),
    ],
  });

/** The line `resolve` prints for one decision. */
export const resolutionLine = (resolution: Resolution, paths: ReadonlyMap<string, string>): string =>
  Resolution.match(resolution, {
    accepted: (r) =>
      [
        r.id,
        "accepted",
        paths.get(r.id) ?? "",
        ...(r.amendedBy.length === 0 ? [] : [`amended by: ${r.amendedBy.join(", ")}`]),
      ].join("  "),
    superseded: (r) => [r.id, "superseded", `live: ${r.by.map((id) => paths.get(id) ?? id).join(", ")}`].join("  "),
    other: (r) => [r.id, `status: ${r.status}`, paths.get(r.id) ?? ""].join("  "),
    absent: (r) => `${r.id}  absent from main`,
    broken: (r) => `${r.id}  broken: ${r.reason}`,
  });

// ---------------------------------------------------------------- the world

/** origin/main could not be fetched or read, so the list and the next number are unknown. */
class Unknown extends Schema.TaggedError<Unknown, { readonly brand: unique symbol }>()("Unknown", {
  reason: Schema.String,
}) {}

/** `next` was asked of a folder whose records have no numbers. */
class NoNumbers extends Schema.TaggedError<NoNumbers, { readonly brand: unique symbol }>()("NoNumbers", {
  folder: Schema.String,
}) {}

const collected = (chunks: ReadonlyArray<Uint8Array>) => {
  const bytes = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0));
  let at = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }

  return bytes;
};

const git = Effect.fnUntraced(
  function* (repo: string, args: ReadonlyArray<string>, stdin?: string) {
    const handle = yield* ChildProcess.make("git", ["-C", repo, ...args], {
      stdin: stdin === undefined ? "ignore" : Stream.make(new TextEncoder().encode(stdin)),
    });
    const [out, err, code] = yield* Effect.all(
      [Stream.runCollect(handle.stdout), Stream.mkString(Stream.decodeText(handle.stderr)), handle.exitCode],
      { concurrency: 3 },
    );
    return { out: collected(out), err: err.trim(), code: Number(code) };
  },
  Effect.scoped,
  (effect) => Effect.mapError(effect, (e) => new Unknown({ reason: `git could not run: ${e.message}` })),
);

/** Splits `git cat-file --batch` output into each object's text, in the order asked. */
export const batchTexts = (bytes: Uint8Array): ReadonlyArray<string | undefined> => {
  const decoder = new TextDecoder();
  const texts: Array<string | undefined> = [];
  let at = 0;

  while (at < bytes.length) {
    const newline = bytes.indexOf(10, at);
    const header = decoder.decode(bytes.subarray(at, newline));
    const size = /^\S+ blob (\d+)$/.exec(header)?.[1];

    if (size === undefined) {
      texts.push(undefined);
      at = newline + 1;
      continue;
    }

    texts.push(decoder.decode(bytes.subarray(newline + 1, newline + 1 + Number(size))));
    at = newline + 1 + Number(size) + 1;
  }

  return texts;
};

/**
 * The files under `roots` on origin/main that `keep` takes, after a fetch: each path with its text,
 * in the order `keep` gives. A root that main does not hold, as `.runbooks/` before its first
 * runbook, reads as no files.
 */
const filesAt = Effect.fn("records.filesAt")(function* (
  repo: string,
  roots: ReadonlyArray<string>,
  keep: (paths: ReadonlyArray<string>) => ReadonlyArray<string>,
) {
  const fetched = yield* git(repo, ["fetch", "-q", "origin", "main"]);

  if (fetched.code !== 0) {
    return yield* new Unknown({ reason: `cannot fetch origin main: ${fetched.err}` });
  }

  const listed = yield* git(repo, ["ls-tree", "-r", "-z", "--name-only", BASE, "--", ...roots]);

  if (listed.code !== 0) {
    return yield* new Unknown({ reason: `cannot read ${roots.join(", ")} at ${BASE}: ${listed.err}` });
  }

  const paths = keep(new TextDecoder().decode(listed.out).split("\0"));
  const read = yield* git(repo, ["cat-file", "--batch"], paths.map((path) => `${BASE}:${path}\n`).join(""));
  const texts = batchTexts(read.out);

  if (read.code !== 0 || texts.length !== paths.length || texts.includes(undefined)) {
    return yield* new Unknown({ reason: `cannot read the records of ${roots.join(", ")} at ${BASE}: ${read.err}` });
  }

  return paths.map((path, i) => ({ path, text: texts[i] ?? "" }));
});

/** The folder's records on origin/main, in the order a reader expects. */
const recordsAt = (repo: string, folder: Folder) => filesAt(repo, [`${folder}/`], (paths) => inOrder(folder, paths));

/** Every entry `find` ranks, from origin/main: the searched folders' records and the glossary's rows. */
const entriesAt = (repo: string) =>
  filesAt(repo, [...searched.map((folder) => `${folder}/`), GLOSSARY], (paths) =>
    paths.filter((path) => path === GLOSSARY || searched.some((folder) => isRecord(folder, path))),
  ).pipe(Effect.map((files) => files.flatMap((file) => readEntries(file.path, file.text))));

const FolderArgument = Argument.ChoiceWithValue("folder", [
  [".decisions", ".decisions"],
  [".decisions/", ".decisions"],
  ["experiments", "experiments"],
  ["experiments/", "experiments"],
  [".patterns", ".patterns"],
  [".patterns/", ".patterns"],
  ["docs/direction", "docs/direction"],
  ["docs/direction/", "docs/direction"],
  [".runbooks", ".runbooks"],
  [".runbooks/", ".runbooks"],
] as const);

const list = Command.make(
  "list",
  { folder: FolderArgument },
  Effect.fn("records.list")(function* ({ folder }) {
    const records = yield* recordsAt(process.cwd(), folder);
    yield* Console.log(records.map((r) => recordLine(folder, r.path, r.text)).join("\n"));
    const next = nextNumber(
      folder,
      records.map((r) => r.path),
    );

    if (next !== undefined) {
      yield* Console.log(`next ${next}`);
    }
  }),
);

const next = Command.make(
  "next",
  { folder: FolderArgument },
  Effect.fn("records.next")(function* ({ folder }) {
    const records = yield* recordsAt(process.cwd(), folder);
    const number = nextNumber(
      folder,
      records.map((r) => r.path),
    );

    if (number === undefined) {
      return yield* new NoNumbers({ folder });
    }

    yield* Console.log(number);
  }),
);

const findCommand = Command.make(
  "find",
  {
    words: Argument.String("words").pipe(Argument.atLeast(1)),
    limit: Flag.Int("limit").pipe(Flag.withDefault(8)),
    all: Flag.Boolean("all").pipe(Flag.withDefault(false)),
  },
  Effect.fn("records.find")(function* ({ words, limit, all }) {
    const entries = yield* entriesAt(process.cwd());
    yield* Console.log(foundLines(find(words.join(" "), entries, { limit, all })).join("\n"));
  }),
);

const resolveCommand = Command.make(
  "resolve",
  { ids: Argument.String("id").pipe(Argument.atLeast(1)) },
  Effect.fn("records.resolve")(function* ({ ids }) {
    const decisions = yield* recordsAt(process.cwd(), ".decisions");
    const entries = decisions.flatMap((file) => readEntries(file.path, file.text));
    const statuses = new Map(
      entries.flatMap((e) => (e.decision === undefined ? [] : [[e.decision.id, e.decision.status] as const])),
    );
    const paths = new Map(entries.flatMap((e) => (e.decision === undefined ? [] : [[e.decision.id, e.path] as const])));
    // `34`, `0034` and `0034-slug` all name decision 0034.
    const decisionId = (arg: string) => /^\d+/.exec(arg)?.[0].padStart(4, "0") ?? arg;
    yield* Console.log(ids.map((arg) => resolutionLine(resolve(decisionId(arg), statuses), paths)).join("\n"));
  }),
);

const records = Command.make("records").pipe(Command.withSubcommands([list, next, findCommand, resolveCommand]));

if (import.meta.main) {
  NodeRuntime.runMain(
    Command.run({ version: "0.0.0" })(records).pipe(
      Effect.as(0),
      Effect.catchTag("Unknown", (e) =>
        Console.error(`records: unknown, never 0 records: ${e.reason}`).pipe(Effect.as(1)),
      ),
      Effect.catchTag("NoNumbers", (e) =>
        Console.error(`records: ${e.folder} has no numbers; use list`).pipe(Effect.as(2)),
      ),
      // `--help` alone is a clean exit; a command line effect/cli could not read is printed by it.
      Effect.catchTag("ShowHelp", (help) => Effect.succeed(help.errors.length === 0 ? 0 : 2)),
      Effect.catch(() => Effect.succeed(2)),
      Effect.provide(NodeServices.layer),
    ),
    {
      disableErrorReporting: true,
      teardown: (exit, onExit) => onExit(Exit.isSuccess(exit) && Predicate.isNumber(exit.value) ? exit.value : 2),
    },
  );
}
