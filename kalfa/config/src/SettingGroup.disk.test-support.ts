import { inspect } from "node:util";
/**
 * What the laws of the disk calls `SettingGroup.set` and `SettingGroup.remove` (ticket 1843, slice 3) share: the draw, the three classes of what a disk holds, the answer of a call as data, the hiding scenes and the R2 cases.
 *
 * It reuses slice 2's typed files, values and secret values (SettingGroup.edit.test-support.ts) and adds what the disk holds:
 * - (u) where the file is: the repo file under a given `repo` folder, the user file at `$DEMO_HOME`, the user file at `$HOME/.demo`, and no home at all;
 * - (v) the disk's state: the file there, the file missing in its folder, the folder missing, the file a link to another path, and a lock already there;
 * - (w) disk faults: the read refused, the lock's create refused for another reason, the lock's write refused, and the rename refused.
 *
 * Every class is built from the drawn seeds in every run, none is left to chance, and each law keeps the ids it reached and fails when one is missing (slice 2's `Reach`). An id is the class and the case, as `u:home`.
 */
import { expect } from "@effect/vitest";
import { Cause, ConfigProvider, Effect, Exit, FileSystem, Path, PlatformError, Schema } from "effect";
import { Setting, SettingGroup } from "./index.ts";
import type * as MemoryFiles from "./MemoryFiles.test-support.ts";
import { Draw } from "./SettingGroup.edit.test-support.ts";

export const ROOT = "/work";

const HOME = "/people/one";

// ---------------------------------------------------------------------------------------------
// The draw: slice 2's draw, and what the disk adds.
// ---------------------------------------------------------------------------------------------

const Word = Schema.String.check(Schema.isPattern(/^[a-z]{3,6}$/u));

/** Text that a lock holds and a file can hold: no lone surrogate, no DEL. */
const Held = Schema.String.check(Schema.isPattern(/^[^\uD800-\uDFFF\u007f]*$/u), Schema.isMaxLength(12));

/** What a disk refuses with, other than a missing path or a path that is there. */
const Refusal = Schema.Literals(["PermissionDenied", "Busy", "Unknown", "TimedOut"]);

export const DiskDraw = Schema.Struct({
  ...Draw.fields,
  disk: Schema.Struct({
    /** The folder `$DEMO_HOME` names, and the folder a linked file points into. */
    moved: Word,
    dots: Word,
    /** What a lock already there holds. */
    lock: Held,
    /** Which case of (u) the first of each run's files gets: the rest follow in turn. */
    turn: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 })),
    /** What a refused read and a refused write answer with. */
    read: Refusal,
    create: Refusal,
    write: Refusal,
    rename: Refusal,
  }),
});

export type DiskDraw = typeof DiskDraw.Type;

// ---------------------------------------------------------------------------------------------
// (u) where the file is.
// ---------------------------------------------------------------------------------------------

export type Site = "repo" | "demo-home" | "home" | "no-home";

/** One place of a configuration file: the file, the environment that finds it, and the names a person reads. */
export interface Place {
  readonly site: Site;
  readonly app: string;
  readonly file: Setting.File;
  /** The whole environment: the start's rule finds the user file from it. */
  readonly env: Readonly<Record<string, string>>;
  /** The file's own path, or none with no home. */
  readonly path: string | undefined;
  /** The folder that holds the file. */
  readonly dir: string | undefined;
  /** The file as the start names it. */
  readonly name: string;
  /** The variables a user file is found from, in the order the start reads them. */
  readonly variables: ReadonlyArray<string>;
}

export const placeFor = (app: string, site: Site, moved: string): Place => {
  const variable = `${app.toUpperCase()}_HOME`;
  const base = { site, app, variables: [variable, "HOME"] } as const;

  switch (site) {
    case "repo":
      return {
        ...base,
        file: "repo",
        env: { HOME },
        path: `${ROOT}/.${app}/${app}.toml`,
        dir: `${ROOT}/.${app}`,
        name: `.${app}/${app}.toml`,
      };
    case "demo-home":
      return {
        ...base,
        file: "user",
        env: { HOME, [variable]: `/moved/${moved}` },
        path: `/moved/${moved}/${app}.toml`,
        dir: `/moved/${moved}`,
        name: `$${variable}/${app}.toml`,
      };
    case "home":
      return {
        ...base,
        file: "user",
        env: { HOME },
        path: `${HOME}/.${app}/${app}.toml`,
        dir: `${HOME}/.${app}`,
        name: `~/.${app}/${app}.toml`,
      };
    case "no-home":
      return { ...base, file: "user", env: {}, path: undefined, dir: undefined, name: `~/.${app}/${app}.toml` };
  }
};

