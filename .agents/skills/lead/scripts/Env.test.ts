// S6 of docs/plan/quests/port-scripts-0113-PLAN.md: env.sh's values, as the `Env` service gives
// them to the lead's TypeScript scripts. Written before the port, red until it lands.
//
// The shape these laws hold the port to:
// - `Env.ts` exports `Env`, a `Context.Service` whose value is the record `Values`: MAIN, BOXES,
//   REMOTE, GH_REPO, FABRIKA_COAUTHOR, CODEX_MODEL and CODEX_EFFORT, each a string.
// - `layer`, its real layer: each value from outside comes through Effect's `Config` (so from the
//   `ConfigProvider`, the environment by default), and what is not set from outside comes from the
//   `Git` service (git/Git.ts) and from `local.env` read through Effect's `FileSystem`. It needs no
//   process of its own: every git question goes through `Git`.
// - `layerTest(values)`, its test layer: the fixed record it is given.
//
// The oracle below is env.sh's rules, written from the script as it stands: a value set from
// outside and not empty wins (`${X:-...}`); else MAIN is the folder that holds git's common dir, so
// a worktree finds its main checkout; BOXES is `boxes` beside MAIN; REMOTE is origin's URL; GH_REPO
// is REMOTE without a github.com prefix or a `.git` end; FABRIKA_COAUTHOR is the global git
// `user.name <user.email>`; CODEX_MODEL and CODEX_EFFORT come from `MAIN/.agents/skills/lead/
// local.env`, its last assignment of each, else a default. One rule is the plan's and not env.sh's:
// a value set from outside beats local.env too ("each overridable from outside"), where env.sh's
// sourced local.env overwrites it. The defaults are settings (0069), so no law names them: a law
// reads them from a run where nothing sets the model, and asks only that they are not empty.
//
// It starts no process and touches no disk: `Git` is GitTest's model, the file system holds only the
// generated local.env files, and the outside is a `ConfigProvider` over a generated record. Every
// stand-in answers at once, so the layer is read with `runSyncExit`: a port that waits on nothing
// else than its services builds synchronously.
//
// Each law was planted once (the port changed to break it, the law seen red) and restored by copy;
// the plant is named beside it.
import { ConfigProvider, Effect, Exit, FileSystem, Layer, Path } from "effect";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as Env from "./Env.ts";
import { Git, GitError } from "./git/Git.ts";
import * as GitTest from "./git/GitTest.ts";

const runs = { seed: 119120, numRuns: 100 };

const KEYS = ["MAIN", "BOXES", "REMOTE", "GH_REPO", "FABRIKA_COAUTHOR", "CODEX_MODEL", "CODEX_EFFORT"] as const;
type Key = (typeof KEYS)[number];
type Values = Readonly<Record<Key, string>>;

/** Where env.sh reads local.env, under a main checkout. */
const LOCAL = ".agents/skills/lead/local.env";

const seg = fc.stringMatching(/^[a-z][a-z0-9-]{0,7}$/);
/** An absolute folder two or more deep, so its parent is a folder and not the root. */
const folder = fc.array(seg, { minLength: 2, maxLength: 4 }).map((s) => `/${s.join("/")}`);
const setting = fc.stringMatching(/^[a-z0-9][a-z0-9.-]{0,11}$/);

const FORMS = ["https", "https-bare", "ssh", "ssh-bare", "elsewhere"] as const;

const remote = fc.record({ form: fc.constantFrom(...FORMS), owner: seg, name: seg }).map((r) => ({
  form: r.form,
  url: {
    https: `https://github.com/${r.owner}/${r.name}.git`,
    "https-bare": `https://github.com/${r.owner}/${r.name}`,
    ssh: `git@github.com:${r.owner}/${r.name}.git`,
    "ssh-bare": `git@github.com:${r.owner}/${r.name}`,
    elsewhere: `https://example.com/${r.owner}/${r.name}.git`,
  }[r.form],
}));

/** A value from outside: unset, set but empty (which env.sh's `:-` reads as unset), or set. */
const fromOutside = (value: fc.Arbitrary<string>) =>
  fc.oneof(
    { arbitrary: fc.constant(undefined), weight: 2 },
    { arbitrary: fc.constant(""), weight: 1 },
    { arbitrary: value, weight: 2 },
  );

