// Today's tooling, [secrets]. redact.sh's laws, kept with their titles and assertions, now on its
// port: `redact.ts`'s command line over the Redact service's real layer, `redact/RedactFs.ts`, run
// here on a disk in memory over Effect's own `FileSystem.layerNoop`, a child process stood in by a
// `ChildProcessSpawner` in memory, and `sys/LockTest.ts`'s lock. No case touches the real disk,
// starts a process or reads a real config or key file (0113). Exact dropped values are in the
// layer's made-up environment.
//
// The disk keeps the facts the laws lean on: reading or writing a folder fails, `remove` of a
// folder needs `recursive` (as Node's `fs.rm` does), `rename` replaces a file but never puts a file
// on a folder, and a temp folder made in a scope is removed when it closes. A call it does not
// model fails, as `layerNoop` makes it (`open` among them). A law arms a refusal on one path, as a
// full disk or a changed mode would; it fires only after the child has ended, and a write refuses
// only once its path was read after that, so it hits the scrub, never the run.
import { NodeServices } from "@effect/platform-node";
import { Recorder } from "@kampus/vitest";
import { ByteSize, Cause, Effect, Exit, FileSystem, HashSet, Layer, Option, Path, PlatformError } from "effect";
import { Predicate, Redacted, Ref, Sink, Stream } from "effect";
import { Command } from "effect/cli";
import { ChildProcessSpawner } from "effect/process";
import { TestConsole } from "effect/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { NO_SPENT, stepRow } from "./agents.ts";
import { Exited, readCount, redact } from "./redact.ts";
import { type Ask, Redact, scrub } from "./redact/Redact.ts";
import * as RedactFs from "./redact/RedactFs.ts";
import * as RedactTest from "./redact/RedactTest.ts";
import * as LockTest from "./sys/LockTest.ts";

const word = fc.stringMatching(/^[a-z][a-z0-9]{3,12}$/);
const options = { seed: 321, numRuns: 8, endOnFailure: true };