/** The place the nth file of a run gets: the repo file for the repo, and for the user file the two homes in turn. */
export const siteFor = (draw: DiskDraw, file: Setting.File, n: number): Site =>
  file === "repo" ? "repo" : (n + draw.disk.turn) % 2 === 0 ? "demo-home" : "home";

// ---------------------------------------------------------------------------------------------
// (v) the disk's state.
// ---------------------------------------------------------------------------------------------

type State = "file" | "no-file" | "no-folder" | "no-parent" | "link" | "lock";

const outside = (path: string) => path.slice(0, path.lastIndexOf("/"));

/** Site a linked file points: a dotfiles folder away from the app's own. */
export const dotfile = (place: Place, dots: string) => `/dots/${dots}/${place.app}.toml`;

/** What the disk holds for a place in a state: `text` is the file's, `lock` the text of a lock already there. */
export const seedFor = (
  place: Place,
  state: State,
  held: { readonly text: string; readonly dots: string; readonly lock: string },
  faults: ReadonlyArray<MemoryFiles.Fault> = [],
): MemoryFiles.Seed => {
  const { path, dir } = place;

  if (path === undefined || dir === undefined) {
    return { faults };
  }

  switch (state) {
    case "file":
      return { files: { [path]: held.text }, faults };
    case "no-file":
      return { folders: [dir], faults };
    case "no-folder":
      return { folders: [outside(dir)], faults };
    case "no-parent":
      return { faults };
    case "link":
      return {
        files: { [dotfile(place, held.dots)]: held.text },
        links: { [path]: dotfile(place, held.dots) },
        faults,
      };
    case "lock":
      return { files: { [path]: held.text, [`${path}.lock`]: held.lock }, faults };
  }
};

// ---------------------------------------------------------------------------------------------
// (w) disk faults: each as a call that answers an error, on the path the program gives it.
// ---------------------------------------------------------------------------------------------

const refusal = (tag: typeof Refusal.Type, method: string, path: string) =>
  // oxlint-disable-next-line fabrika/no-hand-tag -- edge: Effect PlatformError requires its own system error tag
  PlatformError.systemError({ _tag: tag, module: "FileSystem", method, pathOrDescriptor: path });

/** The read of a file refused. */
export const readRefused = (path: string, tag: typeof Refusal.Type): MemoryFiles.Fault => ({
  method: ["readFile", "readFileString"],
  path,
  error: refusal(tag, "readFileString", path),
});

/** The lock's exclusive create refused for a reason other than a lock already there. */
export const createRefused = (lock: string, tag: typeof Refusal.Type): MemoryFiles.Fault => ({
  method: ["writeFile", "writeFileString"],
  path: lock,
  flag: "wx",
  error: refusal(tag, "writeFileString", lock),
});

/** The write of the new text into the lock refused. */
export const writeRefused = (lock: string, tag: typeof Refusal.Type): MemoryFiles.Fault => ({
  method: ["writeFile", "writeFileString"],
  path: lock,
  flag: "w",
  error: refusal(tag, "writeFileString", lock),
});

/** The rename of the lock over the file refused. */
export const renameRefused = (lock: string, tag: typeof Refusal.Type): MemoryFiles.Fault => ({
  method: "rename",
  path: lock,
  error: refusal(tag, "rename", lock),
});

// ---------------------------------------------------------------------------------------------
// What a call answered, as data.
// ---------------------------------------------------------------------------------------------

/** What a disk call left: it ended, or the error's parts. `printed` is every text the failure can print, its cause included. */
export const Answer = Schema.TaggedUnion({
  done: {},
  failed: {
    reason: Schema.String,
    file: Schema.UndefinedOr(Schema.String),
    line: Schema.UndefinedOr(Schema.Int),
    message: Schema.String,
    printed: Schema.String,
  },
});

export type Answer = typeof Answer.Type;