const outside = fc.record({
  MAIN: fromOutside(folder),
  BOXES: fromOutside(folder),
  REMOTE: fromOutside(remote.map((r) => r.url)),
  GH_REPO: fromOutside(fc.tuple(seg, seg).map(([o, n]) => `${o}/${n}`)),
  FABRIKA_COAUTHOR: fromOutside(fc.tuple(seg, seg).map(([n, e]) => `${n} <${e}@example.invalid>`)),
  CODEX_MODEL: fromOutside(setting),
  CODEX_EFFORT: fromOutside(setting),
});

type Outside = typeof outside extends fc.Arbitrary<infer O> ? O : never;

/** What git answers here: the main checkout, a worktree of it or none, origin, the person's name. */
const repo = fc.record({
  main: folder,
  worktree: fc.option(folder, { nil: undefined }),
  origin: fc.option(remote, { nil: undefined, freq: 4 }),
  name: fc.option(
    fc.array(seg, { minLength: 1, maxLength: 3 }).map((w) => w.join(" ")),
    { nil: undefined, freq: 4 },
  ),
  email: fc.option(
    seg.map((s) => `${s}@example.invalid`),
    { nil: undefined, freq: 4 },
  ),
  // `rev-parse` fails, as outside a repository; env.sh then has no MAIN unless one is set.
  broken: fc.integer({ min: 0, max: 4 }).map((n) => n === 0),
});

type Repo = typeof repo extends fc.Arbitrary<infer R> ? R : never;

/** A local.env line: an assignment of the model or the effort (maybe empty), a comment, a blank. */
const line = fc.oneof(
  fc
    .tuple(fc.constantFrom("CODEX_MODEL", "CODEX_EFFORT"), fc.oneof(setting, fc.constant("")))
    .map(([k, v]) => `${k}=${v}`),
  setting.map((v) => `#   CODEX_MODEL=${v}`),
  fc.constant(""),
);

const local = fc.option(
  fc.array(line, { minLength: 1, maxLength: 5 }).map((ls) => `${ls.join("\n")}\n`),
  { nil: undefined, freq: 3 },
);

/** A value env.sh's `${X:-...}` keeps: set and not empty. */
const given = (o: Outside, key: Key): string | undefined => {
  const v = o[key];
  return v === undefined || v === "" ? undefined : v;
};

/** The last value local.env assigns to `key`, as sourcing it leaves it; comments assign nothing. */
const assigned = (text: string | undefined, key: string): string | undefined => {
  let value: string | undefined;

  for (const l of (text ?? "").split("\n")) {
    if (l.startsWith(`${key}=`)) {
      value = l.slice(key.length + 1);
    }
  }

  return value;
};

const parent = (path: string) => path.slice(0, path.lastIndexOf("/"));

/** env.sh's values for one world, or `undefined` when it has no MAIN to give. */
const oracle = (o: Outside, r: Repo, text: string | undefined, defaults: Values): Values | undefined => {
  const MAIN = given(o, "MAIN") ?? (r.broken ? undefined : r.main);

  if (MAIN === undefined) {
    return undefined;
  }

  const REMOTE = given(o, "REMOTE") ?? r.origin?.url ?? "";
  const pick = (key: "CODEX_MODEL" | "CODEX_EFFORT") => {
    const set = assigned(text, key);
    return given(o, key) ?? (set === undefined || set === "" ? undefined : set) ?? defaults[key];
  };
  return {
    MAIN,
    BOXES: given(o, "BOXES") ?? `${parent(MAIN)}/boxes`,
    REMOTE,
    GH_REPO:
      given(o, "GH_REPO") ?? REMOTE.replace(/^(https:\/\/github\.com\/|git@github\.com:)/, "").replace(/\.git$/, ""),
    FABRIKA_COAUTHOR: given(o, "FABRIKA_COAUTHOR") ?? `${r.name ?? ""} <${r.email ?? ""}>`,
    CODEX_MODEL: pick("CODEX_MODEL"),
    CODEX_EFFORT: pick("CODEX_EFFORT"),
  };
};

