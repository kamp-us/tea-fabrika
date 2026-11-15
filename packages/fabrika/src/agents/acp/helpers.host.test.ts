import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { layer as nodeServices } from "@effect/platform-node/NodeServices";
import { Duration, Effect, Exit, Scope } from "effect";
import { afterAll, describe, expect, it } from "vitest";
import { connect } from "./client.ts";
import { type Harness, harnessOf, type Row } from "./harness.ts";

// The agent helpers plan (docs/plan/lanes/dock-PLAN.md), laws L7 and L8, today's version. Host-only
// (0178): they need a real macOS session, the real Electron 45.2.1 binary and the real adapters
// (`pnpm --dir adapters install --ignore-workspace --frozen-lockfile`). They run only where a person
// chose to run them, on a Mac, after the lead read every line below that touches a process.
// Anywhere else this file skips itself: FABRIKA_HOST_LAWS=1 on a Mac turns it on.
//
//   FABRIKA_HOST_LAWS=1 nice -n 15 pnpm exec vitest run --maxWorkers=1 packages/fabrika/src/agents/acp/helpers.host.test.ts
//
//   harnessOf({ name: "codex", access: "read" }, folder, null, parent)   on Electron, its command the Electron binary
//   // connect(...) starts it: its group G holds codex-acp and codex.js, each with ELECTRON_RUN_AS_NODE=1,
//   // no `Electron Helper --type=` process, and no app in `lsappinfo list` whose pid is in G
//
// No model is called: each adapter is only started and initialized, Codex's in a temp home with no
// login. The host runs on the Electron binary, run as Node, so `process.execPath` is that binary
// there; here the harness's command is set to it, and `process.versions.electron` is set for the
// `harnessOf` call, so the harness is what the host would start.
//
// What this file does to processes. It sends no signal itself. It reads `ps -axE -o pid=,pgid=,command=`
// and `lsappinfo list` (`groupOf`, `appPids`). A connected adapter ends when its scope closes:
// Effect's spawner sends SIGTERM, then SIGKILL after 3 s, to the group of the child it spawned
// (`connect`, client.ts). L8's first case closes only the adapter's stdin and lets go of its handle
// (`unref`): nothing is killed, and a process left at the end fails the law and is left running,
// for a person to see and end.

const enabled = process.platform === "darwin" && process.env.FABRIKA_HOST_LAWS === "1";

const ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

/** The real Electron binary, as `apps/fabrika` installs it. Asked for only when a law runs: asking may download it. */
const electronBinary = (): string => createRequire(join(ROOT, "apps", "fabrika", "package.json"))("electron") as string;

const made: string[] = [];

afterAll(() => {
  for (const folder of made.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

/** A home with no login and a work folder, both under the temp folder. */
const place = () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "helpers-host-")));
  made.push(root);
  const home = join(root, "home");
  const folder = join(root, "work");
  mkdirSync(home);
  mkdirSync(folder);
  const parent = { PATH: process.env.PATH, HOME: home, TMPDIR: tmpdir(), USER: process.env.USER };
  return { folder, parent };
};

/** The harness the host, on Electron, would start for `row`, on the real Electron binary. */
const asTheHost = (row: Row, folder: string, parent: Record<string, string | undefined>): Harness => {
  Object.defineProperty(process.versions, "electron", { value: "45.2.1", configurable: true, enumerable: true });

  try {
    const h = harnessOf(row, folder, null, parent);

    if (h.name === "codex") {
      // Its own home, made as `prepare` would, but with no link to a login: none is wanted.
      mkdirSync(h.env.CODEX_HOME!, { recursive: true });
    }

    return { ...h, command: electronBinary() };
  } finally {
    Reflect.deleteProperty(process.versions, "electron");
  }
};

interface Row6 {
  readonly pid: number;
  readonly pgid: number;
  /** The command line, with its environment after it (`ps -E`). */
  readonly line: string;
}

/**
 * Every process in group `pgid`, read with `ps`. With `env`, each line ends with the process's
 * environment (`ps -E`): read for the switch, never printed.
 */