export const answer = (exit: Exit.Exit<void, unknown>): Answer => {
  if (Exit.isSuccess(exit)) {
    return Answer.cases.done.make({});
  }

  const errors = exit.cause.reasons.flatMap((reason) => (reason._tag === "Fail" ? [reason.error] : []));
  const error = errors[0];

  // One call, one error: never two, and never a defect beside it.
  expect(exit.cause.reasons).toHaveLength(1);
  expect(error).toBeInstanceOf(SettingGroup.SettingsError);

  return Schema.is(SettingGroup.SettingsError)(error)
    ? Answer.cases.failed.make({
        reason: error.reason,
        file: error.file,
        line: error.line,
        message: error.message,
        printed: [
          Cause.pretty(exit.cause),
          error.message,
          String(error.cause),
          inspect(error, { depth: null, customInspect: false, showHidden: true }),
        ].join("\n"),
      })
    : Answer.cases.failed.make({
        reason: "not a SettingsError",
        file: undefined,
        line: undefined,
        message: "",
        printed: "",
      });
};

/** Whether the error names the file as a person reads it, in its `file` or in its message. */
export const names = (found: Answer, name: string) =>
  found._tag === "failed" && (found.file === name || found.message.includes(name));

// ---------------------------------------------------------------------------------------------
// A secret that is accepted: a text setting set to it, in a file that holds it in a comment.
// ---------------------------------------------------------------------------------------------

/** A group of a text setting `<w>.secret` and a port `<w>.other`, for the one scene of D8 that slice 2's refusals lack: the secret is a value the call accepts. */
export const accepted = (draw: DiskDraw) => {
  const table = draw.w;

  const secret = Setting.make(`${table}.secret`, Schema.String).pipe(
    Setting.withDefault("dflt"),
    Setting.withDescription("A generated text."),
  );

  const other = Setting.make(`${table}.other`, Schema.Int).pipe(
    Setting.withDefault(1),
    Setting.withDescription("A generated number."),
  );

  const settings: ReadonlyArray<Setting.Any> = [secret, other];

  return { table, group: SettingGroup.make(draw.app, ...settings), setting: secret, file: draw.file };
};

// ---------------------------------------------------------------------------------------------
// R2: five cases, run on a real temp folder and in memory.
// ---------------------------------------------------------------------------------------------

const Approver = Schema.Literals(["people", "robots", "owner"]);

const approver = Setting.make("delivery.approver", Approver).pipe(
  Setting.withDefault("people"),
  Setting.withDescription("Who may approve a change request."),
);

const group = SettingGroup.make("demo", approver);

/** What a folder holds, as plain data both disks must agree on: paths below the root, a link's target below the root too. */
interface Snapshot {
  readonly files: Readonly<Record<string, string>>;
  readonly links: Readonly<Record<string, string>>;
  readonly folders: ReadonlyArray<string>;
}

interface Case {
  readonly name: string;
  /** The text of the file the call edits, empty when there is none: the pure edit of it is what a set must leave. */
  readonly text: string;
  readonly file: Setting.File;
  readonly value: "owner" | "robots";
  /** The files, links and folders it starts with, by path below the root. A link names the path it points to. */
  readonly files: Readonly<Record<string, string>>;
  readonly links: Readonly<Record<string, string>>;
  readonly folders: ReadonlyArray<string>;
  /** The reason the call fails with, or none. */
  readonly fails: "write" | undefined;
  /** What it must leave, given the pure edit's text. */
  readonly leaves: (pure: string) => Snapshot;
}

const REPO_TEXT = '# Who may approve.\n[delivery]\napprover = "people"   # the default\n';

const OWNER_TEXT = '[delivery]\napprover = "owner"\n';

