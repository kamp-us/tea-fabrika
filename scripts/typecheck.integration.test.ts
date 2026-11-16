// Ticket 1074, today's tooling: on the laptop, `pnpm typecheck` waits for the one typecheck lock and
// for any compiler already running, and says once what it waits on. Every law runs stand-ins: a node
// script for the compiler and pnpm, and node linked under a name of the law's own for a compiler the
// lock does not cover or a language server. Each law names a lock file and a compiler name of its
// own, so a real typecheck on the same machine never holds up a law, and a law never holds up a real
// one. These laws start processes, so under 0584 they are `.integration.` and run in the full run.
// Ticket 766 ported the script to `scripts/typecheck.ts` (0113); these laws start it with node.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const script = join(root, "scripts/typecheck.ts");

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
  // A process named the rig's compiler, which pgrep -x must see under that name. Node names its main
  // thread `node-MainThread` at start (src/node.cc, through libuv's uv_thread_setname). On Linux the
  // main thread's name is the process's name, /proc/<pid>/comm, the one pgrep -x reads, so the
  // stand-in writes its own name back there. macOS keeps a thread's name apart from the process's,
  // which is the last part of the path it was started from, and has no /proc. A copy of `sleep` did
  // not do: Ubuntu 26.04's `sleep` is uutils' one binary for every tool, which picks the tool by the
  // name it was started under and exits at once under any other.
  writeFileSync(
    join(dir, "named.mjs"),
    `import {existsSync, writeFileSync} from 'node:fs';
import {basename, join} from 'node:path';
if (existsSync('/proc/self/comm')) writeFileSync('/proc/self/comm', basename(process.argv0));
writeFileSync(join(${JSON.stringify(dir)}, 'named-ready'), '');
setTimeout(() => {}, 60_000);
`,
  );
  // pgrep -x reads a process's name, which Linux cuts to 15 characters.
  const compiler = `tcw${Math.random().toString(36).slice(2, 12)}`;
  return { dir, bin, events, lock: join(dir, "typecheck.lock"), compiler };
};

/** One `pnpm typecheck`, with its stderr kept. */
const typecheck = (r: Rig, id: string, env: Record<string, string | undefined> = {}) => {
  const child = spawn(process.execPath, [script], {
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

const until = async (test: () => boolean, what: string) => {
  const end = Date.now() + 5_000;

  while (!test() && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 20));
  }

  expect(test(), what).toBe(true);
};

/**
 * A compiler the lock does not cover, or with `--lsp` a language server: node, linked under the rig's
 * compiler name. It returns once pgrep -x sees that name, so the typecheck after it finds it.
 */
const named = async (r: Rig, args: readonly string[] = []) => {
  const path = join(r.bin, r.compiler),
    standIn = join(r.dir, "named.mjs");
  symlinkSync(process.execPath, path);
  const child = spawn(path, [standIn, ...args], { detached: true, stdio: "ignore" });
  children.push(child);
  // Linux names a new process after the file it runs, here the rig's compiler name, and Node then
  // renames its main thread, which is the process's name, until named.mjs writes it back. So a
  // pgrep before named.mjs is ready can see the name and the next one miss it (ticket 766 saw this
  // flake). The law waits for the stand-in to say it is ready first.
  await until(() => existsSync(join(r.dir, "named-ready")), "the stand-in compiler never got ready");
  await until(() => spawnSync("pgrep", ["-x", r.compiler]).status === 0, "the stand-in compiler never started");
  return { child, command: [path, standIn, ...args].join(" ") };
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
      other = await named(r);
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

  // An editor's language server runs as `tsgo --lsp --stdio` for as long as the editor is open.
  // The stand-in's args hold `--lsp`, as the editor's do.
  // Plant: wait on every compiler pgrep finds, the language server included.
  it("does not wait on a language server, a compiler started with --lsp", async () => {
    const r = rig();
    await named(r, ["--lsp", "--stdio"]);
    const a = typecheck(r, "a");
    await until(() => events(r) === "start a\n", "a language server held the typecheck up");
    release(r, "a");
    await until(() => ended(a.child), "the typecheck never ended");
    expect([a.child.exitCode, a.stderr()]).toEqual([0, ""]);
  });

  // Plant: drop the CI check, so CI waits on a compiler too.
  it("leaves CI alone: a CI run does not wait on a running compiler", async () => {
    const r = rig();
    await named(r);
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

describe("T766 CommandsProcess runs a command in our process group and reads how it ended, today's tooling", () => {
  // N5. Two real `node -e` children, so this law is `.integration.` (0584): one writes its process
  // group as ps reads it and exits 3, one stops itself with SIGTERM. A caps law (R4 "recovers a
  // killed typecheck holder") kills the holder's group and expects its compiler gone with it, which
  // holds only when the command shares our group. Plant: leave Effect's default `detached` (true on
  // Linux and macOS), so the child's group differs from ours.
  it("scenario: a command is heard by its pid first, runs in our process group, and comes back as an exit code or a signal", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tc-766-"));
    dirs.push(dir);
    const group = join(dir, "group");
    const exits = {
      cmd: process.execPath,
      args: [
        "-e",
        `require("node:fs").writeFileSync(${JSON.stringify(group)}, require("node:child_process").execFileSync("ps", ["-o", "pgid=", "-p", String(process.pid)], { encoding: "utf8" }).trim()); process.exit(3);`,
      ],
    };
    const stops = {
      cmd: process.execPath,
      args: ["-e", `process.kill(process.pid, "SIGTERM"); setTimeout(() => {}, 5000);`],
    };
    const { commandsOnNode } = await import("./typecheck/test-helper.ts");
    const { ended, heard } = await commandsOnNode([exits, stops]);
    const ours = spawnSync("ps", ["-o", "pgid=", "-p", String(process.pid)], { encoding: "utf8" }).stdout.trim();
    expect(ended).toEqual([
      { _tag: "exited", code: 3 },
      { _tag: "signaled", signal: "SIGTERM" },
    ]);
    expect(readFileSync(group, "utf8"), "the command ran in a process group of its own").toBe(ours);
    expect(heard, "each command's pid is heard first, and none once it has ended").toEqual([true, false, true, false]);
  });
});
