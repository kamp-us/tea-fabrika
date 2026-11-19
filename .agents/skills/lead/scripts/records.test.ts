import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Array as Arr, pipe, String as Str, Option } from "effect";
import fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";
import {
  batchTexts,
  find,
  type Folder,
  Found,
  foundLines,
  inOrder,
  isRecord,
  nextNumber,
  readEntries,
  readStatus,
  readTop,
  recordLine,
  resolutionLine,
  resolve,
  Resolution,
  Status,
} from "./records.ts";

const script = join(import.meta.dirname, "records.ts");

const folders: ReadonlyArray<Folder> = [".decisions", "experiments", ".patterns", "docs/direction", ".runbooks"];

const folder = fc.constantFrom(...folders);

const slug = fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/);

// One line of frontmatter text: anything with no line break, quotes, colons and backticks included.
const value = fc.string({ minLength: 1 }).filter((s) => !/[\r\n]/.test(s) && Str.trim(s) === s);

describe("nextNumber", () => {
  it("property: the next number is the highest record's number plus one, padded, and never a number already there", () =>
    fc.assert(
      fc.property(fc.constantFrom<Folder>(".decisions", "experiments"), fc.array(fc.nat({ max: 9999 })), (at, ns) => {
        const width = at === ".decisions" ? 4 : 2;
        const paths = Arr.map(ns, (n) => `${at}/${pipe(String(n), Str.padStart(width, "0"))}-x.md`);
        const next = nextNumber(at, paths) ?? "";
        expect(next).toBe(pipe(String(Math.max(0, ...ns) + 1), Str.padStart(width, "0")));
        expect(ns).not.toContain(Number(next));
      }),
    ));

  it("property: a gap below the highest number is never handed out again", () =>
    fc.assert(
      fc.property(fc.integer({ min: 3, max: 900 }), (top) => {
        const paths = [`experiments/01-a.md`, `experiments/${top}-b.md`];
        expect(Number(nextNumber("experiments", paths))).toBe(top + 1);
      }),
    ));

  it("property: files that are not records take no number", () =>
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 500 }), { minLength: 1 }), (ns) => {
        const paths = Arr.map(ns, (n) => `experiments/${n}-x.md`);

        const noise = [
          "experiments/README.md",
          "experiments/open-questions.md",
          "experiments/999-x.json",
          "elsewhere/998-x.md",
        ];

        expect(nextNumber("experiments", [...paths, ...noise])).toBe(nextNumber("experiments", paths));
      }),
    ));

  it("scenario: an empty folder that was read is number 1, and an unnumbered folder has no next number", () => {
    expect(nextNumber(".decisions", [])).toBe("0001");
    expect(nextNumber(".patterns", [".patterns/a.md"])).toBeUndefined();
    expect(nextNumber("docs/direction", [])).toBeUndefined();
  });
});

describe("inOrder", () => {
  it("property: numbered records come by number, whatever order git lists them in, and every record stays once", () =>
    fc.assert(
      fc.property(fc.uniqueArray(fc.nat({ max: 999 }), { minLength: 1 }), (ns) => {
        const paths = Arr.map(ns, (n) => `experiments/${n}-x.md`);
        const ordered = inOrder("experiments", [...paths].sort());
        expect(Arr.map(ordered, (p) => Number(/\/(\d+)-/.exec(p)?.[1]))).toEqual([...ns].sort((a, b) => a - b));
      }),
    ));

  it("scenario: a record with no number comes after the numbered ones, and a folder with no numbers goes by name", () => {
    expect(
      inOrder("experiments", ["experiments/open-questions.md", "experiments/203-x.md", "experiments/65-y.md"]),
    ).toEqual(["experiments/65-y.md", "experiments/203-x.md", "experiments/open-questions.md"]);
    expect(inOrder(".patterns", [".patterns/b.md", ".patterns/README.md", ".patterns/a.md"])).toEqual([
      ".patterns/a.md",
      ".patterns/b.md",
    ]);
  });
});

