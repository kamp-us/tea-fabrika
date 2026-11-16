// P12, next/. Unit checks own the outbox and memory sampling. Child cleanup uses the real dev.ts.
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it, afterEach } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";
import { ChildProcess } from "effect/process";
import { type Child, start } from "./dev-child.test-support.ts";
import { heldPort } from "./port.test-support.ts";
import { tree as descendants } from "./workerd.test-support.ts";

// The real disk and paths, through Effect's FileSystem and Path.
const disk = await Effect.runPromise(FileSystem.FileSystem.pipe(Effect.provide(NodeServices.layer)));

const { join, resolve } = Effect.runSync(Path.Path.pipe(Effect.provide(Path.layer)));

const homes: Array<string> = [];

const children: Array<Child> = [];

const groups: Array<number> = [];

const ports: Array<Effect.Effect<void>> = [];

const home = async () => {
  const h = await Effect.runPromise(disk.makeTempDirectory({ prefix: "p12-l-" }));
  homes.push(h);

  return h;
};

/** `parent` and every process below it, read from the real `ps` now. */
const tree = (parent: number) => Effect.runPromise(descendants(parent));

/** Whether a started child still runs, asked now. */
const running = (child: Child) => Effect.runPromise(child.running);

const pause = () => new Promise<void>((done) => setTimeout(done, 25));

const living = (pid: number) => {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
};

afterEach(async () => {
  // A child that already ended is only waited for; a running one gets SIGTERM first.
  for (const child of children.splice(0)) {
    await Effect.runPromise(child.stop);
  }

  for (const pid of groups.splice(0)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      /* Already stopped. */
    }
  }

  for (const h of homes.splice(0)) {
    await Effect.runPromise(disk.remove(h, { recursive: true, force: true }));
  }

  // Last, so the pair stays held until the instance that used its port is gone.
  for (const release of ports.splice(0)) {
    await Effect.runPromise(release);
  }
});