const groupOf = (pgid: number, env = true): readonly Row6[] =>
  execFileSync("ps", [env ? "-axE" : "-ax", "-o", "pid=,pgid=,command="], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .flatMap((text) => {
      const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(text);
      return m === null ? [] : [{ pid: Number(m[1]), pgid: Number(m[2]), line: m[3] ?? "" }];
    })
    .filter((p) => p.pgid === pgid);

/** Group `pgid` as a log may show it: each pid and command line, no environment. */
const shown = (pgid: number): readonly string[] => groupOf(pgid, false).map((p) => `${p.pid} ${p.line}`);

/** The pids of the apps LaunchServices lists, which is what the Dock reads. */
const appPids = (): ReadonlySet<number> =>
  new Set(
    [...execFileSync("lsappinfo", ["list"], { encoding: "utf8" }).matchAll(/\bpid = (\d+)/g)].map((m) => Number(m[1])),
  );

/** What is wrong with group `pgid` now, for a binary `electron`: one line per fault, none when it is right. */
const faultsOf = (pgid: number, electron: string): readonly string[] => {
  const group = groupOf(pgid);
  const apps = appPids();
  return group.flatMap((p) => [
    ...(p.line.startsWith(`${electron} `) && !/(?:^|\s)ELECTRON_RUN_AS_NODE=1(?:\s|$)/.test(p.line)
      ? [`${p.pid} runs the Electron binary without ELECTRON_RUN_AS_NODE=1`]
      : []),
    ...(/Electron Helper/.test(p.line) && /\s--type=/.test(p.line) ? [`${p.pid} is an Electron Helper of an app`] : []),
    ...(apps.has(p.pid) ? [`${p.pid} is an app LaunchServices lists`] : []),
  ]);
};

/** Wait until `check` holds, `seconds` at most; answers whether it did. */
const waitFor = (check: () => boolean, seconds: number) =>
  Effect.gen(function* () {
    const deadline = Date.now() + seconds * 1000;

    while (Date.now() < deadline) {
      if (check()) {
        return true;
      }

      yield* Effect.sleep(Duration.millis(250));
    }

    return check();
  });

/** The rows, and the second process each one's group must have before it is judged. */
const ROWS: readonly { readonly row: Row; readonly name: string; readonly second: RegExp | null }[] = [
  { row: { name: "codex", access: "read" }, name: "codex", second: /codex\.js app-server/ },
  { row: "claude", name: "claude", second: null },
];

const TIME = 180_000;

describe.skipIf(!enabled)(
  "L7: on a real Mac, every helper an adapter starts on the Electron binary runs as Node",
  () => {
    for (const { row, name, second } of ROWS) {
      it(
        `${name}: its group has the switch on every Electron process, no Electron Helper, and no app LaunchServices lists`,
        async () => {
          const { folder, parent } = place();
          const h = asTheHost(row, folder, parent);
          const seen = await Effect.runPromise(
            Effect.gen(function* () {
              const c = yield* connect(h, folder, () => {}).pipe(Effect.timeout(Duration.seconds(60)));
              const ready =
                second === null ? true : yield* waitFor(() => groupOf(c.pid).some((p) => second.test(p.line)), 30);
              // An app's helpers start a moment after it boots: look a few times over three seconds.
              const faults = new Set<string>();

              for (let i = 0; i < 10; i += 1) {
                for (const fault of faultsOf(c.pid, h.command)) {
                  faults.add(fault);
                }

                yield* Effect.sleep(Duration.millis(300));
              }

              return { ready, faults: [...faults], group: shown(c.pid) };
              // The scope closes here: the spawner ends the group it spawned.
            }).pipe(Effect.scoped, Effect.provide(nodeServices)),
          );
          console.log(`${name}'s group:\n${seen.group.join("\n")}`);
          expect(seen.ready, `${name}'s adapter started its second process`).toBe(true);
          expect(seen.faults).toEqual([]);
        },
        TIME,
      );
    }
  },
);

/** One JSON-RPC line, as a client writes it: ACP's `initialize`. */
const INITIALIZE = `${JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: 1, clientCapabilities: {} },
})}\n`;

/** Start `h` as `connect` does, detached, but with a handle this test lets go of: no scope kills it. */
const startLoose = (h: Harness, folder: string): ChildProcess =>
  spawn(h.command, [...h.args], { cwd: folder, env: { ...h.env }, detached: true, stdio: ["pipe", "pipe", "pipe"] });

describe.skipIf(!enabled)("L8: on a real Mac, a host that dies hard leaves no helper", () => {
  for (const { row, name, second } of ROWS) {
    it(
      `${name}: closing only its stdin ends every process of its group within 15 s`,
      async () => {
        const { folder, parent } = place();
        const h = asTheHost(row, folder, parent);
        const child = startLoose(h, folder);
        const pgid = child.pid!;
        const answered = new Promise<boolean>((resolve) => {
          child.stdout!.once("data", () => resolve(true));
          setTimeout(() => resolve(false), 60_000);
        });
        child.stdin!.write(INITIALIZE);
        const left = await Effect.runPromise(
          Effect.gen(function* () {
            const up = yield* Effect.promise(() => answered);
            const ready =
              second === null ? true : yield* waitFor(() => groupOf(pgid).some((p) => second.test(p.line)), 30);
            // The host is gone: its end of each pipe closes, and no signal is sent.
            child.stdin!.end();
            child.stdout!.destroy();
            child.stderr!.destroy();
            child.unref();
            yield* waitFor(() => groupOf(pgid).length === 0, 15);
            return { up, ready, left: shown(pgid) };
          }),
        );
        expect(left.up, `${name}'s adapter answered initialize`).toBe(true);
        expect(left.ready, `${name}'s adapter started its second process`).toBe(true);
        expect(left.left, "processes of the group still running 15 s after stdin closed").toEqual([]);
      },
      TIME,
    );

    it(
      `${name}: closing its scope, as dismiss does, ends every process of its group within 4 s`,
      async () => {
        const { folder, parent } = place();
        const h = asTheHost(row, folder, parent);
        const seen = await Effect.runPromise(
          Effect.gen(function* () {
            const scope = yield* Scope.make();
            // However this ends, the scope closes, so the spawner ends what it spawned.
            return yield* Effect.gen(function* () {
              const c = yield* connect(h, folder, () => {}).pipe(
                Scope.provide(scope),
                Effect.timeout(Duration.seconds(60)),
              );
              const ready =
                second === null ? true : yield* waitFor(() => groupOf(c.pid).some((p) => second.test(p.line)), 30);
              yield* Scope.close(scope, Exit.void);
              yield* waitFor(() => groupOf(c.pid).length === 0, 4);
              return { ready, left: shown(c.pid) };
            }).pipe(Effect.ensuring(Scope.close(scope, Exit.void)));
          }).pipe(Effect.provide(nodeServices)),
        );
        expect(seen.ready, `${name}'s adapter started its second process`).toBe(true);
        expect(seen.left, "processes of the group still running 4 s after its scope closed").toEqual([]);
      },
      TIME,
    );
  }
});
