// Ticket 1074, today's tooling: on the laptop, `pnpm typecheck` waits for the one typecheck lock and
// for any compiler already running, and says once what it waits on. Every law runs stand-ins: a node
// script for the compiler and pnpm, and a copy of `sleep` under a name of the law's own for a
// compiler the lock does not cover. Each law names a lock file and a compiler name of its own, so a
// real typecheck on the same machine never holds up a law, and a law never holds up a real one.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const script = join(root, "scripts/typecheck.sh");

/** One law's folder: stand-in commands on PATH, an events file the stand-in compiler writes, a lock. */
type Rig = {
  readonly dir: string;
  readonly bin: string;
  readonly events: string;
  readonly lock: string;
  /** A compiler name only this law's processes have. */
  readonly compiler: string;
};

const children: ChildProcess[] = [];
const dirs: string[] = [];

afterEach(() => {
  for (const child of children.splice(0)) {
    try {
      if (child.pid) {
        process.kill(-child.pid, "SIGKILL");
      }
    } catch {
      /* Already reaped. */
    }
  }

  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const rig = (): Rig => {
  const dir = mkdtempSync(join(tmpdir(), "tc-1074-"));
  dirs.push(dir);
  const bin = join(dir, "bin"),
    events = join(dir, "events");
  mkdirSync(bin);
  writeFileSync(events, "");
  // The stand-in compiler: its patch call ends at once; its check writes `start <id>` and runs
  // until the law writes its release file.
  writeFileSync(
    join(dir, "compiler.mjs"),
    `import {appendFileSync, existsSync} from 'node:fs';
if (process.argv.includes('patch')) process.exit(0);
appendFileSync(process.env.TEST_EVENTS, 'start '+process.env.TEST_ID+'\\n');
setInterval(() => { if (existsSync(process.env.TEST_RELEASE)) process.exit(0); }, 10);
`,
  );
  writeFileSync(join(bin, "pnpm"), `#!/bin/sh\nexec '${process.execPath}' '${join(dir, "compiler.mjs")}' "$@"\n`, {
    mode: 0o755,
  });
  // pgrep -x reads a process's name, which Linux cuts to 15 characters.
  const compiler = `tcw${Math.random().toString(36).slice(2, 12)}`;
  return { dir, bin, events, lock: join(dir, "typecheck.lock"), compiler };
};

/** One `pnpm typecheck`, with its stderr kept. */
const typecheck = (r: Rig, id: string, env: Record<string, string | undefined> = {}) => {
  const child = spawn("sh", [script], {
    cwd: root,
    detached: true,
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      PATH: `${r.bin}:${process.env.PATH}`,
      CI: undefined,
      FABRIKA_TYPECHECK_LOCK: r.lock,
      FABRIKA_TYPECHECK_COMPILER: r.compiler,
      TEST_EVENTS: r.events,
      TEST_ID: id,
      TEST_RELEASE: join(r.dir, `release-${id}`),
      TYPESAFE_API_KEY: undefined,
      ...env,
    },
  });
  children.push(child);
  let err = "";
  child.stderr!.on("data", (chunk: Buffer) => {
    err += chunk.toString();
  });
  return { child, stderr: () => err };
};

/** A compiler the lock does not cover: a copy of `sleep` whose process name is the rig's compiler. */
const foreign = (r: Rig) => {
  const path = join(r.bin, r.compiler);
  copyFileSync("/bin/sleep", path);
  const child = spawn(path, ["60"], { detached: true, stdio: "ignore" });
  children.push(child);
  return { child, command: `${path} 60` };
};

const until = async (test: () => boolean, what: string) => {
  const end = Date.now() + 5_000;

  while (!test() && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 20));
  }

  expect(test(), what).toBe(true);
};

const events = (r: Rig) => readFileSync(r.events, "utf8");
const release = (r: Rig, id: string) => writeFileSync(join(r.dir, `release-${id}`), "");
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ended = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null;