const launch = async (startupGate = false) => {
  const folder = await home();
  const at = await Effect.runPromise(heldPort());
  ports.push(at.release);
  const env: Record<string, string | undefined> = { ...process.env, FABRIKA_HOME: folder, DO_NOT_TRACK: "1" };
  delete env.TYPESAFE_API_KEY;
  delete env.FABRIKA_FOREGROUND;
  delete env.CLOUDFLARE_API_TOKEN;

  if (startupGate) {
    const preload = join(folder, "startup.mjs");
    // Delay only the detached child. Kill its parent before startup can finish.
    // This is a test-only Node import, not a product startup flag.
    await Effect.runPromise(
      disk.writeFileString(
        preload,
        `import {existsSync,writeFileSync} from "node:fs"; if (process.argv.includes("--child")) {writeFileSync(${JSON.stringify(join(folder, "starting"))}, String(process.pid)); while (!existsSync(${JSON.stringify(join(folder, "startup-release"))})) await new Promise(done => setTimeout(done, 25));}`,
      ),
    );
    env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --import=${preload}`;
  }

  const key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  let output = "";

  // Detached, as before: dev.ts leads a process group of its own.
  const child = await Effect.runPromise(
    start(
      ChildProcess.make(
        process.execPath,
        [
          resolve(import.meta.dirname, "../dev.ts"),
          "--port",
          String(at.port),
          "--name",
          "p12-life",
          "--person",
          "person_01m6v5270hf3c8x2q7w9z4k5mn",
          "--founder",
          key,
          "--window",
          "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        ],
        { env, extendEnv: false, detached: true, stdin: "ignore" },
      ),
      (text) => {
        output += text;
      },
    ),
  );

  children.push(child);
  groups.push(child.pid);
  const url = `http://127.0.0.1:${at.port}`;
  const observed: Array<{ at: number; pids: number[]; ready: boolean }> = [];

  if (startupGate) {
    while (!(await Effect.runPromise(disk.exists(join(folder, "starting"))))) {
      if (!(await running(child))) {
        throw new Error("instance ended before startup gate");
      }

      await pause();
    }

    return { child, folder, url, output: () => output, observed };
  }

  // Wait for the instance's own ready line, not for the first HTTP answer. workerd answers HTTP
  // while the instance still makes its startup calls, and a kill in that gap fails the startup.
  while (!output.includes('{"ready":')) {
    if (!(await running(child))) {
      throw new Error(`P12 dev.ts did not start: ${output}`);
    }

    await pause();
  }

  return { child, folder, url, output: () => output, observed };
};

/** Sends `signal` to dev.ts alone, never its group, and waits until it has ended. */
const signalNode = async (child: Child, signal: NodeJS.Signals) => {
  process.kill(child.pid, signal);

  while (await running(child)) {
    await pause();
  }
};

const workerd = async (instance: Awaited<ReturnType<typeof launch>>, excluding = 0) => {
  const until = performance.now() + 10_000;

  const details = () =>
    `excluding=${excluding}, observed=${JSON.stringify(instance.observed)}\ninstance output:\n${instance.output()}`;

  const { brainOutbox } = await import("@kampus/libfabrika/node/local-dev");
  const outbox = await Effect.runPromise(brainOutbox(instance.folder).pipe(Effect.provide(NodeServices.layer)));

  for (;;) {
    const pending = await Effect.runPromise(outbox.pending.pipe(Effect.provide(NodeServices.layer)));
    const stopped = pending.find((event) => event._tag === "braked");

    if (stopped !== undefined) {
      throw new Error(`P12 workerd unavailable: ${stopped._tag} (${stopped.reason})\n${details()}`);
    }

    if (!(await running(instance.child))) {
      throw new Error(`P12 dev.ts exited while waiting for workerd\n${details()}`);
    }

    if (performance.now() >= until) {
      throw new Error(`P12 workerd did not become ready within 10 seconds\n${details()}`);
    }

    const children = (await tree(instance.child.pid)).filter((r) => /\/workerd(?:\s|$)/.test(r.command));
    const observation = { at: performance.now(), pids: children.map((row) => row.pid), ready: false };
    instance.observed.push(observation);

    if (children.length === 0 || children[0]!.pid === excluding) {
      await pause();
      continue;
    }

    expect(children, details()).toHaveLength(1);

    // Alchemy retries SystemError spawns. A PID in ps may die before it ever listens.
    // Accept it only after HTTP answers and a fresh ps still shows that sole PID.
    try {
      const response = await fetch(instance.url, { signal: AbortSignal.timeout(250) });
      observation.ready = response.ok;
      await response.body?.cancel();
    } catch {
      /* Spawn attempt has not reached its listener. */
    }

    const current = (await tree(instance.child.pid)).filter((r) => /\/workerd(?:\s|$)/.test(r.command));

    if (observation.ready && current.length === 1 && current[0]!.pid === children[0]!.pid) {
      return children[0]!.pid;
    }

    await pause();
  }
};

describe("P12 local brain life", () => {
  // Outside only: real dev.ts, process groups and TCP. This sandbox cannot bind sockets.
  it("scenario: parent death before listener readiness leaves no instance group", async () => {
    const s = await launch(true);
    const leader = Number(await Effect.runPromise(disk.readFileString(join(s.folder, "starting"))));
    groups.push(leader);
    expect(living(leader)).toBe(true);
    await expect(fetch(s.url)).rejects.toThrow();
    await signalNode(s.child, "SIGKILL");
    await Effect.runPromise(disk.writeFileString(join(s.folder, "startup-release"), ""));
    const until = performance.now() + 10_000;

    while (living(leader) && performance.now() < until) {
      await pause();
    }

    expect(living(leader), "the detached child must notice its original parent died during startup").toBe(false);
    expect((await tree(leader)).filter((row) => living(row.pid))).toEqual([]);
    await expect(fetch(s.url)).rejects.toThrow();
  });
  // Outside only: cleanup must address the process group after its leader already exited.
  it("scenario: instance group cleanup still reaches descendants after the leader exits", async () => {
    const s = await launch();

    const rows = await tree(s.child.pid),
      leader = rows.find((row) => row.parent === s.child.pid && row.command.includes("--child"));

    expect(leader).toBeDefined();
    groups.push(leader!.pid);

    const below = (await tree(leader!.pid)).filter((row) => row.pid !== leader!.pid).map((row) => row.pid);

    expect(below.length).toBeGreaterThan(0);
    process.kill(leader!.pid, "SIGKILL");
    const until = performance.now() + 5_000;

    while (below.some(living) && performance.now() < until) {
      await pause();
    }

    expect(below.filter(living)).toEqual([]);
    await expect(fetch(s.url)).rejects.toThrow();
  });
  it("scenario: p81 plant: an outer retry loop defeats Alchemy's three-replacement brake", async () => {
    const s = await launch();
    let prior = 0;
    const pids: Array<number> = [];
    const delays: Array<number> = [];

    const details = () =>
      `pids=${JSON.stringify(pids)}, delays=${JSON.stringify(delays)}, observed=${JSON.stringify(s.observed)}\ninstance output:\n${s.output()}`;

    try {
      for (let n = 0; n < 4; n++) {
        const pid = await workerd(s, prior);
        pids.push(pid);
        const began = performance.now();
        process.kill(pid, "SIGKILL");

        if (n < 3) {
          prior = await workerd(s, pid);
          delays.push(performance.now() - began);
          prior = pid;
        }
      }

      expect(new Set(pids).size, details()).toBe(4);

      // Installed compatibility policy, not a new fabrika default.
      for (const [n, ms] of delays.entries()) {
        expect(ms, details()).toBeGreaterThanOrEqual(250 * 2 ** n);
      }

      await pause();
      expect(
        (await tree(s.child.pid)).filter((r) => /\/workerd(?:\s|$)/.test(r.command)),
        details(),
      ).toEqual([]);
      const { brainOutbox } = await import("@kampus/libfabrika/node/local-dev");

      const read = () =>
        Effect.runPromise(
          Effect.flatMap(brainOutbox(s.folder), (o) => o.pending).pipe(Effect.provide(NodeServices.layer)),
        );

      // The instance writes `braked` after Alchemy stops, with a synced file write. Wait for
      // that row, as `workerd` waits for a pid, and do not read the outbox once and hope.
      const until = performance.now() + 10_000;
      let pending = await read();

      while (!pending.some((event) => event._tag === "braked") && performance.now() < until) {
        await pause();
        pending = await read();
      }

      expect(pending, details()).toEqual(expect.arrayContaining([expect.objectContaining({ _tag: "braked" })]));
      // Wait past every installed backoff. No new child or outer HTTP restart is allowed.
      await new Promise<void>((done) => setTimeout(done, 2000));
      expect(
        (await tree(s.child.pid)).filter((r) => /\/workerd(?:\s|$)/.test(r.command)),
        details(),
      ).toEqual([]);
    } catch (cause) {
      throw new Error(`P12 replacement/brake failure\n${details()}`, { cause });
    }
  });
  it.each(["SIGTERM", "SIGKILL"] as const)(
    "scenario: group cleanup plant: killing only Node leaves a listener after %s",
    async (signal) => {
      const s = await launch();
      await workerd(s);
      const below = (await tree(s.child.pid)).map((r) => r.pid);
      // Node alone gets the signal, as a person's kill of the dev command does.
      process.kill(s.child.pid, signal);

      for (;;) {
        if (below.every((pid) => !living(pid))) {
          break;
        }

        await pause();
      }

      await expect(fetch(s.url)).rejects.toThrow();
      await new Promise<void>((done) => setTimeout(done, 1100));
      expect(below.filter(living)).toEqual([]);
    },
  );
});