const unicode = (text: string) => [...text].map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`).join("");

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** Each run of `%HH` escapes read as UTF-8, a bad byte as U+FFFD: decodeURIComponent, never throwing. */
const unpercent = (text: string): string =>
  text.replace(/(?:%[0-9a-fA-F]{2})+/g, (escapes) =>
    decoder.decode(Uint8Array.from(escapes.slice(1).split("%"), (hex) => Number.parseInt(hex, 16))),
  );

const decode = (text: string) => {
  let value = text
    .replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replaceAll("\\n", "\n");

  for (let i = 0; i < 3; i++) {
    value = unpercent(value);
  }

  return value;
};

// The disk in memory.

type Entry = { readonly _tag: "file"; readonly bytes: Uint8Array } | { readonly _tag: "folder" };

/** What a law can make the disk refuse, once the child has ended. */
type Refusal = { readonly read: Set<string>; readonly write: Set<string>; readonly rename: Set<string> };

type Disk = {
  readonly entries: Map<string, Entry>;
  readonly refuse: Refusal;
  /** True once a child has ended: only then do reads refuse. */
  ended: boolean;
  /** Paths read since the child ended: only then do their writes refuse, so the scrub's write is hit. */
  readonly readAfter: Set<string>;
  /** Called before each rename, with the disk as it is then. */
  onRename: (from: string, to: string) => void;
  temp: number;
};

/** A path as the disk keys it: absolute, no doubled or trailing slash, `.` and `..` read. */
const normal = (path: string): string => {
  const kept: Array<string> = [];

  for (const part of path.split("/")) {
    if (part === "..") {
      kept.pop();
    } else if (part !== "" && part !== ".") {
      kept.push(part);
    }
  }

  return `/${kept.join("/")}`;
};

const above = (path: string): string => normal(`${path}/..`);
const under = (path: string, folder: string): boolean => path.startsWith(`${folder}/`);

const disk = (folders: ReadonlyArray<string>, files: Readonly<Record<string, string>>): Disk => {
  const entries = new Map<string, Entry>([["/", { _tag: "folder" }]]);

  for (const folder of folders) {
    let at = "";

    for (const part of normal(folder).split("/").filter(Boolean)) {
      at = `${at}/${part}`;
      entries.set(at, { _tag: "folder" });
    }
  }

  for (const [path, text] of Object.entries(files)) {
    entries.set(normal(path), { _tag: "file", bytes: encoder.encode(text) });
  }

  return {
    entries,
    refuse: { read: new Set(), write: new Set(), rename: new Set() },
    ended: false,
    readAfter: new Set(),
    onRename: () => {},
    temp: 0,
  };
};

/** A file's text on the disk, or null when the path holds no file. */
const text = (d: Disk, path: string): string | null => {
  const entry = d.entries.get(normal(path));
  return entry?._tag === "file" ? decoder.decode(entry.bytes) : null;
};

const fail = (tag: PlatformError.SystemErrorTag, method: string, path: string) =>
  Effect.fail(PlatformError.systemError({ _tag: tag, module: "FileSystem", method, pathOrDescriptor: path }));

const info = (entry: Entry): FileSystem.File.Info => ({
  type: entry._tag === "folder" ? "Directory" : "File",
  mtime: Option.none(),
  atime: Option.none(),
  birthtime: Option.none(),
  dev: 1n,
  ino: Option.none(),
  mode: entry._tag === "folder" ? 0o040755 : 0o100644,
  nlink: Option.none(),
  uid: Option.none(),
  gid: Option.none(),
  rdev: Option.none(),
  size: ByteSize.bytes(entry._tag === "file" ? entry.bytes.length : 0),
  blksize: Option.none(),
  blocks: Option.none(),
});

const concat = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
};

/** Effect's `FileSystem` over the disk. */
const files = (d: Disk): Layer.Layer<FileSystem.FileSystem> => {
  const readFile = (raw: string) =>
    Effect.suspend(() => {
      const path = normal(raw);
      const entry = d.entries.get(path);

      if (d.ended && d.refuse.read.has(path)) {
        return fail("PermissionDenied", "readFile", path);
      }

      if (entry === undefined) {
        return fail("NotFound", "readFile", path);
      }

      if (entry._tag === "folder") {
        return fail("BadResource", "readFile", path);
      }

      if (d.ended) {
        d.readAfter.add(path);
      }

      return Effect.succeed(new Uint8Array(entry.bytes));
    });
  const writeFile = (raw: string, data: Uint8Array, opts?: { readonly flag?: FileSystem.OpenFlag | undefined }) =>
    Effect.suspend(() => {
      const path = normal(raw);
      const entry = d.entries.get(path);
      const flag = opts?.flag ?? "w";

      if (d.readAfter.has(path) && d.refuse.write.has(path)) {
        return fail("PermissionDenied", "writeFile", path);
      }

      if (d.entries.get(above(path))?._tag !== "folder") {
        return fail("NotFound", "writeFile", path);
      }

      if (entry?._tag === "folder") {
        return fail("BadResource", "writeFile", path);
      }

      if (entry !== undefined && flag.includes("x")) {
        return fail("AlreadyExists", "writeFile", path);
      }

      const kept = entry !== undefined && flag.startsWith("a") ? entry.bytes : new Uint8Array();
      d.entries.set(path, { _tag: "file", bytes: concat(kept, data) });
      return Effect.void;
    });
  const remove = (
    raw: string,
    opts?: { readonly recursive?: boolean | undefined; readonly force?: boolean | undefined },
  ) =>
    Effect.suspend(() => {
      const path = normal(raw);
      const entry = d.entries.get(path);

      if (entry === undefined) {
        return opts?.force === true ? Effect.void : fail("NotFound", "remove", path);
      }

      if (entry._tag === "folder" && opts?.recursive !== true) {
        return fail("BadResource", "remove", path);
      }

      for (const key of [...d.entries.keys()]) {
        if (key === path || under(key, path)) {
          d.entries.delete(key);
        }
      }

      return Effect.void;
    });
  const makeDirectory = (
    raw: string,
    opts?: { readonly recursive?: boolean | undefined },
  ): Effect.Effect<void, PlatformError.PlatformError> =>
    Effect.suspend(() => {
      const path = normal(raw);
      const entry = d.entries.get(path);

      if (entry !== undefined) {
        return entry._tag === "folder" && opts?.recursive === true
          ? Effect.void
          : fail("AlreadyExists", "makeDirectory", path);
      }

      if (d.entries.get(above(path)) === undefined && opts?.recursive === true) {
        return Effect.andThen(makeDirectory(above(path), opts), makeDirectory(path, opts));
      }

      if (d.entries.get(above(path))?._tag !== "folder") {
        return fail("NotFound", "makeDirectory", path);
      }

      d.entries.set(path, { _tag: "folder" });
      return Effect.void;
    });
  const makeTempDirectory = (opts?: {
    readonly directory?: string | undefined;
    readonly prefix?: string | undefined;
  }) =>
    Effect.suspend(() => {
      d.temp += 1;
      const path = normal(`${opts?.directory ?? "/tmp"}/${opts?.prefix ?? ""}${d.temp}`);
      return Effect.as(makeDirectory(path, { recursive: true }), path);
    });
  const stat = (method: string) => (raw: string) =>
    Effect.suspend(() => {
      const entry = d.entries.get(normal(raw));
      return entry === undefined ? fail("NotFound", method, raw) : Effect.succeed(info(entry));
    });

  return FileSystem.layerNoop({
    access: (raw) => (d.entries.has(normal(raw)) ? Effect.void : fail("NotFound", "access", raw)),
    exists: (raw) => Effect.sync(() => d.entries.has(normal(raw))),
    stat: stat("stat"),
    lstat: stat("lstat"),
    realPath: (raw) => (d.entries.has(normal(raw)) ? Effect.succeed(normal(raw)) : fail("NotFound", "realPath", raw)),
    readFile,
    readFileString: (raw) => Effect.map(readFile(raw), (bytes) => decoder.decode(bytes)),
    stream: (raw) => Stream.fromEffect(readFile(raw)),
    writeFile,
    writeFileString: (raw, data, opts) => writeFile(raw, encoder.encode(data), opts),
    sink: (raw, opts) =>
      Sink.unwrap(
        Effect.as(
          writeFile(raw, new Uint8Array(), opts),
          Sink.forEachArray((chunks: ReadonlyArray<Uint8Array>) =>
            Effect.forEach(chunks, (chunk) => writeFile(raw, chunk, { flag: "a" }), { concurrency: 1, discard: true }),
          ),
        ),
      ),
    copyFile: (from, to) => Effect.flatMap(readFile(from), (bytes) => writeFile(to, bytes)),
    readDirectory: (raw) =>
      Effect.sync(() =>
        [...d.entries.keys()]
          .filter((key) => key !== "/" && above(key) === normal(raw))
          .map((key) => key.slice(key.lastIndexOf("/") + 1)),
      ),
    remove,
    makeDirectory,
    makeTempDirectory,
    makeTempDirectoryScoped: (opts) =>
      Effect.acquireRelease(makeTempDirectory(opts), (path) => remove(path, { recursive: true }).pipe(Effect.ignore)),
    rename: (rawFrom, rawTo) =>
      Effect.suspend(() => {
        const from = normal(rawFrom);
        const to = normal(rawTo);
        d.onRename(from, to);
        const moved = d.entries.get(from);
        const there = d.entries.get(to);

        if (d.ended && d.refuse.rename.has(to)) {
          return fail("PermissionDenied", "rename", to);
        }

        if (moved === undefined) {
          return fail("NotFound", "rename", from);
        }

        if (d.entries.get(above(to))?._tag !== "folder") {
          return fail("NotFound", "rename", to);
        }

        if (there !== undefined && (there._tag !== moved._tag || [...d.entries.keys()].some((key) => under(key, to)))) {
          return fail("BadResource", "rename", to);
        }

        for (const [key, entry] of [...d.entries.entries()]) {
          if (key === from || under(key, from)) {
            d.entries.delete(key);
            d.entries.set(`${to}${key.slice(from.length)}`, entry);
          }
        }

        return Effect.void;
      }),
  });
};

// The child process in memory.

/** What one child got, as the stand-in saw it when it started. */
type Child = {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string | undefined;
  /** The environment handed over, or null when none was (the child would inherit the parent's). */
  readonly env: Readonly<Record<string, string>> | null;
  readonly extendEnv: boolean;
  /** Each npm config file the child's environment names, and what it held. */
  readonly configs: Readonly<Record<string, string | null>>;
  /** The project's `.npmrc` when it started, or null when there was none. */
  readonly project: string | null;
  /** The names the lock held when it started. */
  readonly locked: number;
  /** Its stdin, read whole once it ended. */
  stdin: string;
};

/** What a child does while it runs: its writes go on the disk, and it says its output and exit code. */
type Act = (d: Disk, cwd: string) => { readonly out: string; readonly code: number };

type Children = {
  readonly seen: Array<Child>;
  /** How many children run in each folder now, and the most that ever ran in one folder at once. */
  readonly busy: Map<string, number>;
  most: number;
};

type Bytes = Stream.Stream<Uint8Array, PlatformError.PlatformError>;
type BytesSink = Sink.Sink<Uint8Array, Uint8Array, never, PlatformError.PlatformError>;

/** The stdin a command was given as a stream, bare or in its config, else null. */
const givenStdin = (stdin: unknown): Bytes | null =>
  Stream.isStream(stdin)
    ? (stdin as Bytes)
    : Predicate.hasProperty(stdin, "stream") && Stream.isStream(stdin.stream)
      ? (stdin.stream as Bytes)
      : null;

/** The stdout a command was given as a sink, bare or in its config, else null. */
const givenStdout = (stdout: unknown): BytesSink | null =>
  Sink.isSink(stdout)
    ? (stdout as BytesSink)
    : Predicate.hasProperty(stdout, "stream") && Sink.isSink(stdout.stream)
      ? (stdout.stream as BytesSink)
      : null;

const plain = (value: unknown): string => (Redacted.isRedacted(value) ? String(Redacted.value(value)) : String(value));

/** A spawner whose every child runs `act` on the disk; each ends after giving way to the others a while. */
const spawner = (
  d: Disk,
  act: Act,
  children: Children,
  held: Ref.Ref<HashSet.HashSet<string>>,
): Layer.Layer<ChildProcessSpawner.ChildProcessSpawner> =>
  Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) =>
      Effect.gen(function* () {
        if (command._tag !== "StandardCommand") {
          return yield* Effect.die("a piped command: redact runs one command");
        }

        const o = command.options;
        const cwd = o.cwd ?? "/";
        const env =
          o.env === undefined
            ? null
            : Object.fromEntries(Object.entries(o.env).flatMap(([k, v]) => (v === undefined ? [] : [[k, plain(v)]])));
        const configs = Object.fromEntries(
          Object.entries(env ?? {})
            .filter(([k]) => /^NPM_CONFIG_(?:USER|GLOBAL)CONFIG$/i.test(k))
            .map(([k, v]) => [k, text(d, v)]),
        );
        const child: Child = {
          command: command.command,
          args: command.args.map(String),
          cwd: o.cwd,
          env,
          extendEnv: o.extendEnv === true,
          configs,
          project: text(d, `${cwd}/.npmrc`),
          locked: HashSet.size(yield* Ref.get(held)),
          stdin: "",
        };
        children.seen.push(child);
        children.busy.set(cwd, (children.busy.get(cwd) ?? 0) + 1);
        children.most = Math.max(children.most, children.busy.get(cwd) ?? 0);

        const input = givenStdin(o.stdin);
        const piped: Array<Uint8Array> = [];

        if (input !== null) {
          piped.push(...(yield* Stream.runCollect(input).pipe(Effect.orDie)));
        }

        const said = act(d, cwd);
        const bytes = encoder.encode(said.out);
        const sink = givenStdout(o.stdout);

        if (sink !== null) {
          yield* Stream.run(Stream.make(bytes), sink).pipe(Effect.orDie);
        }

        const output = sink === null ? Stream.make(bytes) : Stream.empty;
        const exitCode = Effect.gen(function* () {
          for (let i = 0; i < 8; i++) {
            yield* Effect.yieldNow;
          }

          child.stdin = decoder.decode(piped.reduce(concat, new Uint8Array()));
          children.busy.set(cwd, (children.busy.get(cwd) ?? 1) - 1);
          d.ended = true;
          return ChildProcessSpawner.ExitCode(said.code);
        });

        return ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(31000 + children.seen.length),
          exitCode,
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          stdin: Sink.forEachArray((chunks: ReadonlyArray<Uint8Array>) =>
            Effect.sync(() => void piped.push(...chunks)),
          ),
          stdout: output,
          stderr: Stream.empty,
          all: output,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
          unref: Effect.succeed(Effect.void),
        });
      }),
    ),
  );

const nobody = (): Children => ({ seen: [], busy: new Map(), most: 0 });

/** The real layer on the disk, the stand-in child and a lock in memory, with `env` as its environment. */
const real = (
  d: Disk,
  env: Readonly<Record<string, string>>,
  act: Act,
  children: Children,
  held: Ref.Ref<HashSet.HashSet<string>>,
) =>
  RedactFs.layer(env).pipe(
    Layer.provide(Layer.mergeAll(files(d), Path.layer, spawner(d, act, children, held), LockTest.layer(held))),
  );

const quiet: Act = () => ({ out: "", code: 0 });

/** The exit code a run of the command ends with: 0, or the `Exited` code it failed with; null for any other end. */
const exitCode = (exit: Exit.Exit<unknown, unknown>): number | null => {
  if (Exit.isSuccess(exit)) {
    return 0;
  }

  const error = Cause.squash(exit.cause);
  return error instanceof Exited ? error.code : null;
};

/** One run of `redact.ts`'s command, in process, on `layer`: its exit code, its stdout lines, all it printed and its calls. */
const command = <ROut extends Redact>(args: ReadonlyArray<string>, layer: Layer.Layer<ROut>) =>
  Effect.gen(function* () {
    const exit = yield* Command.runWith(redact, { version: "0.0.0" })(args).pipe(Effect.exit);
    const out = (yield* TestConsole.logLines).map(String);
    const err = (yield* TestConsole.errorLines).map(String);
    return { code: exitCode(exit), out, text: [...out, ...err].join("\n") };
  }).pipe(Effect.provide(Layer.mergeAll(layer, TestConsole.layer)), Effect.provide(NodeServices.layer));

/** The Redact service's `run`, on `layer`. */
const runOn = (a: Ask, layer: Layer.Layer<Redact>) =>
  Effect.gen(function* () {
    const r = yield* Redact;
    return yield* r.run(a);
  }).pipe(Effect.provide(Layer.mergeAll(layer, TestConsole.layer)));

const emptyLock = () => Ref.make(HashSet.empty<string>());

const PATH = "/usr/bin:/bin";

type Saved = { code: number | null; answer: string; events: string };

/** The old file interface: answer and events files scrubbed by the command line, with `secrets` in its environment. */
const run = (
  answer: string,
  events: string,
  secrets: Record<string, string>,
  check: (result: Saved & { text: string; again: Effect.Effect<Saved> }) => Effect.Effect<void> | void,
) =>
  Effect.gen(function* () {
    const a = "/runs/answer.txt",
      e = "/runs/events.jsonl";
    const d = disk(["/runs", "/house", "/tmp"], { [a]: answer, [e]: events });
    const env = { HOME: "/house", PATH, TMPDIR: "/tmp", ...secrets };
    const held = yield* emptyLock();
    const invoke = Effect.map(command([a, e], real(d, env, quiet, nobody(), held)), (got) => ({
      code: got.code,
      text: got.text,
      answer: text(d, a) ?? "",
      events: text(d, e) ?? "",
    }));
    const first = yield* invoke;
    const checked = check({ ...first, again: invoke });

    if (Effect.isEffect(checked)) {
      yield* checked;
    }
  });

const tokens = (value: string) => [
  `npm_${value.repeat(40).slice(0, 36)}`,
  `ghp_${value.repeat(40).slice(0, 36)}`,
  `gho_${value.repeat(40).slice(0, 36)}`,
  `github_pat_${value.repeat(30).slice(0, 22)}_${value.repeat(60).slice(0, 59)}`,
  `sk-${value.repeat(50).slice(0, 48)}`,
  `-----BEGIN PRIVATE KEY-----\n${Buffer.from(value.repeat(10)).toString("base64")}\n-----END PRIVATE KEY-----`,
];

describe("T321 K19 redaction, today's tooling", () => {
  // Plants: skip the event log or one token shape, print a matched value instead of a count.
  it("K19 [secrets] every token shape is removed from both files with only a count printed", () =>
    fc.assert(
      fc.asyncProperty(word, fc.boolean(), (value, reverse) => {
        const secrets = tokens(value);
        const ordered = reverse ? secrets.toReversed() : secrets;
        return run(
          `safe answer\n${ordered.join("\n")}\nsafe tail\n`,
          `${ordered.map((secret) => JSON.stringify({ type: "item.completed", text: secret })).join("\n")}\n`,
          {},
          (got) => {
            expect(got.code, "redact.ts must implement the planned file redaction").toBe(0);

            for (const output of [got.answer, got.events, got.text]) {
              for (const secret of secrets) {
                expect(decode(output).includes(secret)).toBe(false);
              }
            }

            for (const output of [got.answer, got.events]) {
              expect(output).toContain("[redacted]");
            }

            expect(got.answer).toContain("safe answer");
            expect(got.answer).toContain("safe tail");
            expect(got.text.trim()).toMatch(/^[^\d\n]*\d+[^\d\n]*$/);
          },
        ).pipe(Effect.runPromise);
      }),
      options,
    ));

  // Plants: match env names case-sensitively, redact only raw strings, or ignore encoded URLs.
  it("K19 [secrets] exact dropped values disappear through JSON escapes and URL encodings", () =>
    fc.assert(
      fc.asyncProperty(
        fc.record({
          value: word,
          name: fc.constantFrom("TOKEN", "secret", "Api_Key", "db_PASSWORD", "proxy_AUTH", "npm_config_auth"),
          encoding: fc.constantFrom("raw", "unicode", "url", "double-url"),
          reverse: fc.boolean(),
        }),
        ({ value, name, encoding, reverse }) => {
          const secret = `fake/${value}+pass?=end`;
          const encoded =
            encoding === "url"
              ? encodeURIComponent(secret)
              : encoding === "double-url"
                ? encodeURIComponent(encodeURIComponent(secret))
                : secret;
          const json = encoding === "unicode" ? `{"text":"${unicode(secret)}"}` : JSON.stringify({ text: encoded });
          const entries = [
            json,
            JSON.stringify({
              type: "turn.completed",
              usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 2 },
            }),
          ];

          if (reverse) {
            entries.reverse();
          }

          return run(`safe\n${encoded}\n`, `${entries.join("\n")}\n`, { [name]: secret }, (got) =>
            Effect.gen(function* () {
              expect(got.code, "redact.ts must redact exact dropped values").toBe(0);

              for (const output of [got.answer, got.events, got.text]) {
                expect(decode(output).includes(secret)).toBe(false);
              }

              for (const line of got.events.trim().split("\n")) {
                expect(() => JSON.parse(line)).not.toThrow();
              }

              const again = yield* got.again;
              expect(again.code).toBe(0);
              expect(again.answer).toBe(got.answer);
              expect(again.events).toBe(got.events);
            }),
          ).pipe(Effect.runPromise);
        },
      ),
      { ...options, numRuns: 12 },
    ));

  // Plants: match exact values only after decoding, drop the \\b \\f or surrogate-pair escapes,
  // or require a PEM block's END line. Review round 1, finding 2.
  it("K19 [secrets] exact values holding %HH or backslashes, JSON control escapes and cut PEM blocks go", () =>
    fc.assert(
      fc.asyncProperty(
        fc.record({
          value: word,
          shape: fc.constantFrom("percent", "backslash", "control", "emoji"),
          json: fc.boolean(),
        }),
        ({ value, shape, json }) => {
          const secret =
            shape === "percent"
              ? `p%41${value}%2F`
              : shape === "backslash"
                ? `b\\n${value}\\u0041`
                : shape === "control"
                  ? `c\b${value}\f`
                  : `e\u{1F600}${value}`;
          const line = json ? JSON.stringify({ text: secret }) : secret;
          const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(value.repeat(10)).toString("base64")}\n`;
          return run(`safe\n${line}\n${pem}`, `${JSON.stringify({ text: secret })}\n`, { TOKEN: secret }, (got) => {
            expect(got.code).toBe(0);

            for (const output of [got.answer, got.events]) {
              expect(output.includes(secret)).toBe(false);
              expect(output.includes(JSON.stringify(secret).slice(1, -1))).toBe(false);
            }

            expect(got.answer).not.toContain(Buffer.from(value.repeat(10)).toString("base64"));
            expect(got.answer).toContain("safe");
          }).pipe(Effect.runPromise);
        },
      ),
      { ...options, numRuns: 16 },
    ));

  // Plant: stop at the first unreadable file. Review round 1, finding 1.
  it("K19 [secrets] scenario: an unreadable first file fails the run and later files are still scrubbed", () =>
    fc.assert(
      fc.asyncProperty(word, (value) =>
        Effect.gen(function* () {
          const missing = "/runs/missing-dir";
          const later = "/runs/later.txt";
          const secret = `ghp_${value.repeat(40).slice(0, 40)}`;
          const d = disk(["/runs", missing, "/house", "/tmp"], { [later]: `${secret}\n` });
          const held = yield* emptyLock();
          const got = yield* command(
            [missing, later],
            real(d, { HOME: "/house", PATH, TMPDIR: "/tmp" }, quiet, nobody(), held),
          );
          expect(got.code).not.toBe(0);
          expect(text(d, later) ?? "").not.toContain(secret);
        }).pipe(Effect.runPromise),
      ),
      options,
    ));

  // Plant: restore the config before scrubbing, or keep the backup in the temp folder.
  // Review round 1, finding 1: a run that turns .npmrc into a folder.
  it("K19 [secrets] scenario: a run that replaces .npmrc with a folder still scrubs and keeps the config", () =>
    fc.assert(
      fc.asyncProperty(word, (value) =>
        Effect.gen(function* () {
          const cwd = "/house/work";
          const prompt = "/house/prompt",
            answer = "/house/answer.md",
            events = "/house/events.jsonl";
          const d = disk(["/house", cwd, "/tmp"], { [`${cwd}/.npmrc`]: "original\n", [prompt]: "" });
          const secret = `ghp_${value.repeat(40).slice(0, 40)}`;
          // The made-up child: `rm -f .npmrc && mkdir .npmrc && printf '<secret>\n' > <answer> && printf '<secret>\n'`.
          const act: Act = (on, at) => {
            on.entries.delete(`${at}/.npmrc`);
            on.entries.set(`${at}/.npmrc`, { _tag: "folder" });
            on.entries.set(answer, { _tag: "file", bytes: encoder.encode(`${secret}\n`) });
            return { out: `${secret}\n`, code: 0 };
          };
          const held = yield* emptyLock();
          const got = yield* command(
            ["--run", cwd, prompt, answer, events, "--", "sh", "-c", "made-up"],
            real(d, { HOME: "/house", PATH, TMPDIR: "/tmp" }, act, nobody(), held),
          );
          expect(got.code).not.toBeNull();
          expect(text(d, answer) ?? "").not.toContain(secret);
          expect(text(d, events) ?? "").not.toContain(secret);
          expect(text(d, `${cwd}/.npmrc`)).toBe("original\n");
        }).pipe(Effect.runPromise),
      ),
      options,
    ));

  // Plant: lose multiline PEM blocks, or only scrub the file written first.
  it("K19 [secrets] output order and partial failed-run logs do not leave multiline secrets", () =>
    fc.assert(
      fc.asyncProperty(word, fc.constantFrom("answer", "events", "both"), (value, location) => {
        const pem = tokens(value).at(-1)!;
        const exact = `pass-${value}\nsecond-line`;
        const answer = location === "events" ? "safe\n" : `${pem}\n${exact}\n`;
        const events =
          location === "answer" ? "" : `${JSON.stringify({ type: "error", message: `${pem}\n${exact}` })}\n`;
        return run(answer, events, { PLANTED_SECRET: exact }, (got) => {
          expect(got.code, "redact.ts must handle partial failed-run output").toBe(0);

          for (const output of [got.answer, got.events, got.text]) {
            expect(decode(output).includes(pem)).toBe(false);
            expect(decode(output).includes(exact)).toBe(false);
          }

          if (location === "answer") {
            expect(got.events).toBe("");
          }

          if (location === "events") {
            expect(got.answer).toBe("safe\n");
          }
        }).pipe(Effect.runPromise);
      }),
      options,
    ));

  // Plant: redact harmless words, change plain bytes, or rewrite usage records.
  it("K19 plain text, UTF-8, final newlines and usage remain byte-for-byte unchanged", () =>
    fc.assert(
      fc.asyncProperty(word, fc.constantFrom("", "\n", "\r\n"), (value, ending) => {
        const answer = `safe ${value} 猫 café${ending}`;
        const events =
          JSON.stringify({
            type: "turn.completed",
            usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 2 },
            text: value,
          }) + ending;
        return run(answer, events, { PLANTED_SECRET: "absent-madeup-secret" }, (got) => {
          expect(got.code, "redact.ts must preserve safe bytes").toBe(0);
          expect(got.answer).toBe(answer);
          expect(got.events).toBe(events);
        }).pipe(Effect.runPromise);
      }),
      options,
    ));
});

