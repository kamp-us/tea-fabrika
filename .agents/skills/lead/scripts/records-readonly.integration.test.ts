import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Stream } from "effect";
import { ChildProcess } from "effect/process";

const script = `${import.meta.dirname}/records.ts`;

const run = Effect.fnUntraced(function* (cwd: string, command: string, args: ReadonlyArray<string>) {
  const handle = yield* ChildProcess.make(command, args, { cwd, stdin: "ignore" });

  const [out, err, code] = yield* Effect.all(
    [
      Stream.mkString(Stream.decodeText(handle.stdout)),
      Stream.mkString(Stream.decodeText(handle.stderr)),
      handle.exitCode,
    ],
    { concurrency: 3 },
  );

  return { out, err, code: Number(code) };
}, Effect.scoped);

const git = Effect.fnUntraced(function* (cwd: string, ...args: Array<string>) {
  const result = yield* run(cwd, "git", args);
  expect(result.code, result.err).toBe(0);

  return result.out;
});

const fixture = Effect.fnUntraced(function* () {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "records-readonly-" });
  const origin = `${root}/origin`;
  const clone = `${root}/clone`;
  yield* git(root, "init", "-q", "-b", "main", origin);
  yield* fs.makeDirectory(`${origin}/.decisions`);

  for (let n = 1; n <= 10; n++) {
    yield* fs.writeFileString(
      `${origin}/.decisions/${String(n).padStart(4, "0")}-rule.md`,
      `---\ntitle: Topic${n}\nstatus: accepted\n---\n`,
    );
  }

  yield* git(origin, "add", ".");
  yield* git(
    origin,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "records",
  );
  yield* git(root, "clone", "-q", origin, clone);

  return { fs, root, origin, clone };
});

const snapshot = Effect.fnUntraced(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* fs.readDirectory(root, { recursive: true });

  return yield* Effect.forEach(
    [...paths].sort(),
    (path) =>
      Effect.gen(function* () {
        const stat = yield* fs.stat(`${root}/${path}`);

        return {
          path,
          mtime: stat.mtime,
          bytes: stat.type === "File" ? Array.from(yield* fs.readFile(`${root}/${path}`)) : [],
        };
      }),
    { concurrency: 1 },
  );
});

it.effect("scenario: an unavailable origin and blocked FETCH_HEAD still allow read-only ranking without writes", () =>
  Effect.gen(function* () {
    const { fs, clone, origin } = yield* fixture();
    yield* fs.writeFileString(
      `${clone}/.decisions/0001-rule.md`,
      "---\ntitle: Untracked flamingos\nstatus: accepted\n---\n",
    );
    yield* git(clone, "remote", "set-url", "origin", `${origin}/missing`);
    yield* fs.makeDirectory(`${clone}/.git/FETCH_HEAD`);
    const before = yield* snapshot(clone);
    const result = yield* run(clone, process.execPath, [script, "find", "--read-only", "topic1", "flamingos"]);
    expect(result.code, result.err).toBe(0);
    expect(result.out).toContain("shortlist: 1 of 10 records");
    expect(result.out).toContain(".decisions/0001-rule.md  Topic1");
    expect(result.out).not.toContain("flamingos");
    expect(yield* snapshot(clone)).toEqual(before);
    const normal = yield* run(clone, process.execPath, [script, "find", "topic1"]);
    expect(normal.code).toBe(1);
    expect(normal.err).toContain("cannot fetch origin main");
    expect(normal.out).toBe("");
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("scenario: a changed origin distinguishes fresh and cached ranking, and a missing ref fails", () =>
  Effect.gen(function* () {
    const { fs, clone, origin } = yield* fixture();
    yield* fs.writeFileString(`${origin}/.decisions/0001-rule.md`, "---\ntitle: Pelicans\nstatus: accepted\n---\n");
    yield* git(origin, "add", ".");
    yield* git(
      origin,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "new title",
    );
    const cached = yield* run(clone, process.execPath, [script, "find", "--read-only", "topic1", "pelicans"]);
    expect(cached.code, cached.err).toBe(0);
    expect(cached.out).toContain("Topic1");
    expect(cached.out).not.toContain("Pelicans");
    const normal = yield* run(clone, process.execPath, [script, "find", "topic1", "pelicans"]);
    expect(normal.code, normal.err).toBe(0);
    expect(normal.out).toContain("Pelicans");
    expect(normal.out).not.toContain("Topic1");
    yield* git(clone, "update-ref", "-d", "refs/remotes/origin/main");
    const missing = yield* run(clone, process.execPath, [script, "find", "--read-only", "pelicans"]);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain("cannot read");
    expect(missing.out).toBe("");
  }).pipe(Effect.provide(NodeServices.layer)),
);