describe("T1074 a local typecheck waits for the lock and any running compiler, today's tooling", () => {
  // Plants: take the lock without waiting (two compilers overlap); never write the holder's pid
  // into the lock file (the line names no pid).
  it("two typechecks started together run one after the other, and the waiter names the holder", async () => {
    const r = rig();
    const a = typecheck(r, "a"),
      b = typecheck(r, "b");
    await until(() => events(r) !== "", "neither stand-in compiler started");
    await pause(400);
    const [first, second] = events(r) === "start a\n" ? [a, b] : [b, a];
    expect(events(r), "two stand-in compilers overlapped").toMatch(/^start [ab]\n$/);
    expect(second.stderr()).toMatch(
      new RegExp(`^typecheck: waiting for pid ${first.child.pid} \\(.+\\), which holds ${r.lock}\\n$`),
    );

    release(r, first === a ? "a" : "b");
    await until(() => events(r).split("\n").length === 3, "the waiter never started after the holder ended");
    release(r, second === a ? "a" : "b");
    await until(() => ended(a.child) && ended(b.child), "a typecheck never ended");
    expect([a.child.exitCode, b.child.exitCode, first.stderr()]).toEqual([0, 0, ""]);
    expect(second.stderr().split("\n")).toHaveLength(2);
  });

  // Plant: drop the wait for a running compiler.
  it("waits while a compiler the lock does not cover runs, and names it in one line", async () => {
    const r = rig(),
      other = foreign(r);
    const a = typecheck(r, "a");
    await until(() => a.stderr() !== "", "the typecheck never said what it waits on");
    expect(a.stderr()).toBe(
      `typecheck: waiting for pid ${other.child.pid} (${other.command}), a ${r.compiler} already running\n`,
    );
    await pause(1_500);
    expect(events(r), "the typecheck ran beside a running compiler").toBe("");

    other.child.kill("SIGKILL");
    await until(() => events(r) === "start a\n", "the typecheck never started after the compiler ended");
    release(r, "a");
    await until(() => ended(a.child), "the typecheck never ended");
    expect(a.child.exitCode).toBe(0);
    expect(a.stderr().split("\n"), "the wait printed more than one line").toHaveLength(2);
  });

  // Plant: treat a pid in the lock file as a held lock (a pid-file lock that never checks its owner).
  it("takes over a stale lock whose owner is gone, at once and in silence", async () => {
    const r = rig();
    const gone = spawnSync("sh", ["-c", "echo $$"], { encoding: "utf8" }).stdout.trim();
    writeFileSync(r.lock, `${gone}\n`);
    const a = typecheck(r, "a");
    await until(() => events(r) === "start a\n", "a stale lock held the typecheck up");
    expect(readFileSync(r.lock, "utf8")).toBe(`${a.child.pid}\n`);
    release(r, "a");
    await until(() => ended(a.child), "the typecheck never ended");
    expect([a.child.exitCode, a.stderr()]).toEqual([0, ""]);
  });

  // Plant: drop the CI check, so CI waits on a compiler too.
  it("leaves CI alone: a CI run does not wait on a running compiler", async () => {
    const r = rig();
    foreign(r);
    const a = typecheck(r, "a", { CI: "true" });
    await until(() => events(r) === "start a\n", "CI waited on a running compiler");
    release(r, "a");
    await until(() => ended(a.child), "the typecheck never ended");
    expect([a.child.exitCode, a.stderr()]).toEqual([0, ""]);
  });

  // Plants: read a refused pgrep as "none running" in silence; wait on it.
  it("skips the compiler wait with one line where pgrep cannot list processes", async () => {
    const r = rig();
    writeFileSync(join(r.bin, "pgrep"), "#!/bin/sh\nexit 3\n", { mode: 0o755 });
    const a = typecheck(r, "a");
    await until(() => events(r) === "start a\n", "a refused pgrep held the typecheck up");
    release(r, "a");
    await until(() => ended(a.child), "the typecheck never ended");
    expect([a.child.exitCode, a.stderr()]).toEqual([
      0,
      `typecheck: pgrep cannot list processes here, so the wait for a running ${r.compiler} is skipped\n`,
    ]);
  });
});