// The laws the port adds (ticket 766, slice S5).

/**
 * One layer of spelling a secret can be saved under: a URL escape, a JSON `\u` escape of each mark
 * that is not a lowercase letter or a digit (as a JSON writer that escapes non-ASCII does), or a
 * JSON string. The `\u` layer leaves letters as they are, so six layers stay small.
 */
type Spelling = "url" | "unicode" | "json";

const spell = (value: string, spelling: Spelling): string =>
  spelling === "url"
    ? encodeURIComponent(value)
    : spelling === "unicode"
      ? value.replace(/[^a-z0-9]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)
      : JSON.stringify(value).slice(1, -1);

/** A secret's text: letters, then the marks that each spelling escapes, then letters. */
const secretText = fc
  .tuple(
    word,
    fc.string({
      unit: fc.constantFrom("/", "+", "?", "=", '"', "\\", " ", "é", "\n", "\u{1F600}"),
      minLength: 1,
      maxLength: 4,
    }),
    word,
  )
  .map(([a, marks, b]) => `${a}${marks}${b}`);

/** Every spelling a text can be read back as, from the saved text down to six decodings. */
const readings = (saved: string): ReadonlyArray<string> => {
  const out = [saved];
  let at = saved;

  for (let i = 0; i < 6; i++) {
    at = unpercent(
      at
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
        .replace(/\\(["\\/bfnrt])/g, (_, c: string) => ({ b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" })[c] ?? c),
    );
    out.push(at);
  }

  return out;
};