/** GitTest's model of the repository, `rev-parse --git-common-dir` refused when it is broken. */
const gitLayer = (r: Repo): Layer.Layer<Git> => {
  const model: GitTest.Model = {
    top: r.worktree ?? r.main,
    commonDir: `${r.main}/.git`,
    commits: { b: { parents: [], tree: {} } },
    refs: { HEAD: "b" },
    remotes: r.origin === undefined ? {} : { origin: r.origin.url },
    globalConfig: {
      ...(r.name === undefined ? {} : { "user.name": r.name }),
      ...(r.email === undefined ? {} : { "user.email": r.email }),
    },
  };
  return r.broken
    ? Layer.effect(
        Git,
        Effect.gen(function* () {
          const git = yield* Git;
          return Git.of({
            ...git,
            commonDir: Effect.fail(GitError.make({ command: "rev-parse", reason: "not a git repository" })),
          });
        }),
      ).pipe(Layer.provide(GitTest.layer(model)))
    : GitTest.layer(model);
};

/** What a read outside the given files answers: the no-op FileSystem's own NotFound. */
const nothing = FileSystem.makeNoop({});

/** A file system that holds only these files, by absolute path, and writes nothing. */
const fileSystem = (files: ReadonlyMap<string, string>): Layer.Layer<FileSystem.FileSystem> => {
  const read = (path: string) => {
    const text = files.get(path);
    return text === undefined ? nothing.readFileString(path) : Effect.succeed(text);
  };
  return FileSystem.layerNoop({
    exists: (path) => Effect.succeed(files.has(path)),
    readFileString: read,
    readFile: (path) => Effect.map(read(path), (text) => new TextEncoder().encode(text)),
  });
};

/** The values the `Env` in context gives. */
const served = Effect.gen(function* () {
  return yield* Env.Env;
});