describe("isRecord", () => {
  it("property: a folder's README is never a record, and a Markdown file beside it is, decisions only with a number", () =>
    fc.assert(
      fc.property(folder, slug, (at, name) => {
        expect(isRecord(at, `${at}/README.md`)).toBe(false);
        expect(isRecord(at, `${at}/${name}.md`)).toBe(at !== ".decisions" || /^\d+[a-z]?-/.test(name));
        expect(isRecord(at, `${at}/0001-${name}.md`)).toBe(true);
        expect(isRecord(at, `${at}/${name}.json`)).toBe(false);
      }),
    ));

  it("scenario: only docs/direction counts a subfolder's README, as follows/README.md", () => {
    expect(isRecord("docs/direction", "docs/direction/follows/README.md")).toBe(true);
    expect(isRecord("docs/direction", "docs/direction/follows/otp.md")).toBe(false);
    expect(isRecord("experiments", "experiments/results/README.md")).toBe(false);
  });
});

describe("readTop", () => {
  it("property: a value written as a JSON string reads back the same, whatever it holds", () =>
    fc.assert(
      fc.property(value, value, (summary, when) => {
        const text = `---\nsummary: ${JSON.stringify(summary)}\nwhen: ${JSON.stringify(when)}\n---\n\n# Title\n`;
        const top = readTop(text);
        expect(top.fields.get("summary")).toBe(summary);
        expect(top.fields.get("when")).toBe(when);
        expect(top.heading).toBe("Title");
      }),
    ));

  it("format: a decision's plain frontmatter reads as written, a bracketed status included", () => {
    const text = Arr.join(
      [
        "---",
        "id: 0008",
        "title: Decision discovery is the AGENTS.md contract alone",
        "status: amended-in-part by [0522](0522-no-folder-keeps-an-index-table.md)",
        "tags: [decisions, discovery]",
        "---",
        "",
        "# 0008: Decision discovery is the AGENTS.md contract alone",
      ],
      "\n",
    );

    const top = readTop(text);
    expect(top.fields.get("title")).toBe("Decision discovery is the AGENTS.md contract alone");
    expect(top.fields.get("status")).toBe("amended-in-part by [0522](0522-no-folder-keeps-an-index-table.md)");
  });

  it("scenario: a file with no frontmatter has no fields and still has its heading; a heading inside the block is not it", () => {
    expect(readTop("# 79. Inputs over time\n\nScripted runs only.\n")).toEqual({
      fields: new Map(),
      heading: "79. Inputs over time",
    });
    expect(readTop("no heading at all").heading).toBeUndefined();
  });
});

describe("recordLine", () => {
  it("property: a line is one line, starts with the record's id and holds each value it prints", () =>
    fc.assert(
      fc.property(fc.nat({ max: 999 }), value, value, (n, title, summary) => {
        const path = `experiments/${n}-x.md`;
        const text = `---\ndate: "2026-11-13"\nsummary: ${JSON.stringify(summary)}\n---\n\n# ${n}. ${title}\n`;
        const line = recordLine("experiments", path, text);
        expect(line).not.toContain("\n");
        expect(pipe(line, Str.startsWith(`${n}  2026-11-13  `))).toBe(true);
        expect(line).toContain(`summary: ${pipe(summary, Str.replace(/\s+/g, " "), Str.trim)}`);
      }),
    ));

  it("format: one line per folder, in the shape each folder prints", () => {
    expect(
      recordLine(
        ".decisions",
        ".decisions/0522-no-index.md",
        "---\nid: 0522\ntitle: No index\nstatus: accepted\n---\n",
      ),
    ).toBe("0522  accepted  No index");
    expect(
      recordLine(
        "experiments",
        "experiments/75d-pipe-ack.md",
        '---\ndate: "2026-10-17"\nsummary: "Yes."\n---\n\n# 75d. An ack on the pipe\n',
      ),
    ).toBe("75d  2026-10-17  An ack on the pipe  summary: Yes.");
    expect(
      recordLine(
        ".patterns",
        ".patterns/settings.md",
        '---\nwhere: "next/ settings"\nwhen: "Adding a setting"\n---\n\n# One declaration\n',
      ),
    ).toBe("settings  next/ settings  One declaration  when: Adding a setting");
    expect(
      recordLine(
        "docs/direction",
        "docs/direction/follows/README.md",
        '---\nsummary: "One table per model."\n---\n\n# Follows\n',
      ),
    ).toBe("follows/README  Follows  summary: One table per model.");
  });

  it("scenario: a record with no frontmatter says what it lacks instead of printing nothing", () => {
    expect(recordLine("experiments", "experiments/79-inputs.md", "# 79. Inputs over time\n")).toBe(
      "79  (no date)  Inputs over time  summary: (no summary)",
    );
    expect(recordLine(".patterns", ".patterns/x.md", "")).toBe("x  (no where)  (no title)  when: (no when)");
  });
});

