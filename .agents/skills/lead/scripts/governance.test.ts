// S2 of docs/plan/quests/port-scripts-0113-PLAN.md: governance.sh, ported to governance.ts. The old
// script had no laws, so these are its first. Written before the port, red until it lands.
//
// The shape these laws hold the port to:
// - `governance.ts` exports `governance`, the `effect/cli` command, with one optional argument, the
//   base (default `origin/main`). It reads the diff `<base>...HEAD` with `--unified=0` through the
//   `Git` service (git/Git.ts), finds the top with `Git.top`, and reads `<top>/.decisions/` through
//   Effect's `FileSystem`. It prints its lines through `Console`.
// - Each law runs the command in process on `GitTest.layer` and `GitTest.workTree` (git/GitTest.ts):
//   no git, no process, no disk. git.integration.test.ts holds those layers to real git.
//
// The oracle below is governance.sh's rules, written from the script as it stood on main: words are
// `[a-z][a-z0-9]+` of the lowercased text, four letters or more, not on its stop list; a diff's words
// are its changed lines and its file names; a decision's are its slug, its title and its tags.
//
// Each law was planted once (the port changed to break it, the law seen red) and restored by copy;
// the plant is named beside it.
import { NodeServices } from "@effect/platform-node";
import { Effect, Exit, Layer } from "effect";
import { Command } from "effect/cli";
import { TestConsole } from "effect/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as GitTest from "./git/GitTest.ts";
import { governance } from "./governance.ts";

const runs = { seed: 119120, numRuns: 100 };
const TOP = "/repo";
const NO_MATCH = "governance: no decision file matched this diff. Search .decisions/ by hand too.";

/** governance.sh's stop list, as it stood on main. */
const STOP = new Set([
  "the",
  "and",
  "for",
  "not",
  "never",
  "every",
  "each",
  "one",
  "two",
  "its",
  "with",
  "from",
  "into",
  "when",
  "that",
  "this",
  "than",
  "only",
  "stays",
  "goes",
  "lands",
  "made",
  "make",
  "turn",
  "file",
  "files",
  "live",
  "lives",
  "decision",
  "decisions",
  "owner",
  "repo",
]);

/** governance.sh's `words`. */
const counted = (text: string): ReadonlySet<string> =>
  new Set(
    [...text.toLowerCase().matchAll(/[a-z][a-z0-9]+/g)]
      .map((m) => m[0])
      .filter((word) => word.length >= 4 && !STOP.has(word)),
  );

// The words a generated text is made of: real words, stop words of four letters or more, words too
// short to count, words with digits, and capitals, which count lowercased.
const REAL = ["ledger", "review", "merge", "lint", "port", "shell", "python", "effect", "tracker", "brain", "lease"];
const STOPPED = ["never", "every", "with", "from", "when", "that", "only", "file", "decision", "owner", "repo"];
const SHORT = ["box", "run", "tea", "git", "a1"];

const word = fc.oneof(
  fc.constantFrom(...REAL),
  fc.constantFrom(...STOPPED),
  fc.constantFrom(...SHORT),
  fc.constantFrom("step2", "v4beta", "Ledger", "REVIEW", "Merge"),
);

const words = (max: number) => fc.array(word, { minLength: 1, maxLength: max });
const SEPARATORS = [" ", "-", ", ", ".", "/"];
/** A line of words: it starts with a letter, so it never reads as a diff header. */
const line = fc.tuple(words(5), fc.constantFrom(...SEPARATORS)).map(([ws, sep]) => ws.join(sep));

/** Every token of a text, before the length and stop-list filter. */
const tokens = (text: string): ReadonlySet<string> => new Set(text.toLowerCase().match(/[a-z][a-z0-9]+/g) ?? []);
const lines = fc.array(line, { minLength: 1, maxLength: 4 });

/** What a generated file does between the merge base and HEAD. */
type Fate = "same" | "edited" | "added" | "deleted";
const fate = fc.constantFrom<Fate>("same", "edited", "added", "deleted");

type Decision = {
  readonly name: string;
  readonly slug: ReadonlyArray<string>;
  readonly title: ReadonlyArray<string>;
  readonly tags: ReadonlyArray<string>;
  readonly body: ReadonlyArray<string>;
  readonly more: ReadonlyArray<string>;
  readonly fate: Fate;
};