/** The five cases: the same on a real temp folder and in memory. */
export const CASES: ReadonlyArray<Case> = [
  {
    name: "a set into a missing .demo folder",
    text: "",
    file: "repo",
    value: "owner",
    files: {},
    links: {},
    folders: [],
    fails: undefined,
    leaves: (pure) => ({
      files: { "repo/.demo/demo.toml": pure },
      links: {},
      folders: ["home", "repo", "repo/.demo"],
    }),
  },
  {
    name: "a set that keeps a comment",
    text: REPO_TEXT,
    file: "repo",
    value: "owner",
    files: { "repo/.demo/demo.toml": REPO_TEXT },
    links: {},
    folders: [],
    fails: undefined,
    leaves: (pure) => ({
      files: { "repo/.demo/demo.toml": pure },
      links: {},
      folders: ["home", "repo", "repo/.demo"],
    }),
  },
  {
    name: "a set through a linked user file",
    text: REPO_TEXT,
    file: "user",
    value: "robots",
    files: { "dots/demo.toml": REPO_TEXT },
    links: { "home/.demo/demo.toml": "dots/demo.toml" },
    folders: [],
    fails: undefined,
    leaves: (pure) => ({
      files: { "dots/demo.toml": pure },
      links: { "home/.demo/demo.toml": "dots/demo.toml" },
      folders: ["dots", "home", "home/.demo", "repo"],
    }),
  },
  {
    name: "a held lock",
    text: REPO_TEXT,
    file: "repo",
    value: "owner",
    files: { "repo/.demo/demo.toml": REPO_TEXT, "repo/.demo/demo.toml.lock": "held" },
    links: {},
    folders: [],
    fails: "write",
    leaves: () => ({
      files: { "repo/.demo/demo.toml": REPO_TEXT, "repo/.demo/demo.toml.lock": "held" },
      links: {},
      folders: ["home", "repo", "repo/.demo"],
    }),
  },
  {
    name: "a no-change set",
    text: OWNER_TEXT,
    file: "repo",
    value: "owner",
    files: { "repo/.demo/demo.toml": OWNER_TEXT },
    links: {},
    folders: [],
    fails: undefined,
    leaves: () => ({
      files: { "repo/.demo/demo.toml": OWNER_TEXT },
      links: {},
      folders: ["home", "repo", "repo/.demo"],
    }),
  },
];

/** What the pure edit answers for a case's text: the text a set must leave. */
export const pureText = (c: Case) =>
  Effect.map(Effect.exit(SettingGroup.edit(group, c.text, c.file).set(approver, c.value)), (exit) =>
    Exit.isSuccess(exit) ? exit.value : c.text,
  );

/** Reads everything below `root`, through the file system and nothing else. */
const read = Effect.fnUntraced(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const files: Record<string, string> = {};
  const links: Record<string, string> = {};
  const folders: Array<string> = [];

  const below = (full: string) => path.relative(root, full);
  const target = (to: string) => (to.startsWith(`${root}/`) ? below(to) : to);

  const walk: (folder: string) => Effect.Effect<void, PlatformError.PlatformError> = Effect.fnUntraced(function* (
    folder: string,
  ) {
    for (const entry of yield* fs.readDirectoryEntries(folder)) {
      const full = path.join(folder, entry.name);

      if (entry.type === "File") {
        files[below(full)] = yield* fs.readFileString(full);
      } else if (entry.type === "SymbolicLink") {
        links[below(full)] = target(yield* fs.readLink(full));
      } else if (entry.type === "Directory") {
        folders.push(below(full));
        yield* walk(full);
      }
    }
  });

  yield* walk(root);

  return { files, links, folders: folders.sort() } satisfies Snapshot;
});

/** Sets a case up under `root` with file system calls only, so a real folder and the stand-in are made the same way. */
const setUp = Effect.fnUntraced(function* (c: Case, root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const at = (below: string) => path.join(root, below);

  for (const folder of ["repo", "home", ...c.folders]) {
    yield* fs.makeDirectory(at(folder), { recursive: true });
  }

  for (const [below, text] of Object.entries(c.files)) {
    yield* fs.makeDirectory(path.dirname(at(below)), { recursive: true });
    yield* fs.writeFileString(at(below), text);
  }

  for (const [below, to] of Object.entries(c.links)) {
    yield* fs.makeDirectory(path.dirname(at(below)), { recursive: true });
    yield* fs.symlink(at(to), at(below));
  }
});

/** What one case left on a disk under `root`, and what the call answered. `root` is the disk's own name for its folder. */
export const runCase = Effect.fnUntraced(function* (c: Case, root: string) {
  yield* setUp(c, root);

  const exit = yield* Effect.exit(
    SettingGroup.set(group, approver, c.value, c.file, { repo: `${root}/repo` }).pipe(
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { HOME: `${root}/home` } }))),
    ),
  );

  const found = answer(exit);
  const left = yield* read(root);

  return {
    left,
    // A message is compared with the disk's own folder taken out; the cause under it is the disk's, and stays out.
    answer:
      found._tag === "failed"
        ? {
            reason: found.reason,
            file: found.file,
            line: found.line,
            message: found.message.replaceAll(root, "<root>"),
          }
        : { reason: "done" },
  };
});