describe("batchTexts", () => {
  it("property: each object's text comes back whole and in order, multibyte text and newlines included", () =>
    fc.assert(
      fc.property(fc.array(fc.string()), (texts) => {
        const encoder = new TextEncoder();

        const parts = Arr.flatMap(texts, (text) => {
          const bytes = encoder.encode(text);

          return [encoder.encode(`abc123 blob ${bytes.length}\n`), bytes, encoder.encode("\n")];
        });

        const all = new Uint8Array(Arr.reduce(parts, 0, (n, p) => n + p.length));
        Arr.reduce(parts, 0, (at, p) => {
          all.set(p, at);

          return at + p.length;
        });
        expect(batchTexts(all)).toEqual(texts);
      }),
    ));

  it("format: a missing object is undefined in its place", () => {
    const bytes = new TextEncoder().encode("origin/main:x.md missing\nabc blob 2\nhi\n");
    expect(batchTexts(bytes)).toEqual([undefined, "hi"]);
  });
});

describe("records.ts on a real clone", () => {
  const root = mkdtempSync(join(tmpdir(), "records-"));

  const git = (cwd: string, ...args: Array<string>) => {
    const ran = spawnSync("git", args, { cwd, encoding: "utf8" });
    expect(ran.status, ran.stderr).toBe(0);
  };

  const put = (repo: string, path: string, text: string) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  };

  const records = (cwd: string, ...args: Array<string>) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const origin = join(root, "origin.git");
  const clone = join(root, "clone");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  git(root, "clone", "-q", origin, clone);
  git(clone, "config", "user.email", "test@example.com");
  git(clone, "config", "user.name", "test");
  git(clone, "config", "commit.gpgsign", "false");
  put(clone, "experiments/README.md", "# Experiment log\n");
  put(clone, "experiments/01-first.md", '---\ndate: "2026-10-04"\nsummary: "No."\n---\n\n# 1. Is it noise?\n');
  put(clone, "experiments/07-seventh.md", "# 7. The test writer\n");
  git(clone, "add", ".");
  git(clone, "commit", "-q", "-m", "two experiments");
  git(clone, "push", "-q", "origin", "main");

  it("scenario: an unpushed file, committed or not, takes no number and no line; main's records do", () => {
    put(clone, "experiments/08-local-only.md", "# 8. Only here\n");
    git(clone, "add", ".");
    git(clone, "commit", "-q", "-m", "local only");
    put(clone, "experiments/09-untracked.md", "# 9. Untracked\n");
    const listed = records(clone, "list", "experiments");
    expect(listed.status, listed.stderr).toBe(0);
    expect(listed.stdout).toBe(
      "01  2026-10-04  Is it noise?  summary: No.\n07  (no date)  The test writer  summary: (no summary)\nnext 08\n",
    );
    const next = records(clone, "next", "experiments/");
    expect([next.status, next.stdout]).toEqual([0, "08\n"]);
  });

  it("scenario: a number pushed by someone else counts once fetched, which the command does itself", () => {
    const other = join(root, "other");
    git(root, "clone", "-q", origin, other);
    git(other, "config", "user.email", "test@example.com");
    git(other, "config", "user.name", "test");
    git(other, "config", "commit.gpgsign", "false");
    put(other, "experiments/12-pushed.md", "# 12. Pushed elsewhere\n");
    git(other, "add", ".");
    git(other, "commit", "-q", "-m", "pushed");
    git(other, "push", "-q", "origin", "main");
    expect(records(clone, "next", "experiments").stdout).toBe("13\n");
  });

  it("scenario: when origin/main cannot be read, it says unknown and exits 1, never 0 records or a number", () => {
    const lone = join(root, "lone");
    git(root, "init", "-q", "-b", "main", lone);
    const listed = records(lone, "list", ".decisions");
    expect(listed.status).toBe(1);
    expect(listed.stdout).toBe("");
    expect(listed.stderr).toContain("unknown, never 0 records");
  });

  it("scenario: a folder that is not one of the five, or next on a folder with no numbers, exits 2", () => {
    expect(records(clone, "list", "field").status).toBe(2);
    expect(records(clone, "next", ".patterns").status).toBe(2);
    expect(records(clone, "next", ".runbooks").status).toBe(2);
  });

  it("scenario: find and resolve read origin/main: a pushed decision is found and resolved, an unpushed one is not", () => {
    const third = join(root, "third");
    git(root, "clone", "-q", origin, third);
    git(third, "config", "user.email", "test@example.com");
    git(third, "config", "user.name", "test");
    git(third, "config", "commit.gpgsign", "false");

    for (let n = 2; n <= 10; n++) {
      const id = pipe(String(n), Str.padStart(4, "0"));
      put(third, `.decisions/${id}-x.md`, `---\nid: ${id}\ntitle: Rule ${n} about topic${n}\nstatus: accepted\n---\n`);
    }

    put(
      third,
      ".decisions/0001-x.md",
      '---\nid: 0001\ntitle: Pelicans nest\nstatus: superseded\nsuccessor: "0002"\n---\n',
    );
    git(third, "add", ".");
    git(third, "commit", "-q", "-m", "ten decisions");
    git(third, "push", "-q", "origin", "main");
    put(third, ".decisions/0011-x.md", "---\nid: 0011\ntitle: Flamingos nest\nstatus: accepted\n---\n");
    git(third, "add", ".");
    git(third, "commit", "-q", "-m", "local only");
    const found = records(third, "find", "pelicans", "flamingos");
    expect(found.status, found.stderr).toBe(0);
    expect(found.stdout).toMatch(/^shortlist: 1 of 13 records/);
    expect(found.stdout).toContain(".decisions/0002-x.md  Rule 2 about topic2  supersedes: 0001  words: pelicans\n");
    expect(found.stdout).not.toContain("0011");
    const resolved = records(third, "resolve", "1", "0002", "0011");
    expect([resolved.status, resolved.stdout]).toEqual([
      0,
      "0001  superseded  live: .decisions/0002-x.md\n0002  accepted  .decisions/0002-x.md\n0011  absent from main\n",
    ]);
  });
});