const decisionText = (d: Decision): string =>
  [
    "---",
    `title: ${d.title.join(" ")}`,
    `tags: [${d.tags.join(", ")}]`,
    "---",
    "",
    `# ${d.title.join(" ")}`,
    "",
    ...d.body,
    "",
  ].join("\n");

const decisions = fc.uniqueArray(fc.integer({ min: 1, max: 9999 }), { maxLength: 6 }).chain((numbers) =>
  fc.tuple(
    ...numbers.map((n) =>
      fc
        .record({
          slug: words(3),
          title: words(4),
          tags: fc.array(word, { maxLength: 3 }),
          body: lines,
          more: lines,
          fate,
        })
        .map((d): Decision => ({ ...d, name: `${String(n).padStart(4, "0")}-${d.slug.join("-").toLowerCase()}.md` })),
    ),
  ),
);

/** A file outside `.decisions/`: a name of words, and what HEAD did to it. */
type Other = {
  readonly path: string;
  readonly before: ReadonlyArray<string>;
  readonly after: ReadonlyArray<string>;
  readonly fate: Fate;
};

const others = fc.uniqueArray(
  fc.record({ name: words(2), before: lines, after: lines, fate, swap: fc.boolean() }).map((o): Other => ({
    path: `src/${o.name.join("-").toLowerCase()}.ts`,
    // Every line of a swapped file is new, so its old and new lines share none.
    before: o.before.map((l) => `old ${l}`),
    after: o.after.map((l) => (o.swap ? `new ${l}` : `old ${l}`)),
    fate: o.fate,
  })),
  { selector: (o) => o.path, maxLength: 4 },
);

const text = (ls: ReadonlyArray<string>) => ls.map((l) => `${l}\n`).join("");

/** One generated history: the merge base, HEAD a commit after it, and main a commit after it too. */
type World = {
  readonly model: GitTest.Model;
  /** The changed lines and the file names of base...HEAD, as git writes them. */
  readonly changed: ReadonlyArray<string>;
  readonly edited: ReadonlySet<string>;
  readonly records: ReadonlyArray<Decision>;
};

const world = (ds: ReadonlyArray<Decision>, os: ReadonlyArray<Other>, mainOnly: ReadonlyArray<string>): World => {
  const base: Record<string, string> = { ".decisions/README.md": "# Decisions\n" };
  const head: Record<string, string> = { ".decisions/README.md": "# Decisions\n" };
  const changed: Array<string> = [];
  const edited = new Set<string>();

  for (const d of ds) {
    const path = `.decisions/${d.name}`;
    const was = decisionText(d);
    const now = `${was}${text(d.more)}`;

    if (d.fate !== "added") {
      base[path] = was;
    }

    if (d.fate !== "deleted") {
      head[path] = d.fate === "edited" ? now : was;
    }

    if (d.fate === "edited") {
      edited.add(d.name);
      changed.push(path, path, ...d.more);
    } else if (d.fate === "added") {
      edited.add(d.name);
      changed.push(path, ...was.split("\n").slice(0, -1));
    } else if (d.fate === "deleted") {
      changed.push(path, ...was.split("\n").slice(0, -1));
    }
  }

  for (const o of os) {
    if (o.fate !== "added") {
      base[o.path] = text(o.before);
    }

    if (o.fate === "same" || o.fate === "added") {
      head[o.path] = text(o.before);
    } else if (o.fate === "edited") {
      // An edit appends lines, or swaps every one of them.
      head[o.path] = o.after[0]?.startsWith("new ") ? text(o.after) : text([...o.before, ...o.after]);
    }

    if (o.fate === "added" || o.fate === "deleted") {
      changed.push(o.path, ...o.before);
    } else if (o.fate === "edited") {
      changed.push(o.path, o.path, ...(o.after[0]?.startsWith("new ") ? [...o.before, ...o.after] : o.after));
    }
  }

  // A file only main changed is not in base...HEAD: the three dots diff from the merge base.
  const main = { ...base, "notes/main-only.md": text(mainOnly) };
  return {
    model: {
      top: TOP,
      commits: { b: { parents: [], tree: base }, h: { parents: ["b"], tree: head }, m: { parents: ["b"], tree: main } },
      refs: { HEAD: "h", main: "m", "origin/main": "m" },
    },
    changed,
    edited,
    records: ds.filter((d) => d.fate !== "deleted"),
  };
};