/** Where a `--run` can fail, and the clean run. */
type Point =
  | "none"
  | "no_project"
  | "child_fails"
  | "project_folder"
  | "read_answer"
  | "write_answer"
  | "read_events"
  | "write_events"
  | "restore";

const POINTS: ReadonlyArray<Point> = [
  "none",
  "no_project",
  "child_fails",
  "project_folder",
  "read_answer",
  "write_answer",
  "read_events",
  "write_events",
  "restore",
];

const scrubFails = (p: Point) =>
  p === "read_answer" || p === "write_answer" || p === "read_events" || p === "write_events";

const cwd = "/house/work";
const project = `${cwd}/.npmrc`;
const backup = `${cwd}/.npmrc.redact-backup`;

const ask = (words: ReadonlyArray<string>): Ask => ({
  cwd,
  prompt: "/house/prompt",
  answer: "/house/boxes/q-answer.md",
  events: "/house/boxes/q-events.jsonl",
  command: words,
});

describe("T766 S5 redact.ts, the port of redact.sh", () => {
  // Plant, run once on a scratch port: the decode loop runs five rounds, not six. Red: a secret
  // spelled under six layers that each change it was left in the text.
  it("K19 [secrets] property: a secret spelled under up to six layers of JSON and URL escapes, and a token under JSON escapes, is replaced whole, and nothing else changes", () => {
    let six = 0;
    fc.assert(
      fc.property(
        secretText,
        fc.array(fc.constantFrom<Spelling>("url", "unicode", "json"), { minLength: 0, maxLength: 6 }),
        word,
        fc.array(fc.constantFrom<Spelling>("unicode", "json"), { minLength: 0, maxLength: 6 }),
        (secret, layers, value, tokenLayers) => {
          let saved = secret;
          let changed = 0;

          for (const spelling of layers) {
            const next = spell(saved, spelling);
            changed += next === saved ? 0 : 1;
            saved = next;
          }

          six += changed === 6 ? 1 : 0;
          const token = tokenLayers.reduce(spell, `ghp_${value.repeat(40).slice(0, 36)}`);
          const got = scrub(`safe before ${saved} middle ${token} safe after`, [secret]);
          expect(got.text).toBe("safe before [redacted] middle [redacted] safe after");
          expect(got.count).toBe(2);

          for (const reading of readings(got.text)) {
            expect(reading.includes(secret)).toBe(false);
          }

          expect(scrub(`safe before ${value} safe after`, [secret])).toEqual({
            text: `safe before ${value} safe after`,
            count: 0,
          });
        },
      ),
      { seed: 766, numRuns: 100, endOnFailure: true },
    );
    // Coverage: the plant's case, six layers that each change the text, was reached.
    expect(six, "no case spelled a secret under six layers that each change it").toBeGreaterThan(0);
  });

  // Plants, run once on a scratch port: the `.npmrc` restore moved before the scrub (red: the
  // restore ran while the answer held a secret); a failed scrub keeps both files (red: the same
  // line, as the kept answer still held its secret when the config went back); the child given
  // `extendEnv: true` (red: the child added the parent's environment); env names matched
  // case-sensitively (red: `npm_config_auth`'s value reached the child).
  it("K19 [secrets] property: redact.ts --run scrubs both files before the config restore, and a failed scrub deletes them", () => {
    const RUNS = 20;
    const reached = new Set<Point>();
    let runs = 0;
    const law = fc.asyncProperty(
      fc.constantFrom(...POINTS),
      word,
      fc.constantFrom("TOKEN", "Api_Key", "npm_config_auth"),
      (point, value, name) =>
        Effect.gen(function* () {
          reached.add(point);
          runs += 1;

          // Coverage, on the last case: every failure point was reached.
          if (runs === RUNS) {
            expect([...reached].toSorted(), "a failure point was never reached").toEqual([...POINTS].toSorted());
          }

          const a = ask(["codex", "exec", "--json", "-o", "/house/boxes/q-answer.md", "-"]);
          const exact = `pass-${value}/x`;
          const token = `ghp_${value.repeat(40).slice(0, 36)}`;
          const userConfig = "/house/.npmrc";
          const d = disk(["/house/boxes", cwd, "/tmp"], {
            [a.prompt]: `brief for ${value}\n`,
            [userConfig]: `//registry.example/:_authToken=${token}\n`,
            ...(point === "no_project" ? {} : { [project]: `original ${value}\n` }),
          });
          const env = { HOME: "/house", PATH, TMPDIR: "/tmp", [name]: exact, NPM_CONFIG_USERCONFIG: userConfig };
          const seenAtRestore: Array<{ answer: string | null; events: string | null }> = [];
          d.onRename = (_from, to) => {
            if (to === project) {
              seenAtRestore.push({ answer: text(d, a.answer), events: text(d, a.events) });
            }
          };

          if (point === "read_answer" || point === "write_answer") {
            d.refuse[point === "read_answer" ? "read" : "write"].add(a.answer);
          }

          if (point === "read_events" || point === "write_events") {
            d.refuse[point === "read_events" ? "read" : "write"].add(a.events);
          }

          if (point === "restore") {
            d.refuse.rename.add(project);
          }

          const act: Act = (on, at) => {
            if (point === "project_folder") {
              on.entries.delete(`${at}/.npmrc`);
              on.entries.set(`${at}/.npmrc`, { _tag: "folder" });
            }

            on.entries.set(a.answer, { _tag: "file", bytes: encoder.encode(`answer ${token}\n${exact}\n`) });
            return {
              out: `${JSON.stringify({ text: `${exact} ${token}` })}\n`,
              code: point === "child_fails" ? 3 : 0,
            };
          };
          const children = nobody();
          const held = yield* emptyLock();
          const ran = yield* runOn(a, real(d, env, act, children, held));
          const leaks = (saved: string | null) =>
            saved !== null && readings(saved).some((r) => r.includes(exact) || r.includes(token));

          // The child: the words given, in the folder given, fed the prompt, with no secret and a blank config.
          expect(children.seen).toHaveLength(1);
          const child = children.seen[0]!;
          expect([child.command, ...child.args]).toEqual(a.command);
          expect(child.cwd).toBe(cwd);
          expect(child.stdin).toBe(`brief for ${value}\n`);
          expect(child.env, "the child must get its environment handed over, never the parent's").not.toBeNull();
          expect(child.extendEnv, "the child must not add the parent's environment").toBe(false);
          expect(child.env?.PATH).toBe(PATH);
          expect(child.env?.[name]).toBeUndefined();
          expect(Object.values(child.env ?? {}).some((v) => v.includes(exact) || v.includes(token))).toBe(false);
          expect(Object.keys(child.configs)).not.toHaveLength(0);

          for (const [variable, config] of Object.entries(child.configs)) {
            expect(config, `${variable} must name an empty file`).toBe("");
          }

          expect(child.project).toBe(point === "no_project" ? null : "");
          expect(child.locked, "the child runs under the Lock").toBe(1);

          // The scrub came first: whenever the config went back, neither saved file held a secret.
          expect(seenAtRestore).toHaveLength(point === "no_project" ? 0 : 1);

          for (const seen of seenAtRestore) {
            expect(leaks(seen.answer), "the restore ran while the answer held a secret").toBe(false);
            expect(leaks(seen.events), "the restore ran while the events held a secret").toBe(false);
          }

          // After the run: no secret anywhere, and a failed scrub left neither file and no count.
          expect(leaks(text(d, a.answer))).toBe(false);
          expect(leaks(text(d, a.events))).toBe(false);
          expect(HashSet.size(yield* Ref.get(held)), "the lock was given back").toBe(0);

          if (scrubFails(point)) {
            expect(d.entries.has(a.answer), "a failed scrub must delete the answer").toBe(false);
            expect(d.entries.has(a.events), "a failed scrub must delete the events").toBe(false);
            expect(d.entries.has(`${a.events}.redacted`)).toBe(false);
            expect(ran.redacted).toBeNull();
            expect(ran.code).not.toBe(0);
          } else {
            expect(text(d, a.answer)).toContain("[redacted]");
            expect(text(d, a.events)).toContain("[redacted]");
            expect(ran.redacted).toBeGreaterThanOrEqual(2);
            expect(text(d, `${a.events}.redacted`)).toBe(`${ran.redacted}\n`);
            expect(ran.code).toBe(point === "child_fails" ? 3 : point === "restore" ? 1 : 0);
          }

          // The config: back as it was, or, when its restore failed, kept beside it.
          if (point === "no_project") {
            expect(d.entries.has(project)).toBe(false);
          } else if (point === "restore") {
            expect(text(d, backup)).toBe(`original ${value}\n`);
          } else {
            expect(text(d, project)).toBe(`original ${value}\n`);
            expect(d.entries.has(backup)).toBe(false);
          }
        }).pipe(Effect.runPromise),
    );
    return fc.assert(law, { seed: 766, numRuns: RUNS, endOnFailure: true });
  });

  // Plant, run once on a scratch port: RedactFs skips `Lock.hold`. Red: two children ran in one
  // folder at once, and the second swap saved the first one's blank config as the backup.
  it("property: two runs in one folder never hold the .npmrc swap at once", () =>
    fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 4 }), word, (n, value) =>
        Effect.gen(function* () {
          const d = disk(["/house/boxes", cwd, "/tmp"], { "/house/prompt": "", [project]: `original ${value}\n` });
          const children = nobody();
          const asks = Array.from({ length: n }, (_, i) => ({
            ...ask(["codex", "exec", "-"]),
            answer: `/house/boxes/q${i}-answer.md`,
            events: `/house/boxes/q${i}-events.jsonl`,
          }));
          const held = yield* emptyLock();
          // One layer for all the runs, as one laptop's processes share one disk and one lock.
          yield* Effect.gen(function* () {
            const r = yield* Redact;
            yield* Effect.forEach(asks, (one) => r.run(one), { concurrency: "unbounded" });
          }).pipe(
            Effect.provide(
              Layer.mergeAll(
                real(d, { HOME: "/house", PATH, TMPDIR: "/tmp" }, quiet, children, held),
                TestConsole.layer,
              ),
            ),
          );
          expect(children.seen).toHaveLength(n);
          expect(children.most, "two children ran in one folder at once").toBe(1);

          for (const child of children.seen) {
            expect(child.project).toBe("");
            expect(child.locked, "each child runs under the shared Lock, which a second process also sees").toBe(1);
          }

          expect(text(d, project)).toBe(`original ${value}\n`);
          expect(d.entries.has(backup)).toBe(false);
          expect(HashSet.size(yield* Ref.get(held))).toBe(0);
        }).pipe(Effect.runPromise),
      ),
      { seed: 766, numRuns: 30, endOnFailure: true },
    ));

  // Plant, run once on a scratch port: the command drops each word after `--` that starts with a
  // dash. Red: the run got a shorter command than it was given.
  it("format: redact.ts prints only `redacted N`, exits as the scrub or the command did, and hands --run every word after -- unchanged", () => {
    const RUNS = 50;
    const reached = new Set<string>();
    let runs = 0;
    const law = fc.asyncProperty(
      fc.array(fc.stringMatching(/^-{0,2}[a-z0-9]{1,6}$/), { minLength: 1, maxLength: 8 }),
      fc.array(fc.stringMatching(/^\/runs\/[a-z]{1,6}\.(?:md|jsonl)$/), { minLength: 1, maxLength: 3 }),
      fc.nat({ max: 40 }),
      fc.constantFrom(0, 1, 3, 130),
      fc.boolean(),
      (words, paths, count, code, scrubbed) => {
        const ran = { code: scrubbed ? code : Math.max(code, 1), redacted: scrubbed ? count : null };
        const failed = code === 0 ? [] : paths.slice(0, 1);
        const answer: RedactTest.Answer = { files: { count, failed }, ran };
        reached.add(words.some((w) => w.startsWith("-")) ? "a dash word" : "no dash word");
        reached.add(`${ran.code === 0 ? "zero" : "nonzero"} run, ${scrubbed ? "scrubbed" : "not scrubbed"}`);
        runs += 1;

        // Coverage, on the last case: a word with a dash, and a run that ended clean, failed, and failed its scrub.
        if (runs === RUNS) {
          for (const want of [
            "a dash word",
            "zero run, scrubbed",
            "nonzero run, scrubbed",
            "nonzero run, not scrubbed",
          ]) {
            expect(reached, `no case reached: ${want}`).toContain(want);
          }
        }

        /** The command on the test layer: its exit code, its stdout lines and the calls it made. */
        const onTest = (args: ReadonlyArray<string>) =>
          Effect.gen(function* () {
            const exit = yield* Command.runWith(redact, { version: "0.0.0" })(args).pipe(Effect.exit);
            const out = (yield* TestConsole.logLines).map(String);
            return { code: exitCode(exit), out, calls: yield* Recorder.calls(Redact) };
          }).pipe(
            Effect.provide(Layer.mergeAll(RedactTest.layer(answer), TestConsole.layer)),
            Effect.provide(NodeServices.layer),
          );

        return Effect.gen(function* () {
          const asked = yield* onTest(["--run", cwd, "/house/prompt", "/house/a.md", "/house/e.jsonl", "--", ...words]);
          expect(asked.code).toBe(ran.code);
          expect(asked.out).toEqual(scrubbed ? [`redacted ${count}`] : []);
          expect(asked.calls).toEqual([
            {
              method: "run",
              args: [{ cwd, prompt: "/house/prompt", answer: "/house/a.md", events: "/house/e.jsonl", command: words }],
            },
          ]);

          const listed = yield* onTest(paths);
          expect(listed.code).toBe(failed.length === 0 ? 0 : 1);
          expect(listed.out).toEqual([`redacted ${count}`]);
          expect(listed.calls).toEqual([{ method: "files", args: [paths] }]);
        }).pipe(Effect.runPromise);
      },
    );
    return fc.assert(law, { seed: 766, numRuns: RUNS, endOnFailure: true });
  });

  // The amended S5 law (the plan's 2026-11-16 Laws row). drive.ts's and chain.ts's record steps
  // write `redacted: readCount(out)` of redact.ts's output through agents.ts's `stepRow`; both run
  // the real child with spawnSync inside handlers neither module exports, so the law holds the
  // number at the two public names those steps call. Plant, run once: `readCount` read as the old
  // callers did, `Number(out.trim())`. Red: every row's `redacted` was null, not the count.
  it("property: the redacted count is recorded as a number, the run row's `redacted` field N for the output `redacted N`", () => {
    const reached = new Set<string>();
    const noise = fc.array(fc.stringMatching(/^[a-z][a-z0-9 ]{0,20}$/), { maxLength: 3 });
    fc.assert(
      // A clean scrub prints `redacted 0`, which fc.nat alone seldom draws.
      fc.property(fc.oneof(fc.constant(0), fc.nat()), noise, fc.boolean(), (count, before, newline) => {
        const out = [...before, `redacted ${count}`].join("\n") + (newline ? "\n" : "");
        reached.add(count === 0 ? "zero" : "some");
        reached.add(before.length === 0 ? "alone" : "after other lines");
        expect(readCount(out)).toBe(count);
        const row = JSON.parse(
          stepRow({
            run: "t766-tests",
            ticket: "766",
            step: "tests",
            provider: "codex",
            model: "gpt-6-astra",
            effort: "medium",
            outcome: "pass",
            reason: "done.",
            started: new Date("2026-11-16T10:00:00Z"),
            ended: new Date("2026-11-16T10:30:00Z"),
            spent: NO_SPENT,
            redacted: readCount(out),
          }),
        ) as Record<string, unknown>;
        expect(row["redacted"]).toBe(count);
      }),
      // pinned: before the port every row's `redacted` was null, Number("redacted 3") being NaN.
      { seed: 766, numRuns: 100, endOnFailure: true, examples: [[3, [], true]] },
    );

    for (const want of ["zero", "some", "alone", "after other lines"]) {
      expect(reached, `no case reached: ${want}`).toContain(want);
    }
  });
});