// A small corpus for find: twelve records across the folders, so rarity means something (the floor is 10).
const decision = (id: string, title: string, status: string, body: string) =>
  [
    `.decisions/${id}-x.md`,
    `---\nid: ${id}\ntitle: ${title}\nstatus: ${status}\n---\n\n# ${id}: ${title}\n\n${body}\n`,
  ] as const;

const note = (path: string, title: string, summary: string) =>
  [path, `---\nsummary: ${JSON.stringify(summary)}\n---\n\n# ${title}\n\nA long body about migration.\n`] as const;

const glossary = [
  ".glossary/TERMS.md",
  Arr.join(
    [
      "# Terms",
      "",
      "| Term | Definition | Not |",
      "|---|---|---|",
      "| upgrade (saved state) | One named step that moves saved state to the next shape. | Not a migration tool. |",
      "| ledger | The log every fact goes to. | |",
    ],
    "\n",
  ),
] as const;

const corpus = [
  decision(
    "0001",
    "Saved state carries its shape number",
    "accepted",
    "**What this decides:** each saved shape has a number.\n\n## Context\n\nA long story about zebras.\n\n## Decision\n\nThe shape number is stored.",
  ),
  decision("0002", "The ledger keeps every fact", "accepted", "## Decision\n\nNothing is dropped from the ledger."),
  decision("0003", "Old shapes are migrated", 'superseded\nsuccessor: "0004"', "## Decision\n\nA migration runs."),
  decision("0004", "Old shapes are upgraded", 'superseded\nsuccessor: "0011"', "## Decision\n\nAn upgrade runs."),
  decision("0005", "Tickets live in the tracker", "accepted", "## Decision\n\nOne tracker."),
  decision("0006", "The lead merges on green", "accepted", "## Decision\n\nGreen CI merges."),
  decision("0007", "A proposed shape rule", "proposed", "## Decision\n\nA saved shape migration rule."),
  decision(
    "0011",
    "Before release a shape change wipes data",
    "accepted",
    "## Decision\n\nNo migration; the data is wiped.",
  ),
  note("experiments/01-shape.md", "1. Is the shape stable?", "The saved shape held."),
  note("docs/direction/settings.md", "Settings", "One declaration per setting."),
  [".patterns/tags.md", '---\nwhere: "next/"\nwhen: "Matching a tag"\n---\n\n# A tag is matched\n'] as const,
  note(".runbooks/migrate-stored-data.md", "Migrate stored data", "Move stored data to a new saved shape."),
  glossary,
] as const;