/** governance.sh's answer for a world: the lines it prints, and how each record got there. */
const oracle = (w: World) => {
  const seen = counted(w.changed.join("\n"));
  const hits = w.records.flatMap((d) => {
    const keys = new Set([
      ...counted(d.name.slice(5, -3).replaceAll("-", " ")),
      ...counted(d.title.join(" ")),
      ...counted(d.tags.join(", ")),
    ]);
    const match = [...keys].filter((k) => seen.has(k)).toSorted();
    const edited = w.edited.has(d.name);
    return edited || match.length > 0 ? [{ edited, match, name: d.name }] : [];
  });
  const sorted = hits.toSorted(
    (a, b) =>
      Number(b.edited) - Number(a.edited) ||
      b.match.length - a.match.length ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  return {
    lines:
      sorted.length === 0
        ? [NO_MATCH]
        : sorted.map((h) => `.decisions/${h.name}: ${h.edited ? "edited" : h.match.join(", ")}`),
    hits: sorted,
  };
};

/** One run of the command, in process, on the model: its exit and the lines it printed. */
const runCommand = (model: GitTest.Model, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const exit = yield* Command.runWith(governance, { version: "0.0.0" })(args).pipe(Effect.exit);
    const out = (yield* TestConsole.logLines).map(String).join("\n");
    return { exit, lines: out === "" ? [] : out.split("\n") };
  }).pipe(
    Effect.provide(Layer.mergeAll(GitTest.layer(model), GitTest.workTree(model), TestConsole.layer)),
    Effect.provide(NodeServices.layer),
    Effect.runSync,
  );

describe("governance.ts", () => {
  // Plant, run once: "review" added to the port's stop list. Red: a decision whose slug, title or
  // tags share only "review" with the diff was not listed.
  it("property: a diff's words list every decision whose slug, title or tags share a word of four letters or more, edited ones first", () => {
    const reached = new Set<string>();
    fc.assert(
      fc.property(
        decisions,
        others,
        lines,
        fc.constantFrom<ReadonlyArray<string>>([], ["main"], ["origin/main"]),
        (ds, os, mainOnly, args) => {
          const w = world(ds, os, mainOnly);
          const want = oracle(w);
          const got = runCommand(w.model, args);
          expect(Exit.isSuccess(got.exit)).toBe(true);
          expect(got.lines).toEqual(want.lines);

          const seen = counted(w.changed.join("\n"));
          const said = tokens(w.changed.join("\n"));
          const keys = tokens(w.records.flatMap((d) => [...d.slug, ...d.title, ...d.tags]).join(" "));
          const shared = [...keys].filter((k) => said.has(k));
          reached.add(want.hits.length === 0 ? "none listed" : "some listed");
          reached.add(want.hits.some((h) => h.edited) ? "an edited one" : "none edited");
          reached.add(want.hits.some((h) => !h.edited) ? "a word match" : "no word match");
          reached.add(
            want.hits.some((h, i) => i > 0 && !h.edited && want.hits[i - 1]?.edited) ? "edited before a match" : "",
          );
          reached.add(new Set(want.hits.map((h) => h.match.length)).size > 1 ? "ranked by count" : "");
          // A stop word or a short word in both the diff and a decision's keys never counts.
          reached.add(shared.some((k) => STOP.has(k) || k.length < 4) ? "a stop or short word shared" : "");
          // A key word that only main's own commit says, which the three dots leave out.
          reached.add(
            [...tokens(mainOnly.join("\n"))].some((k) => keys.has(k) && !seen.has(k) && counted(k).size > 0)
              ? "a word only main changed"
              : "",
          );
        },
      ),
      runs,
    );
    expect([...reached].filter((r) => r !== "").toSorted()).toEqual(
      [
        "a stop or short word shared",
        "a word match",
        "a word only main changed",
        "an edited one",
        "edited before a match",
        "no word match",
        "none edited",
        "none listed",
        "ranked by count",
        "some listed",
      ].toSorted(),
    );
  });

  // Plant, run once: the command failed when nothing matched. Red: the exit was a failure.
  it("scenario: an empty diff exits 0 and prints the no-match line, since the check only advises", () => {
    const tree = {
      ".decisions/0113-no-shell-or-python-scripts.md": "---\ntitle: No shell or Python scripts\n---\n",
      "README.md": "# repo\n",
    };
    const model: GitTest.Model = {
      top: TOP,
      commits: { b: { parents: [], tree } },
      refs: { HEAD: "b", "origin/main": "b" },
    };
    const got = runCommand(model, []);
    expect(Exit.isSuccess(got.exit)).toBe(true);
    expect(got.lines).toEqual([NO_MATCH]);
  });
});
