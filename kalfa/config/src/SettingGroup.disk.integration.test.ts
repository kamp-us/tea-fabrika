// Ticket 1843, slice 3, kalfa/config (new work): R2 of the approved plan (.kalfa/quests/kalfa-config-edit-PLAN.md). The laws
// of SettingGroup.disk.test.ts run on the writable in-memory file system in MemoryFiles.test-support.ts, so this one checks
// that stand-in against a real temp folder through NodeServices: the same five disk calls must leave the same files, links
// and folders and give the same answer on both, and each must leave what the call is meant to leave. It writes to a temp
// folder, so it is an integration law and runs in main's full run, never narrowly on the laptop. No stand-in will do: its one
// job is to check the stand-in against the real disk.
//
// The five cases: a set into a missing `.demo/` folder, a set that keeps a comment, a set through a linked user file, a held
// lock, and a set that changes nothing. The expected files come from the in-memory edit's own text, so the law holds the
// disk's work and not the edit's wording.
//
// scenario: five cases on a temp folder, then the same five in memory (the reason label `fabrika/law-shape` takes for a
// check of a stand-in against the real thing). Plant, run once and never kept: take the lock with a plain write, not the
// `"wx"` flag (in internal/disk.ts): the held-lock case writes on the real disk and gives no error, red.
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import * as MemoryFiles from "./MemoryFiles.test-support.ts";
import { CASES, pureText, runCase } from "./SettingGroup.disk.test-support.ts";

it.effect(
  "R2 scenario: on a real temp folder, five disk calls leave the files, links and answers they leave in memory",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      for (const c of CASES) {
        const temp = yield* fs.makeTempDirectoryScoped({ prefix: "kalfa-config-disk-" });
        // A program that follows links names the real folder, which is not the temp folder's own name on every disk.
        const root = yield* fs.realPath(temp);
        const real = yield* runCase(c, root);
        const memory = yield* runCase(c, "/r2").pipe(Effect.provide(MemoryFiles.writable().layer));
        const wanted = c.leaves(yield* pureText(c));

        expect(real.left, `${c.name}: the temp folder`).toEqual(wanted);
        expect(real.answer.reason, `${c.name}: the temp folder's answer`).toBe(c.fails ?? "done");
        expect(memory.left, `${c.name}: in memory`).toEqual(wanted);
        expect(memory.answer.reason, `${c.name}: the answer in memory`).toBe(c.fails ?? "done");
        expect(memory, `${c.name}: memory against the disk`).toEqual(real);
      }
    }).pipe(Effect.provide(NodeServices.layer)),
);