const entries = Arr.flatMap(corpus, ([path, text]) => readEntries(path, text));

const shortlist = (found: Found) =>
  Found.match(found, {
    shortlist: (f) => f.hits,
    noOverlap: () => [],
    indeterminate: (f) => {
      throw new Error(`indeterminate: ${f.reason}`);
    },
  });

describe("readEntries", () => {
  it("format: one entry per record and one per glossary row, header rows left out, a decision with its id and status", () => {
    expect(Arr.map(entries, (e) => e.title)).toContain("upgrade (saved state)");
    expect(
      pipe(
        entries,
        Arr.filter((e) => e.path === ".glossary/TERMS.md"),
        Arr.map((e) => e.title),
      ),
    ).toEqual(["upgrade (saved state)", "ledger"]);
    expect(
      Option.map(
        Arr.findFirst(entries, (e) => e.path === ".decisions/0004-x.md"),
        (e) => e.decision,
      ),
    ).toEqual(
      Option.some({
        id: "0004",
        status: Status.cases.superseded.make({ by: ["0011"] }),
      }),
    );
    expect(readEntries("experiments/README.md", "# Log\n")).toEqual([]);
  });

  it("scenario: only what says what a record is counts: a decision's Context and a note's body are not searched", () => {
    const entry = (path: string) => Option.getOrThrow(Arr.findFirst(entries, (e) => e.path === path));
    const zebra = entry(".decisions/0001-x.md");
    expect(zebra.words.has("zebras")).toBe(false);
    expect(zebra.words.has("number")).toBe(true);
    expect(entry("docs/direction/settings.md").words.has("migration")).toBe(false);
  });
});