/** One read of `Env` on the real layer, over this outside, git and file system. */
const readEnv = (o: Outside, git: Layer.Layer<Git>, files: ReadonlyMap<string, string>) => {
  const env = Object.fromEntries(Object.entries(o).filter((e): e is [string, string] => e[1] !== undefined));
  return served.pipe(
    Effect.provide(Env.layer),
    Effect.provide(
      Layer.mergeAll(git, fileSystem(files), Path.layer, ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
    ),
    Effect.runSyncExit,
  );
};

const NOTHING_SET: Outside = {
  MAIN: undefined,
  BOXES: undefined,
  REMOTE: undefined,
  GH_REPO: undefined,
  FABRIKA_COAUTHOR: undefined,
  CODEX_MODEL: undefined,
  CODEX_EFFORT: undefined,
};

/** The defaults: what `Env` gives the model and the effort when nothing sets them. */
const readDefaults = (): Values => {
  const r: Repo = {
    main: "/d/main",
    worktree: undefined,
    origin: undefined,
    name: undefined,
    email: undefined,
    broken: false,
  };
  const exit = readEnv(NOTHING_SET, gitLayer(r), new Map());

  if (!Exit.isSuccess(exit)) {
    throw new Error(`Env with nothing set failed: ${String(exit.cause)}`);
  }

  expect(exit.value.CODEX_MODEL).not.toBe("");
  expect(exit.value.CODEX_EFFORT).not.toBe("");
  return exit.value;
};

describe("Env, env.sh's values for the lead's TypeScript scripts, today's tooling", () => {
  // The tests step wrote these laws before Env.ts existed, so each plant ran once on a reference port
  // written for the plants alone and removed before the commit; the build's port meets them again.
  // Plant, run once: local.env read before the outside, so its model beats an outside CODEX_MODEL,
  // as env.sh's sourcing does. Red: an outside CODEX_MODEL gave local.env's value.
  // Plant, run once: local.env read from `Git.top`, the worktree, in place of MAIN. Red: the decoy's
  // model showed. Plant, run once: GH_REPO kept the `.git` end. Red: `owner/name.git`.
  // Plant, run once: a failed `commonDir` read as MAIN ".". Red: the read succeeded.
  it("property: Env gives the values env.sh gives, each overridable from outside, and local.env sets the model", () => {
    const defaults = readDefaults();
    const seen = new Set<string>();
    fc.assert(
      fc.property(outside, repo, local, fc.boolean(), (o, r, text, decoy) => {
        const want = oracle(o, r, text, defaults);
        const main = given(o, "MAIN") ?? r.main;
        const files = new Map<string, string>();

        if (text !== undefined) {
          files.set(`${main}/${LOCAL}`, text);
        }

        // A local.env where env.sh does not read it: the worktree's own top, or git's main checkout
        // when MAIN is set from outside to another folder. Its values must never show.
        const elsewhere = [r.worktree, main === r.main ? undefined : r.main].filter(
          (p): p is string => p !== undefined && p !== main,
        );

        if (decoy) {
          for (const p of elsewhere) {
            files.set(`${p}/${LOCAL}`, "CODEX_MODEL=decoy-model\nCODEX_EFFORT=decoy-effort\n");
          }
        }

        const exit = readEnv(o, gitLayer(r), files);

        if (want === undefined) {
          // No MAIN from outside and git cannot name one: a failure, never a made-up folder.
          expect(Exit.isFailure(exit)).toBe(true);
          seen.add("git broken, no MAIN: fails");
          return;
        }

        expect(Exit.isSuccess(exit) ? exit.value : exit).toEqual(want);

        for (const key of KEYS) {
          seen.add(given(o, key) === undefined ? `${key} found` : `${key} from outside`);
        }

        seen.add(o.MAIN === "" ? "an empty outside value is unset" : "");
        seen.add(r.broken ? "git broken, MAIN from outside" : "");
        seen.add(r.worktree === undefined ? "" : "a worktree finds its main checkout");
        seen.add(given(o, "REMOTE") === undefined ? `remote ${r.origin?.form ?? "none"}` : "");
        seen.add(given(o, "FABRIKA_COAUTHOR") === undefined && r.name === undefined ? "no user.name" : "");
        seen.add(decoy && elsewhere.length > 0 ? "a local.env elsewhere is ignored" : "");

        for (const key of ["CODEX_MODEL", "CODEX_EFFORT"] as const) {
          const set = assigned(text, key);
          const lines = (text ?? "").split("\n").filter((l) => l.startsWith(`${key}=`));
          seen.add(set !== undefined && set !== "" && given(o, key) === undefined ? `${key} from local.env` : "");
          seen.add(set !== undefined && set !== "" && given(o, key) !== undefined ? "outside beats local.env" : "");
          seen.add(set === "" && given(o, key) === undefined ? "an empty local.env value is unset" : "");
          seen.add(new Set(lines).size > 1 ? "the last assignment wins" : "");
          seen.add(set === undefined && given(o, key) === undefined ? `${key} default` : "");
        }

        seen.add((text ?? "").includes("#   CODEX_MODEL=") ? "a commented assignment is no assignment" : "");
      }),
      runs,
    );
    // Coverage: every rule above met at least once; a case never reached fails here by name.
    const required = [
      ...KEYS.flatMap((key) => [`${key} found`, `${key} from outside`]),
      ...FORMS.map((form) => `remote ${form}`),
      "remote none",
      "git broken, no MAIN: fails",
      "git broken, MAIN from outside",
      "an empty outside value is unset",
      "a worktree finds its main checkout",
      "no user.name",
      "a local.env elsewhere is ignored",
      "CODEX_MODEL from local.env",
      "CODEX_EFFORT from local.env",
      "outside beats local.env",
      "an empty local.env value is unset",
      "the last assignment wins",
      "CODEX_MODEL default",
      "CODEX_EFFORT default",
      "a commented assignment is no assignment",
    ];
    expect(required.filter((r) => !seen.has(r))).toEqual([]);
  });

  // Plant, run once on the reference port: layerTest gave CODEX_EFFORT a default in place of the
  // record's. Red: the record read back differed.
  it("property: layerTest gives back the fixed record it is given", () => {
    const record = fc.record({
      MAIN: fc.string(),
      BOXES: fc.string(),
      REMOTE: fc.string(),
      GH_REPO: fc.string(),
      FABRIKA_COAUTHOR: fc.string(),
      CODEX_MODEL: fc.string(),
      CODEX_EFFORT: fc.string(),
    });
    fc.assert(
      fc.property(record, (values) => {
        const exit = served.pipe(Effect.provide(Env.layerTest(values)), Effect.runSyncExit);
        expect(Exit.isSuccess(exit) ? exit.value : exit).toEqual(values);
      }),
      runs,
    );
  });
});