describe("find", () => {
  it("property: a record sharing a rarer word ranks above one sharing a commoner word", () =>
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 1, max: 6 }), (rare, more) => {
        // `alpha` sits in `rare` records, `beta` in more of them, and every record holds `filler`.
        const common = rare + more;

        const made = Array.from({ length: 12 + common }, (_, i) => ({
          path: `experiments/${pipe(String(i + 1), Str.padStart(2, "0"))}-x.md`,
          title: String(i),
          words: new Set([
            "filler",
            ...(i < rare ? ["alpha"] : []),
            ...(i >= rare && i < rare + common ? ["beta"] : []),
          ]),
          decision: undefined,
        }));

        const hits = shortlist(find("alpha beta filler", made, { limit: 100, all: false }));

        const score = (word: string) =>
          pipe(
            Arr.findFirst(hits, (h) => h.words.includes(word) && h.words.length === 1),
            Option.map((h) => h.score),
            Option.getOrElse(() => 0),
          );

        expect(score("alpha")).toBeGreaterThan(score("beta"));
        expect(Arr.every(hits, (h) => !h.words.includes("filler"))).toBe(true);
        expect(score("alpha")).toBeCloseTo(Math.log(made.length / rare), 2);
      }),
    ));

  it("scenario: each shared word is worth ln(N / df) over the 11 live records, summed, and ties go by path", () => {
    // Live df: saved 4, shape 5, migration 2 (0003 holds it too, but 0003 is superseded).
    const idf = (df: number) => Math.log(11 / df);
    const round = (n: number) => Math.round(n * 100) / 100;
    const hits = shortlist(find("saved shape migration", entries, { limit: 8, all: false }));
    expect(Arr.map(hits, (h) => [h.path, h.score, h.words])).toEqual([
      [".glossary/TERMS.md", round(idf(4) + idf(5) + idf(2)), ["saved", "shape", "migration"]],
      [".decisions/0011-x.md", round(idf(5) + idf(2)), ["shape", "migration"]],
      [".decisions/0001-x.md", round(idf(4) + idf(5)), ["saved", "shape"]],
      [".runbooks/migrate-stored-data.md", round(idf(4) + idf(5)), ["saved", "shape"]],
      ["experiments/01-shape.md", round(idf(4) + idf(5)), ["saved", "shape"]],
    ]);
  });

  it("scenario: a superseded decision's hit lands on the live one it names, and --all shows it as itself", () => {
    const live = shortlist(find("migrated", entries, { limit: 8, all: false }));
    expect(Arr.map(live, (h) => [h.path, h.notes])).toEqual([[".decisions/0011-x.md", ["supersedes: 0003"]]]);
    const all = shortlist(find("migrated", entries, { limit: 8, all: true }));
    expect(Arr.map(all, (h) => [h.path, h.notes])).toEqual([[".decisions/0003-x.md", ["superseded by: 0004"]]]);
    const accepted = shortlist(find("number", entries, { limit: 8, all: false }));
    expect(accepted[0]?.notes).toEqual([]);
  });

  it("scenario: a proposed decision is in force nowhere, so only --all finds it", () => {
    const paths = (all: boolean) =>
      Arr.map(shortlist(find("proposed rule", entries, { limit: 8, all })), (h) => h.path);

    expect(paths(false)).toEqual([]);
    expect(paths(true)).toEqual([".decisions/0007-x.md"]);
  });

  it("scenario: no shared rare word is no overlap, and a thin corpus or a stopword query says indeterminate", () => {
    expect(Found.isAnyOf(["noOverlap"])(find("kubernetes", entries, { limit: 8, all: false }))).toBe(true);
    expect(Found.isAnyOf(["indeterminate"])(find("the and of", entries, { limit: 8, all: false }))).toBe(true);
    expect(Found.isAnyOf(["indeterminate"])(find("shape", entries.slice(0, 5), { limit: 8, all: false }))).toBe(true);
  });

  it("format: a shortlist prints one line per hit with its score, path, title, notes and words", () => {
    expect(foundLines(find("migrated", entries, { limit: 8, all: false }))).toEqual([
      `shortlist: 1 of ${entries.length - 1} records, by rare shared words; not a clearance`,
      `  ${Math.log(11).toFixed(2)}  .decisions/0011-x.md  Before release a shape change wipes data  supersedes: 0003  words: migrated`,
    ]);
  });
});

describe("resolve", () => {
  const statuses = new Map(
    Arr.flatMap(entries, (e) => (e.decision === undefined ? [] : [[e.decision.id, e.decision.status] as const])),
  );

  it("scenario: a superseded chain lands on the accepted decision at its end; an accepted one lands on itself", () => {
    expect(resolve("0003", statuses)).toEqual(Resolution.cases.superseded.make({ id: "0003", by: ["0011"] }));
    expect(resolve("0001", statuses)).toEqual(Resolution.cases.accepted.make({ id: "0001" }));
    expect(resolve("0007", statuses)).toEqual(Resolution.cases.other.make({ id: "0007", status: "proposed" }));
    expect(resolve("0099", statuses)).toEqual(Resolution.cases.absent.make({ id: "0099" }));
  });

  it("property: along any chain of supersessions, every link resolves to the one accepted decision at its end", () =>
    fc.assert(
      fc.property(fc.uniqueArray(fc.integer({ min: 1, max: 9999 }), { minLength: 1, maxLength: 12 }), (ns) => {
        const ids = Arr.map(ns, (n) => pipe(String(n), Str.padStart(4, "0")));
        const last = ids.at(-1) ?? "";

        const chain = new Map(
          Arr.map(ids, (id, i) => [
            id,
            i === ids.length - 1
              ? Status.cases.accepted.make({})
              : Status.cases.superseded.make({ by: [ids[i + 1] ?? ""] }),
          ]),
        );

        for (const id of ids.slice(0, -1)) {
          expect(resolve(id, chain)).toEqual(Resolution.cases.superseded.make({ id, by: [last] }));
        }
      }),
    ));

  it("scenario: a loop, a link to nothing and a link with no id are broken, never a guess", () => {
    const loop = new Map([
      ["0001", Status.cases.superseded.make({ by: ["0002"] })],
      ["0002", Status.cases.superseded.make({ by: ["0001"] })],
      ["0003", Status.cases.superseded.make({ by: ["0009"] })],
      ["0004", Status.cases.superseded.make({ by: [] })],
    ]);

    expect(Resolution.isAnyOf(["broken"])(resolve("0001", loop))).toBe(true);
    expect(Resolution.isAnyOf(["broken"])(resolve("0003", loop))).toBe(true);
    expect(Resolution.isAnyOf(["broken"])(resolve("0004", loop))).toBe(true);
  });

  it("scenario: two links that meet on one live decision are not a loop", () => {
    const meet = new Map<string, Status>([
      ["0001", Status.cases.superseded.make({ by: ["0002", "0003"] })],
      ["0002", Status.cases.superseded.make({ by: ["0004"] })],
      ["0003", Status.cases.superseded.make({ by: ["0004"] })],
      ["0004", Status.cases.accepted.make({})],
    ]);

    expect(resolve("0001", meet)).toEqual(Resolution.cases.superseded.make({ id: "0001", by: ["0004"] }));
  });
});

describe("status shape", () => {
  const read = (id: string, status: string, successor?: string) =>
    Arr.flatMap(
      readEntries(
        `.decisions/${id}-x.md`,
        `---\nid: ${id}\ntitle: Rule ${id}\nstatus: ${status}\n${successor === undefined ? "" : `successor: "${successor}"\n`}---\n`,
      ),
      (e) => (e.decision === undefined ? [] : [[e.decision.id, e.decision.status] as const]),
    );

  const padded = (n: number) => pipe(String(n), Str.padStart(4, "0"));

  it("property: L9, `superseded` with a successor resolves to that record, `accepted` to itself with no amended-by line, and any other status shows as other with its raw text", () =>
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 9999 }), { minLength: 2, maxLength: 2 }),
        value.filter((s) => s !== "accepted" && s !== "superseded"),
        ([a, b], text) => {
          const [old, live] = [padded(a ?? 1), padded(b ?? 2)];
          const paths = new Map([[live, `.decisions/${live}-x.md`]]);

          const statuses = new Map([...read(old, "superseded", live), ...read(live, "accepted")]);
          expect(resolve(old, statuses)).toEqual(Resolution.cases.superseded.make({ id: old, by: [live] }));
          expect(resolve(live, statuses)).toEqual(Resolution.cases.accepted.make({ id: live }));
          expect(resolutionLine(resolve(old, statuses), paths)).toBe(
            `${old}  superseded  live: .decisions/${live}-x.md`,
          );
          expect(resolutionLine(resolve(live, statuses), paths)).toBe(`${live}  accepted  .decisions/${live}-x.md`);
          expect(resolutionLine(resolve(live, statuses), paths)).not.toContain("amended");

          // Not the new shape: the old links, `superseded` with no successor, and any other text.
          for (const raw of [
            text,
            `superseded by [${live}](${live}-x.md)`,
            `amended-in-part by [${live}](${live}-x.md)`,
          ]) {
            expect(readStatus(raw)).toEqual(Status.cases.other.make({ status: raw }));
            expect(readStatus(raw, live)).toEqual(Status.cases.other.make({ status: raw }));
          }

          expect(readStatus("superseded")).toEqual(Status.cases.other.make({ status: "superseded" }));
          expect(readStatus("")).toEqual(Status.cases.other.make({ status: "(no status)" }));
          expect(resolutionLine(resolve(old, new Map([[old, readStatus(text)]])), paths)).toBe(
            `${old}  status: ${text}  `,
          );
        },
      ),
      { seed: 119120, numRuns: 100 },
    ));
});
