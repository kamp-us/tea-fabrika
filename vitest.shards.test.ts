import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { depth } from "@kampus/vitest";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { configDefaults } from "vitest/config";
import { BaseSequencer, createVitest } from "vitest/node";
import { E2E_SETUP, room } from "./.github/ci/legs.ts";
import { nextFiles, visualFiles } from "./.github/ci/shard-rows.ts";
import { e2eLegs, nextMinutes, vitestLegs } from "./.github/ci/workflow-lint.ts";
import { projects } from "./vitest.config.ts";
import {
  assign,
  full,
  inLaneStep,
  measured,
  median,
  restLoads,
  rowsAt,
  Shards,
  wall,
  WORKERS,
} from "./vitest.shards.ts";

/** A file's row, or undefined when the table has none, as `Shards` reads it. */
const rowOf = (path: string): number | undefined => (Object.hasOwn(measured, path) ? measured[path] : undefined);

/** `Shards` over `rows` in place of the rows of this run's depth, so a law can name the depth it is about. */
const shardsOver = (rows: Readonly<Record<string, number>>) =>
  class extends Shards {
    override readonly rows = rows;
  };

/** What a file with no row counts as in `assign` by default: the median of every row. */
const noRow = median(Object.values(measured));

/** A row from its samples: the median of three, or the larger of the one or two in hand. */
const row = (samples: readonly number[]): number =>
  samples.length === 3 ? samples.toSorted((a, b) => a - b)[1]! : Math.max(...samples);

it("vector: L5 known next timings are the median of three runs, or the larger of those in hand", () => {
  // Today's CI. The seven heaviest next/ files by row, all integration files, with their samples
  // in run order A, B, C: attempt 1 of run 43544589151 (push to main), 43551626086 (merge queue
  // group) and 43556494864 (push to main). RunnerAdmission has one sample: only run C held it.
  // RepositoriesGit.test.ts left the seven when the rows were refreshed after PR 1278: its 379.3 s
  // came from real git, and on memory git its two parts take 28.0 and 31.9 s (nextSamples).
  // The complete observations and job IDs are in integrationSamples and nextSamples below.
  // L5. Plants, each run once on a copy of the table filled from these samples, and restored: drop
  // the StartChild row (red here and in the all-rows vector); set chaos.laws to 1.0 (red in the
  // all-rows vector).
  for (const [path, samples] of [
    ["next/packages/libfabrika/src/node/Watchers.integration.test.ts", [217.6]],
    ["next/packages/libfabrika/src/node/StartChild.integration.test.ts", [262.9]],
    ["next/packages/libfabrika/src/node/RunnerAdmission.integration.test.ts", [258.9]],
    ["next/apps/fabrika/src/start-child.laws.integration.test.ts", [175.9, 108.2, 190.2]],
    ["next/apps/fabrika/src/door.integration.test.ts", [177.7, 117.3, 174.9]],
    ["next/packages/libfabrika/src/node/ProgramMailRuntime.integration.test.ts", [266.1, 169.1, 168.8]],
    ["next/apps/fabrika/src/instance-wire.integration.test.ts", [145.4, 151.9, 155.0]],
  ] as const) {
    expect(integrationSamples[path], path).toEqual(samples);
    expect.soft(measured[path], path).toBe(row(samples));
  }
});

it("scenario: L6 the five measured heaviest next files occupy the five vitest machines with bounded loads", async () => {
  // Today's CI: the real table, the real file set and the workflow's own count of vitest machines,
  // since the law is about today's split. The names are the five heaviest by the rows of runs
  // 43544589151, 43551626086 and 43556494864, all integration files once RepositoriesGit's row was
  // refreshed from memory git. The sixth heaviest shares a machine with the fifth.
  // Keep these names independent of the table so an accidentally tiny row cannot hide the file.
  // Plants, each run once on a copy of the table filled from integrationSamples, and restored: set the
  // Watchers row to 1.0, so it lands beside another of the five (red); add a leg "6" to the
  // workflow's next matrix, so the count no longer matches the five names (red).
  const heaviest = [
    "next/packages/libfabrika/src/node/Watchers.integration.test.ts",
    "next/packages/libfabrika/src/node/StartChild.integration.test.ts",
    "next/packages/libfabrika/src/node/RunnerAdmission.integration.test.ts",
    "next/packages/libfabrika/src/node/StartChildBoundary.integration.test.ts",
    "next/apps/fabrika/src/start-child.laws.integration.test.ts",
  ];
  const machines = vitestLegs(readFileSync(join(import.meta.dirname, ".github/workflows/check.yaml"), "utf8")).length;
  expect(machines).toBe(heaviest.length);
  const files = (await nextFiles(import.meta.dirname)).map((path) => ({ path, seconds: rowOf(path) }));
  const placed = assign(files, machines);
  expect(new Set(heaviest.map((path) => placed[files.findIndex((file) => file.path === path)]))).toHaveLength(machines);
  const loads = Array.from({ length: machines }, (_, machine) =>
    files.reduce((sum, file, index) => sum + (placed[index] === machine ? (file.seconds ?? noRow) : 0), 0),
  );
  const mean = loads.reduce((sum, load) => sum + load, 0) / machines;
  expect(Math.max(...loads)).toBeLessThanOrEqual(mean + Math.max(...files.map((file) => file.seconds ?? noRow)));
});

// Today's CI, next/'s `next` project, the tests on the in-memory layers that the merge line runs
// (0536). Each file's samples in run order A, B, C, attempt 1 of each, all after PR 1278:
//   A: run 43656757141, a pull request run of PR 1202 at acb7ecc1a.
//   B: run 43657195723, a pull request run of PR 1281 at 3ff5ba1d6.
//   C: run 43657535864, a merge queue group of PR 1202 at bb299109b.
// A sample is the sum of the file's test times as the verbose reporter printed them in that
// run's job log, to one decimal. The job ids are kept because GitHub drops job logs after 90 days.
// All 157 files have three samples. A 158th, ArchiveCryptoFailure.test.ts, was deleted after
// these runs (ticket 996), and its samples went with it. Three files took over 60 s in these runs and were split
// after them, every law moved unchanged: runner-contract.test.ts, readers.laws.test.ts and
// RepositoriesGit.test.ts. Each part's sample is the sum of its own tests' times in the same log.
// This fixed snapshot copies the observations, never the measured table's computed weights.
const nextSamples = {
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/apps/fabrika/src/build.test.ts": [0.0, 0.0, 0.0],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/apps/fabrika/src/door-spans.test.ts": [11.5, 10.1, 12.6],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/apps/fabrika/src/error-cause.test.ts": [0.1, 0.1, 0.1],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/apps/fabrika/src/exam/agent-may.test.ts": [4.0, 3.1, 3.5],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/apps/fabrika/src/exam/agents.test.ts": [10.1, 9.5, 12.8],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/apps/fabrika/src/exam/alchemy-lifecycle.test.ts": [10.9, 10.9, 10.9],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/apps/fabrika/src/exam/commits.test.ts": [0.8, 0.7, 0.8],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  // Measured at its old path, next/apps/fabrika/src/exam/compiler.test.ts; 0591 moved it.
  "next/packages/libfabrika/src/node/build/compiler.test.ts": [0.0, 0.0, 0.0],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/apps/fabrika/src/exam/node-kinds.test.ts": [0.1, 0.1, 0.1],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/apps/fabrika/src/exam/ratchet.test.ts": [0.1, 0.1, 0.1],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/apps/fabrika/src/exam/runner-contract-replay.test.ts": [40.5, 30.9, 42.1],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/apps/fabrika/src/exam/runner-contract.test.ts": [43.3, 33.6, 46.0],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/apps/fabrika/src/grant-readers.laws.test.ts": [1.3, 1.2, 1.5],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/apps/fabrika/src/instance-watch.laws.test.ts": [0.4, 0.4, 0.4],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/apps/fabrika/src/runtime.decode.test.ts": [0.2, 0.2, 0.2],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/apps/fabrika/src/settings-generated.test.ts": [4.8, 4.0, 5.3],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/apps/fabrika/src/settings.test.ts": [0.1, 0.1, 0.1],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/Id.cause.test.ts": [0.1, 0.1, 0.1],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/Id.test.ts": [4.1, 3.8, 3.0],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/Id.types.test.ts": [0.0, 0.0, 0.0],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/Testing.test.ts": [0.0, 0.0, 0.1],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/access/Access.test.ts": [2.2, 1.6, 2.0],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/access/Access.types.test.ts": [0.0, 0.0, 0.0],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/access/AccessMachine.laws.test.ts": [2.5, 2.0, 2.6],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/access/ClientManager.types.test.ts": [0.0, 0.0, 0.0],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/access/Passkey.test.ts": [0.1, 0.1, 0.1],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/access/Text.test.ts": [0.1, 0.0, 0.1],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/ci/Ci.test.ts": [0.2, 0.2, 0.3],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/client/Start.types.test.ts": [0.0, 0.0, 0.0],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/client/WindowMachine.laws.test.ts": [18.8, 14.0, 21.2],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/client/WindowStart.laws.test.ts": [14.8, 12.6, 13.8],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/cloudflare/ObjectService.test.ts": [1.2, 1.0, 1.5],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/cloudflare/SettingsInput.test.ts": [1.3, 1.0, 1.3],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/cloudflare/SettingsRecorded.test.ts": [2.8, 2.5, 3.1],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/cloudflare/SettingsRuntime.test.ts": [0.2, 0.3, 0.2],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/cloudflare/SettingsStarts.test.ts": [27.0, 21.4, 28.7],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/cloudflare/Watchers.test.ts": [0.4, 0.4, 0.5],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/cloudflare/alarm.laws.test.ts": [1.0, 0.8, 1.1],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/cloudflare/connection.test.ts": [24.5, 17.3, 25.4],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/cloudflare/entry-flows.laws.test.ts": [38.8, 31.3, 35.3],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/cloudflare/error-cause.test.ts": [0.6, 0.5, 0.5],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/cloudflare/fetch.test.ts": [7.0, 6.8, 7.3],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/cloudflare/index.test.ts": [0.3, 0.3, 0.2],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/cloudflare/mail.test.ts": [0.5, 0.4, 0.5],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/cloudflare/p14.test.ts": [0.8, 0.7, 0.9],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/cloudflare/platform.test.ts": [0.7, 0.6, 0.8],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/cloudflare/reach.laws.test.ts": [0.2, 0.2, 0.2],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/cloudflare/readers.laws.test.ts": [20.3, 19.2, 21.4],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/cloudflare/runner-reply.laws.test.ts": [12.6, 8.6, 13.0],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/cloudflare/tail.test.ts": [0.2, 0.2, 0.2],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/codehost/CodeHost.test.ts": [0.4, 0.3, 0.3],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/desktop/BrainLife.laws.test.ts": [8.0, 6.3, 6.0],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/desktop/BrainService.types.test.ts": [0.0, 0.0, 0.0],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/desktop/BrainServiceManaged.laws.test.ts": [3.4, 2.9, 3.2],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/desktop/Menu.laws.test.ts": [1.6, 1.4, 1.4],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/desktop/Menu.types.test.ts": [0.0, 0.0, 0.0],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/gateway/Gateway.types.test.ts": [0.0, 0.0, 0.0],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/gateway/TaskAccess.test.ts": [0.1, 0.1, 0.1],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/gateway/internal/rateLimit.test.ts": [0.2, 0.1, 0.2],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/gateway/internal/waiting.test.ts": [2.9, 2.3, 2.4],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/tasks/Task.test.ts": [9.2, 7.2, 9.4],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/tasks/Tasks.types.test.ts": [0.0, 0.0, 0.0],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/tasks/internal/task.test.ts": [31.6, 23.7, 37.2],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/ledger/Ledger.types.test.ts": [0.0, 0.0, 0.0],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/ledger/LedgerCallSpans.test.ts": [0.6, 0.4, 0.5],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/ledger/LedgerStreams.types.test.ts": [0.0, 0.0, 0.0],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/ledger/LedgerTransaction.test.ts": [0.4, 0.3, 0.5],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/ledger/LedgerTurnReads.test.ts": [1.5, 1.6, 2.2],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/ledger/TraceId.test.ts": [0.8, 0.6, 0.6],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/node/Chaos.laws.test.ts": [0.1, 0.1, 0.1],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/node/ErrorCause.test.ts": [4.0, 3.4, 4.4],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/node/ErrorCause.types.test.ts": [0.0, 0.0, 0.0],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/node/dev/DevLife.laws.test.ts": [0.1, 0.2, 0.1],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/node/dev/error-cause.test.ts": [0.2, 0.2, 0.2],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/node/launchd/LaunchdStatus.laws.test.ts": [0.2, 0.2, 0.2],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/node/launchd/ProcessGroups.laws.test.ts": [0.1, 0.0, 0.1],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/node/repositories/Git.test.ts": [0.0, 0.0, 0.0],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/node/repositories/OpenRepository.test.ts": [16.2, 13.0, 18.4],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/node/repositories/RepositoriesGit.identity.test.ts": [43.6, 25.6, 31.9],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/node/repositories/RepositoriesGit.test.ts": [34.6, 16.4, 28.0],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/node/repositories/Sources.test.ts": [20.4, 23.2, 27.9],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/node/settings/Command.test.ts": [0.8, 0.6, 0.9],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/packs/ProgramName.test.ts": [0.1, 0.1, 0.1],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/packs/internal/open.test.ts": [14.3, 9.4, 13.8],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/processes/ExitReason.test.ts": [0.3, 0.3, 0.2],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/processes/Mailbox.test.ts": [3.9, 3.5, 3.0],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/processes/MailboxHistory.test.ts": [0.5, 0.4, 0.5],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/processes/ProcessIdGenerator.test.ts": [1.0, 0.8, 0.9],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/processes/internal/processTable.laws.test.ts": [2.8, 1.9, 3.2],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/processes/internal/programMail.test.ts": [0.1, 0.1, 0.0],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/repositories/Repositories.types.test.ts": [0.0, 0.0, 0.0],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/runtime/Audit.test.ts": [1.8, 1.6, 2.2],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/runtime/BrainLife.laws.test.ts": [0.1, 0.1, 0.1],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/runtime/Built.test.ts": [1.4, 1.3, 1.7],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/runtime/Chaos.laws.test.ts": [0.1, 0.1, 0.1],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/runtime/Client.laws.test.ts": [0.7, 0.5, 0.5],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/runtime/EffectFunctions.test.ts": [12.9, 9.7, 14.0],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/runtime/Entry.test.ts": [0.0, 0.0, 0.0],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/runtime/ErrorCause.test.ts": [0.4, 0.3, 0.3],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/runtime/Execution.test.ts": [1.3, 1.1, 1.2],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/runtime/Gateway.laws.test.ts": [1.5, 1.2, 1.3],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/runtime/IsolateUsage.test.ts": [0.1, 0.1, 0.1],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/runtime/Patch.test.ts": [0.6, 0.5, 0.8],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/runtime/Program.test.ts": [1.2, 0.9, 1.0],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/runtime/Program.types.test.ts": [0.1, 0.1, 0.1],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/runtime/RunnerRecovery.laws.test.ts": [2.2, 1.7, 2.4],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/runtime/Runtime.types.test.ts": [0.0, 0.0, 0.0],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/runtime/State.test.ts": [0.1, 0.1, 0.1],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/runtime/internal/exitReason.test.ts": [0.0, 0.0, 0.0],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/runtime/internal/reply.test.ts": [0.2, 0.2, 0.2],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/runtime/internal/supervisor.laws.test.ts": [1.6, 1.1, 1.7],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/runtime/internal/watchers.test.ts": [35.4, 27.7, 39.6],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/schedules/ScheduledJob.test.ts": [0.5, 0.4, 0.4],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/settings/Codec.test.ts": [0.1, 0.1, 0.1],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/settings/DesktopBrain.test.ts": [0.3, 0.3, 0.3],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/settings/DesktopLink.test.ts": [0.3, 0.2, 0.3],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/settings/Files.test.ts": [0.4, 0.3, 0.5],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/settings/JsonSchema.test.ts": [0.4, 0.3, 0.5],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/settings/Print.test.ts": [0.2, 0.2, 0.2],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/settings/Reference.test.ts": [0.4, 0.4, 0.4],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/settings/Setting.test.ts": [0.3, 0.2, 0.4],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/settings/Snapshot.test.ts": [1.6, 1.2, 1.7],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/settings/Sources.test.ts": [0.1, 0.2, 0.2],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/settings/Start.test.ts": [0.2, 0.2, 0.2],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/settings/Toml.types.test.ts": [0.0, 0.0, 0.0],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/settings/TomlEdit.test.ts": [6.4, 5.6, 5.5],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/settings/TomlParser.test.ts": [0.2, 0.2, 0.2],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/telemetry/ErrorCause.test.ts": [0.2, 0.1, 0.2],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/telemetry/P12Readers.laws.test.ts": [0.3, 0.2, 0.3],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/telemetry/Trace.types.test.ts": [0.0, 0.0, 0.0],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/telemetry/internal/sink.test.ts": [0.5, 0.4, 0.5],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/telemetry/internal/sums.test.ts": [1.2, 1.2, 1.0],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/transport/Answer.test.ts": [0.2, 0.2, 0.2],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/transport/Connection.test.ts": [1.9, 1.4, 1.5],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/transport/ErrorCause.test.ts": [0.3, 0.2, 0.2],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/transport/Handshake.laws.test.ts": [0.8, 0.8, 0.8],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/transport/Hello.test.ts": [0.7, 0.6, 0.8],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/transport/Link.laws.test.ts": [0.2, 0.2, 0.1],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/transport/Sshsig.test.ts": [0.9, 0.7, 1.3],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/packages/libfabrika/src/transport/SshsigWebauthn.test.ts": [0.5, 0.5, 0.5],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/transport/internal/binaryCryptoFailure.test.ts": [0.0, 0.0, 0.0],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/packages/libfabrika/src/transport/internal/connection.test.ts": [2.3, 2.1, 3.5],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/programs/chaos/src/program.laws.test.ts": [2.1, 1.8, 1.6],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/programs/checklist/src/client.laws.test.ts": [0.2, 0.2, 0.3],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/programs/checklist/src/program.laws.test.ts": [0.2, 0.3, 0.3],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/programs/checklist/src/tile.laws.test.ts": [0.2, 0.2, 0.1],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/programs/checklist/src/window.laws.test.ts": [1.0, 0.8, 1.1],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/programs/checklist/src/window.types.test.ts": [0.0, 0.0, 0.0],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/programs/counter/src/program.laws.test.ts": [0.2, 0.3, 0.2],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/programs/counter/src/window.types.test.ts": [0.0, 0.0, 0.0],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/programs/inbox/src/program.laws.test.ts": [0.2, 0.1, 0.2],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/programs/pipeline/src/Change.test.ts": [0.6, 0.4, 0.6],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/programs/pipeline/src/Merger.laws.test.ts": [4.3, 3.0, 4.6],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/programs/pipeline/src/Queue.laws.test.ts": [11.9, 9.8, 14.0],
  // A job 132637025443, B job 132638385672, C job 132639432685.
  "next/programs/pipeline/src/Settings.test.ts": [0.4, 0.3, 0.4],
  // A job 132637025465, B job 132638385663, C job 132639432580.
  "next/programs/pipeline/src/handlers.test.ts": [0.1, 0.1, 0.1],
} as const;

// Today's CI, next/'s `next-integration` project, the tests on a real resource that the 3-hour
// schedule runs (0536). Each file's samples in run order A, B, C, attempt 1 of each, from before
// 0536, when one project ran them all:
//   A: run 43544589151, a push to main at 1e712b328.
//   B: run 43551626086, a merge queue group at 1d3061a5c.
//   C: run 43556494864, a push to main at 48460bdaa.
// A sample is the sum of the file's test times as the verbose reporter printed them in that
// run's job log, to one decimal. The job ids are kept because GitHub drops job logs after 90 days.
// Of the 116 files, 109 have three samples, 1 has two and 6 have one: a file a run did not hold
// has no sample from it. Two more, chaos-revoke and stored under e2e/, take their rows from
// e2eSamples below; the six others with no samples have no row, and count the median.
// This fixed snapshot copies the observations, never the measured table's computed weights.
const integrationSamples = {
  // A job 132292933169, B job 132315559486, C job 132330501025.
  "next/apps/fabrika/src/brain-life.integration.test.ts": [26.5, 25.5, 44.2],
  // A job 132292933221, B job 132315559497, C job 132330501014.
  "next/apps/fabrika/src/build-command.integration.test.ts": [2.2, 1.3, 2.3],
  // A job 132292933270, B job 132315559508, C job 132330501001.
  "next/apps/fabrika/src/build.integration.test.ts": [38.9, 41.6, 162.5],
  // A job 132292933270, B job 132315559508, C job 132330501001.
  "next/apps/fabrika/src/chaos.laws.integration.test.ts": [69.0, 80.8, 79.9],
  // C job 132330501025.
  "next/apps/fabrika/src/checklist-instance.laws.integration.test.ts": [98.0],
  // A job 132292933169, B job 132315559486, C job 132330500993.
  "next/apps/fabrika/src/checklist-runner.laws.integration.test.ts": [20.7, 18.5, 22.7],
  // A job 132292933221, B job 132315559497, C job 132330501014.
  "next/apps/fabrika/src/door-recovery.integration.test.ts": [23.2, 14.8, 20.9],
  // A job 132292933221, B job 132315559497, C job 132330501014.
  "next/apps/fabrika/src/door.integration.test.ts": [177.7, 117.3, 174.9],
  // A job 132292933270, B job 132315559508, C job 132330501001.
  "next/apps/fabrika/src/exam/bytes.integration.test.ts": [6.0, 6.4, 7.0],
  // A job 132292933270, B job 132315559508, C job 132330501025.
  "next/apps/fabrika/src/exam/client-manager-contract.integration.test.ts": [13.9, 10.6, 15.9],
  // A job 132292933192, B job 132315559467, C job 132330500983.
  "next/apps/fabrika/src/exam/commits-git-chain.integration.test.ts": [77.1, 47.4, 61.7],
  // A job 132292933169, B job 132315559486, C job 132330501025.
  "next/apps/fabrika/src/exam/commits-git-person.integration.test.ts": [49.8, 41.9, 77.7],
  // A job 132292933192, B job 132315559467, C job 132330500983.
  "next/apps/fabrika/src/exam/commits-git-signatures.integration.test.ts": [70.1, 43.1, 63.8],
  // A job 132292933169, B job 132315559486, C job 132330501025.
  "next/apps/fabrika/src/exam/commits-git-steps.integration.test.ts": [73.4, 72.7, 101.1],
  // A job 132292933192, B job 132315559467, C job 132330500983.
  "next/apps/fabrika/src/exam/deps.integration.test.ts": [6.5, 4.1, 4.1],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/apps/fabrika/src/exam/edges.integration.test.ts": [2.8, 2.9, 4.2],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/apps/fabrika/src/exam/laws-scan.integration.test.ts": [0.0, 0.0, 0.0],
  // A job 132292933270, B job 132315559508, C job 132330501001.
  "next/apps/fabrika/src/exam/secret-types.integration.test.ts": [5.1, 5.3, 5.4],
  // A job 132292933221, B job 132315559497, C job 132330501014.
  "next/apps/fabrika/src/exam/twin.integration.test.ts": [24.0, 16.0, 20.9],
  // A job 132292933169, B job 132315559497, C job 132330501014.
  "next/apps/fabrika/src/file-services.laws.integration.test.ts": [4.0, 4.4, 19.0],
  // A job 132292933221, B job 132315559497, C job 132330500983.
  "next/apps/fabrika/src/inbox-runner.laws.integration.test.ts": [7.3, 4.2, 9.2],
  // C job 132330501001.
  "next/apps/fabrika/src/input-recording.integration.test.ts": [39.4],
  // A job 132292933192, B job 132315559467, C job 132330501025.
  "next/apps/fabrika/src/instance-one-file.integration.test.ts": [25.7, 20.9, 34.9],
  // A job 132292933192, B job 132315559467, C job 132330500983.
  "next/apps/fabrika/src/instance-records.integration.test.ts": [53.7, 42.1, 63.9],
  // A job 132292933270, B job 132315559508, C job 132330501001.
  "next/apps/fabrika/src/instance-wire.integration.test.ts": [145.4, 151.9, 155.0],
  // C job 132330501014.
  "next/apps/fabrika/src/tasks-wire.integration.test.ts": [3.7],
  // A job 132292933221, B job 132315559497, C job 132330501014.
  "next/apps/fabrika/src/local-instance.integration.test.ts": [2.6, 1.3, 1.5],
  // A job 132292933169, B job 132315559486, C job 132330500983.
  "next/apps/fabrika/src/port.integration.test.ts": [0.0, 0.0, 0.0],
  // A job 132292933326, B job 132315559534, C job 132330501001.
  "next/apps/fabrika/src/record.laws.integration.test.ts": [2.9, 1.9, 2.8],
  // A job 132292933221, B job 132315559497, C job 132330501025.
  "next/apps/fabrika/src/repository-open.integration.test.ts": [19.3, 15.0, 27.2],
  // A job 132292933169, B job 132315559508, C job 132330501001.
  "next/apps/fabrika/src/runtime-recovery.laws.integration.test.ts": [91.5, 96.7, 137.9],
  // A job 132292933169, B job 132315559486, C job 132330501025.
  "next/apps/fabrika/src/runtime.laws.integration.test.ts": [38.2, 48.4, 87.3],
  // A job 132292933270, B job 132315559508, C job 132330501014.
  "next/apps/fabrika/src/scheduled-job-alarm.integration.test.ts": [6.7, 6.8, 5.2],
  // A job 132292933326, B job 132315559534, C job 132330501001.
  "next/apps/fabrika/src/settings-start.integration.test.ts": [12.6, 11.4, 23.0],
  // A job 132292933221, B job 132315559497, C job 132330501025.
  "next/apps/fabrika/src/sibling.laws.integration.test.ts": [11.3, 7.4, 13.0],
  // A job 132292933192, B job 132315559467, C job 132330500993.
  "next/apps/fabrika/src/start-child.laws.integration.test.ts": [175.9, 108.2, 190.2],
  // A job 132292933192, B job 132315559467, C job 132330500983.
  "next/apps/fabrika/src/worker-mail.integration.test.ts": [30.6, 20.7, 42.8],
  // A job 132292933270, B job 132315559508, C job 132330501014.
  "next/apps/fabrika/src/worker-supervision.integration.test.ts": [22.2, 19.8, 27.1],
  // A job 132292933169, B job 132315559486, C job 132330500983.
  "next/apps/fabrika/src/worker-usage.integration.test.ts": [1.1, 1.1, 1.8],
  // A job 132292933169, B job 132315559486, C job 132330501025.
  "next/packages/libfabrika/src/access/AccessSpans.integration.test.ts": [3.4, 5.2, 3.8],
  // A job 132292933192, B job 132315559467, C job 132330500983.
  "next/packages/libfabrika/src/access/Authorization.integration.test.ts": [16.0, 16.4, 30.9],
  // A job 132292933270, B job 132315559508, C job 132330501001.
  "next/packages/libfabrika/src/access/ClientManager.integration.test.ts": [25.9, 16.8, 12.1],
  // A job 132292933192, B job 132315559467, C job 132330500983.
  "next/packages/libfabrika/src/cloudflare/supervision.laws.integration.test.ts": [29.3, 14.8, 27.0],
  // A job 132292933270, B job 132315559508, C job 132330501001.
  "next/packages/libfabrika/src/gateway/GatewayRevocation.integration.test.ts": [10.3, 10.4, 10.2],
  // A job 132292933192, B job 132315559467, C job 132330500983.
  "next/packages/libfabrika/src/ledger/Ledger.integration.test.ts": [3.2, 2.9, 4.6],
  // A job 132292933270, B job 132315559508, C job 132330501001.
  "next/packages/libfabrika/src/ledger/LedgerSpans.integration.test.ts": [2.4, 2.3, 1.3],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/packages/libfabrika/src/ledger/Log.integration.test.ts": [1.5, 1.4, 1.8],
  // A job 132292933270, B job 132315559486, C job 132330501025.
  "next/packages/libfabrika/src/ledger/Rings.integration.test.ts": [0.3, 0.1, 0.1],
  // A job 132292933326, B job 132315559508, C job 132330501025.
  "next/packages/libfabrika/src/node/Children.integration.test.ts": [81.9, 84.4, 111.2],
  // A job 132292933270, B job 132315559497, C job 132330500983.
  "next/packages/libfabrika/src/node/ExitReason.integration.test.ts": [37.4, 23.5, 41.9],
  // A job 132292933169, B job 132315559467, C job 132330501001.
  "next/packages/libfabrika/src/node/IsolateUsage.integration.test.ts": [54.5, 84.0, 62.4],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/packages/libfabrika/src/node/Nemesis.laws.integration.test.ts": [7.6, 7.3, 10.9],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/packages/libfabrika/src/node/ProgramMail.integration.test.ts": [31.7, 34.0, 37.8],
  // A job 132292933219, B job 132315559488, C job 132330501023.
  "next/packages/libfabrika/src/node/ProgramMailRuntime.integration.test.ts": [266.1, 169.1, 168.8],
  // A job 132292933326, B job 132315559508, C job 132330501025.
  "next/packages/libfabrika/src/node/RecordPart.integration.test.ts": [0.8, 1.1, 1.2],
  // A job 132292933221, B job 132315559486, C job 132330500993.
  "next/packages/libfabrika/src/node/RecordPartResources.integration.test.ts": [1.6, 0.9, 1.0],
  // A job 132292933192, B job 132315559534, C job 132330501014.
  "next/packages/libfabrika/src/node/RecoveryJournal.integration.test.ts": [63.8, 52.6, 42.3],
  // A job 132292933270, B job 132315559497, C job 132330500983.
  "next/packages/libfabrika/src/node/Replies.integration.test.ts": [84.4, 47.5, 70.8],
  // C job 132330501001.
  "next/packages/libfabrika/src/node/RunnerAdmission.integration.test.ts": [258.9],
  // Run 43728081584 attempt 1, job 132854293834: PR 1252 split StartChild in three files.
  "next/packages/libfabrika/src/node/StartChild.integration.test.ts": [262.9],
  // Job 132854293834.
  "next/packages/libfabrika/src/node/StartChildBoundary.integration.test.ts": [215.0],
  // Job 132854293830.
  "next/packages/libfabrika/src/node/StartChildExit.integration.test.ts": [95.0],
  // Run 43728081584 attempt 1, job 132854293826, after PR 1252 cut W3's fill.
  "next/packages/libfabrika/src/node/Watchers.integration.test.ts": [217.6],
  // A job 132292933192, B job 132315559467, C job 132330500983. Sampled at access/, before PR 1189
  // moved the file to node/access/.
  "next/packages/libfabrika/src/node/access/SessionManager.integration.test.ts": [8.0, 9.6, 14.7],
  // A job 132292933270, B job 132315559508, C job 132330501001.
  "next/packages/libfabrika/src/node/build/build-assets.integration.test.ts": [37.0, 34.1, 41.9],
  // A job 132292933169, B job 132315559486, C job 132330501025.
  "next/packages/libfabrika/src/node/build/build-one-file.integration.test.ts": [41.0, 44.8, 77.0],
  // A job 132292933221, B job 132315559486, C job 132330501014.
  "next/packages/libfabrika/src/node/build/css.integration.test.ts": [11.9, 13.3, 9.8],
  // A job 132292933192, B job 132315559534, C job 132330500983.
  "next/packages/libfabrika/src/node/build/error-cause.integration.test.ts": [0.4, 0.3, 0.3],
  // A job 132292933169, B job 132315559467, C job 132330501025.
  "next/packages/libfabrika/src/node/dev/dev-control.laws.integration.test.ts": [8.8, 10.4, 9.3],
  // A job 132292933221, B job 132315559497, C job 132330501014.
  "next/packages/libfabrika/src/node/dev/dev-errors.laws.integration.test.ts": [2.0, 0.9, 1.0],
  // A job 132292933169, B job 132315559508, C job 132330501001.
  "next/packages/libfabrika/src/node/dev/dev-recording.laws.integration.test.ts": [0.0, 0.1, 0.0],
  // A job 132292933221, B job 132315559497, C job 132330501014.
  "next/packages/libfabrika/src/node/dev/dev-secrets.laws.integration.test.ts": [4.3, 2.4, 3.5],
  // A job 132292933169, B job 132315559486, C job 132330501025.
  "next/packages/libfabrika/src/node/dev/dev.laws.integration.test.ts": [2.0, 2.1, 2.2],
  // A job 132292933192, B job 132315559467, C job 132330500983.
  "next/packages/libfabrika/src/node/dev/local-dev.integration.test.ts": [3.8, 2.2, 5.6],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/packages/libfabrika/src/node/dev/supervision-spans.integration.test.ts": [3.0, 3.2, 4.1],
  // C job 132330501014.
  "next/packages/libfabrika/src/node/gateway/Tasks.integration.test.ts": [147.5],
  // A job 132292933221, B job 132315559486, C job 132330500983.
  "next/packages/libfabrika/src/node/gateway/RateLimit.integration.test.ts": [5.8, 3.0, 6.2],
  // Run 43728081584 attempt 1, job 132854293834: the file PR 1252 split off JobsLedger.
  "next/packages/libfabrika/src/node/tasks/TasksDiscovery.integration.test.ts": [30.8],
  // A job 132292933192, B job 132315559534, C job 132330501001.
  "next/packages/libfabrika/src/node/tasks/TasksLedger.integration.test.ts": [39.2, 35.4, 99.9],
  // B job 132315559497, C job 132330501025.
  "next/packages/libfabrika/src/node/launchd/BrainControlLaunchd.laws.integration.test.ts": [30.5, 35.6],
  // C job 132330500983.
  "next/packages/libfabrika/src/node/ledger/LedgerStreams.integration.test.ts": [73.3],
  // A job 132292933326, B job 132315559497, C job 132330500993.
  "next/packages/libfabrika/src/node/repositories/RepositoryTrust.integration.test.ts": [15.4, 11.1, 18.6],
  // A job 132292933192, B job 132315559508, C job 132330500983.
  "next/packages/libfabrika/src/node/runtime/RunnerInit.integration.test.ts": [4.5, 3.4, 3.6],
  // A job 132292933169, B job 132315559534, C job 132330501025.
  "next/packages/libfabrika/src/node/settings/Load.integration.test.ts": [0.8, 1.2, 1.8],
  // A job 132292933270, B job 132315559508, C job 132330501001.
  "next/packages/libfabrika/src/presence/Connections.integration.test.ts": [0.7, 0.7, 0.7],
  // A job 132292933270, B job 132315559508, C job 132330501001.
  "next/packages/libfabrika/src/processes/ProcessLifecycle.integration.test.ts": [5.7, 4.6, 5.3],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/packages/libfabrika/src/processes/ProcessManager.integration.test.ts": [0.8, 0.7, 1.0],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/packages/libfabrika/src/processes/ProcessMonitors.integration.test.ts": [8.8, 7.6, 10.8],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/packages/libfabrika/src/processes/ProcessSpans.integration.test.ts": [2.0, 1.3, 1.5],
  // A job 132292933221, B job 132315559497, C job 132330501014.
  "next/packages/libfabrika/src/processes/ProcessStreams.integration.test.ts": [2.9, 1.8, 2.4],
  // A job 132292933169, B job 132315559486, C job 132330501025.
  "next/packages/libfabrika/src/processes/ProcessTextCaps.integration.test.ts": [2.3, 2.4, 4.3],
  // A job 132292933221, B job 132315559497, C job 132330501014.
  "next/packages/libfabrika/src/processes/ProcessWindow.integration.test.ts": [0.6, 0.4, 0.5],
  // A job 132292933270, B job 132315559508, C job 132330501001.
  "next/packages/libfabrika/src/runtime/ProcessStore.integration.test.ts": [2.4, 1.9, 2.3],
  // A job 132292933326, B job 132315559467, C job 132330500983.
  "next/packages/libfabrika/src/runtime/RecoveryGaps.integration.test.ts": [5.6, 4.9, 7.8],
  // A job 132292933270, B job 132315559486, C job 132330501025.
  "next/packages/libfabrika/src/runtime/RecoveryStore.integration.test.ts": [0.3, 0.3, 0.3],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/packages/libfabrika/src/runtime/Runner.integration.test.ts": [123.8, 116.9, 151.9],
  // A job 132292933326, B job 132315559497, C job 132330500983.
  "next/packages/libfabrika/src/runtime/RunnerOptions.integration.test.ts": [0.0, 0.0, 0.0],
  // A job 132292933221, B job 132315559497, C job 132330501014.
  "next/packages/libfabrika/src/runtime/RunnerSupervision.integration.test.ts": [77.0, 45.9, 62.5],
  // A job 132292933169, B job 132315559486, C job 132330501025.
  "next/packages/libfabrika/src/runtime/internal/recovery.integration.test.ts": [1.1, 1.2, 1.9],
  // A job 132292933270, B job 132315559467, C job 132330500983.
  "next/packages/libfabrika/src/telemetry/Records.integration.test.ts": [5.2, 3.2, 6.1],
  // A job 132292933192, B job 132315559486, C job 132330500983.
  "next/packages/libfabrika/src/telemetry/Sink.integration.test.ts": [10.7, 13.1, 19.1],
  // A job 132292933169, B job 132315559486, C job 132330501025.
  "next/packages/libfabrika/src/telemetry/internal/measurements.integration.test.ts": [10.5, 10.7, 6.3],
  // A job 132292933192, B job 132315559467, C job 132330500983.
  "next/packages/libfabrika/src/transport/Sshsig.integration.test.ts": [1.0, 0.5, 0.6],
  // A job 132292933221, B job 132315559486, C job 132330501025.
  "next/packages/libfabrika/src/transport/SshsigWebauthn.integration.test.ts": [0.6, 0.3, 0.6],
  // A job 132292933221, B job 132315559508, C job 132330501001.
  "next/programs/counter/src/runner.laws.integration.test.ts": [6.8, 5.1, 4.8],
  // A job 132292933270, B job 132315559534, C job 132330500993.
  "next/programs/pipeline/src/node/queue.laws.integration.test.ts": [148.4, 125.7, 119.0],
  // A job 132292933169, B job 132315559497, C job 132330501014.
  "next/programs/pipeline/src/node/runner.laws.integration.test.ts": [22.7, 21.8, 10.8],
} as const;

// T967, today's CI, next/'s end-to-end files. Each file's samples in run order A, B, C, attempt 1
// of each, all `next (e2e)` jobs from after PR 1104, when that one leg ran each file in its own
// Vitest:
//   A: run 43601966383, a push to main at 5bec9eca5, job 132468657925.
//   B: run 43601964962, a push to main at ba96004e4, job 132468687674.
//   C: run 43605298688, a green pull request run, job 132478645693.
// A sample is Vitest's printed `Duration` for that file's own run, to one decimal: the runner wrote
// no JSON report then. The job ids are kept because GitHub drops job logs after 90 days. The rows
// from before PR 1104 (runs 43597657318, 43594434801 and 43590628228) were 15 to 45% faster for
// first-window and resources.laws, with e2e after vitest on leg 1; they are not used.
// This fixed snapshot copies the observations, never the measured table's computed weights.
// 0536 renamed the files, the samples stay theirs: six are visual and run on the end-to-end legs;
// chaos-revoke and stored drive no browser, so they are integration files on the vitest legs now.
const E2E = "next/apps/fabrika/e2e";

const e2eSamples = {
  jobs: { A: 132468657925, B: 132468687674, C: 132478645693 },
  files: {
    [`${E2E}/chaos-revoke.integration.test.ts`]: [46.5, 50.0, 46.7],
    [`${E2E}/electron-launchd.visual.test.ts`]: [1.5, 1.1, 1.5],
    [`${E2E}/first-window.visual.test.ts`]: [222.2, 206.3, 225.4],
    [`${E2E}/instance.visual.test.ts`]: [23.7, 22.4, 23.9],
    [`${E2E}/one-file.visual.test.ts`]: [14.3, 14.7, 14.6],
    [`${E2E}/resources.laws.visual.test.ts`]: [366.6, 348.9, 373.3],
    [`${E2E}/stored.integration.test.ts`]: [1.2, 1.1, 1.3],
    "next/packages/tuval/src/browser/key.laws.visual.test.ts": [7.1, 5.8, 7.5],
  },
  // What a leg costs beside its files: the job's time minus the end-to-end step's, in A, B and C.
  overhead: [76.5, 69.8, 70.2],
} as const;

it("vector: L5 all 268 next rows, vitest and end-to-end, are the median of three samples, or the larger of one or two", () => {
  // The medians of runs 43656757141, 43657195723 and 43657535864 for the `next` project's files,
  // of 43544589151, 43551626086 and 43556494864 for the integration files, and of 43601966383,
  // 43601964962 and 43605298688 for the end-to-end files, from the samples above.
  // Preserve exact file-set coverage as well as the weights, including measured zeroes: a row
  // with no samples here, or samples with no row, fails too.
  // T967 (E5) widens it to the end-to-end rows. Plants, each run once with the 8 rows filled from
  // e2eSamples, and restored: drop the resources.laws row (red, here and in E5); set first-window to
  // 1.0 (red, here and in E5). Ticket 997, plants, each run once on vitest.shards.ts and restored:
  // RepositoriesGit.test.ts's row back at 379.3 (red); drop the entry-flows.laws row (red).
  const expected = Object.fromEntries(
    [...Object.entries(nextSamples), ...Object.entries(integrationSamples), ...Object.entries(e2eSamples.files)].map(
      ([path, samples]) => [path, row(samples)],
    ),
  );
  expect(Object.fromEntries(Object.entries(measured).filter(([path]) => path.startsWith("next/")))).toEqual(expected);
});

it("vector: E5 each end-to-end row is the median of its three samples", () => {
  // T967, today's CI: the 8 end-to-end rows, from e2eSamples' runs A, B and C above.
  expect(Object.values(e2eSamples.jobs)).toHaveLength(3);

  for (const [path, samples] of Object.entries(e2eSamples.files)) {
    expect(samples, path).toHaveLength(3);
    expect.soft(rowOf(path), path).toBe(row(samples));
  }
});

// T342, today's sharding. Covers assign and the measured table. Plants: drop a file,
// restore equal-count assignment, or discard measured script times.
// T342: all three plants failed their laws. Equal-count placement initially survived
// the final load bound; checking the least measured load at each placement caught it.
it("L8: generated sharding assigns once to the least load including starts, independent of input order", () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(fc.record({ path: fc.string({ minLength: 1 }), seconds: fc.integer({ min: 0, max: 500 }) }), {
        selector: (f) => f.path,
        minLength: 1,
        maxLength: 40,
      }),
      fc.integer({ min: 1, max: 12 }),
      fc.array(fc.integer({ min: 0, max: 2000 }), { maxLength: 12 }),
      (files, count, start) => {
        const machines = assign(files, count, start);
        expect(machines).toHaveLength(files.length);
        const running = Array.from({ length: count }, (_, i) => start[i] ?? 0);

        for (const { file, index } of files
          .map((file, index) => ({ file, index }))
          .toSorted(
            (a, b) =>
              b.file.seconds - a.file.seconds || (a.file.path < b.file.path ? -1 : a.file.path > b.file.path ? 1 : 0),
          )) {
          const machine = machines[index]!;
          expect(running[machine]).toBe(Math.min(...running));
          expect(machine).toBe(running.indexOf(Math.min(...running)));
          running[machine] = running[machine]! + file.seconds;
        }

        expect(machines.every((m) => m >= 0 && m < count && Number.isInteger(m))).toBe(true);
        const first = Object.fromEntries(files.map((f, i) => [f.path, machines[i]]));
        const reversed = files.toReversed();
        expect(Object.fromEntries(reversed.map((f, i) => [f.path, assign(reversed, count, start)[i]]))).toEqual(first);
        expect(assign(files, count, [])).toEqual(assign(files, count));
        const empty = assign(files, count);
        const legacy = Array.from({ length: count }, () => 0);

        for (const file of files.toSorted(
          (a, b) => b.seconds - a.seconds || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
        )) {
          const least = legacy.indexOf(Math.min(...legacy));
          expect(empty[files.indexOf(file)]).toBe(least);
          legacy[least] = legacy[least]! + file.seconds;
        }

        const load = Array.from({ length: count }, (_, m) =>
          files.reduce((sum, f, i) => sum + (empty[i] === m ? f.seconds : 0), 0),
        );
        expect(Math.max(...load) - Math.min(...load)).toBeLessThanOrEqual(Math.max(...files.map((f) => f.seconds)));
      },
    ),
    { seed: 119120, numRuns: 100 },
  );
});

it("vector: real CI medians include the previously unweighted scripts", () => {
  // Fixed medians from runs 42579837468, 42573088027 and 42571265116, rounded to one decimal.
  // T554 refresh: plancheck.test.ts is the median of runs 42803733957, 42807559589 and 42801440878.
  expect(measured[".agents/skills/plan/scripts/plancheck.test.ts"]).toBe(106.2);
  expect(measured["apps/fabrika/src/bundles.test.ts"]).toBe(3.7);
  expect(measured["packages/pipeline/src/laws/standard.test.ts"]).toBe(3.5);
});

it("vector: the four build files carry their refreshed main-run times", () => {
  // T502, next/ (A9, A10), refreshed by T890. Samples and jobs are recorded in integrationSamples.
  // Attempt 1 of runs 43544589151, 43551626086 and 43556494864; each row is the median of its three.
  // Plant: drop these rows, so all four count the median row and the heavy build files can stack on one machine.
  for (const path of [
    "next/apps/fabrika/src/build.integration.test.ts",
    "next/apps/fabrika/src/exam/bytes.integration.test.ts",
    "next/packages/libfabrika/src/node/build/build-assets.integration.test.ts",
    "next/packages/libfabrika/src/node/build/build-one-file.integration.test.ts",
  ] as const) {
    expect.soft(measured[path], path).toBe(row(integrationSamples[path]));
  }
});

it("vector: lead test medians match the three green main CI runs", () => {
  // T375 Amendment 1: fixed CI medians from 42631962689, 42631256491 and 42630840277.
  // Plant: discard these rows, leaving the scripts to count as 1 s.
  for (const [path, seconds] of [
    // T554 refresh: median of 10 runs, PR 757's check run 42874119130, attempts 5 to 14.
    [".agents/skills/lead/scripts/box.test.ts", 348.7],
    [".agents/skills/step-commit/scripts/stepcommit.test.ts", 18.2],
    [".agents/skills/lead/scripts/redact.test.ts", 7.2],
    [".agents/skills/lead/scripts/gc.test.ts", 0.1],
  ] as const) {
    expect.soft(measured[path], path).toBe(seconds);
  }
});

// How the check's test machines split the test files: each gets about the same seconds, not the
// same count of files.

/** Twelve lane files of about two minutes each, and 300 files of a second. Made up. */
const HEAVY = Array.from({ length: 12 }, (_, i) => ({ path: `lane.${i}.test.ts`, seconds: 115 + i }));
const LIGHT = Array.from({ length: 300 }, (_, i) => ({ path: `small.${i}.test.ts`, seconds: 1 }));

const ROOT = dirname(fileURLToPath(import.meta.url));
const LANES = "packages/pipeline/src/stages/pipeline";

/** How many files each of `count` machines got. */
const perMachine = (machines: readonly number[], count: number) =>
  Array.from({ length: count }, (_, m) => machines.filter((at) => at === m).length);

/** Each path's machine. */
const byPath = (files: readonly { path: string }[], machines: readonly number[]) =>
  Object.fromEntries(files.map((f, i) => [f.path, machines[i]]));

describe("assign", () => {
  it("puts two of twelve heavy files on each of six machines, among 300 light ones", () => {
    const machines = assign([...HEAVY, ...LIGHT], 6);
    expect(machines).toHaveLength(312);
    expect(perMachine(machines.slice(0, 12), 6)).toEqual([2, 2, 2, 2, 2, 2]);
    expect(machines.every((m) => m >= 0 && m < 6)).toBe(true);
  });

  it("gives each machine at most one file when there are fewer files than machines", () => {
    const machines = assign(HEAVY.slice(0, 3), 6);
    expect(machines).toHaveLength(3);
    expect(Math.max(...perMachine(machines, 6))).toBe(1);
  });

  it("gives each path the same machine, in whatever order the files come", () => {
    const files = [...HEAVY, ...LIGHT];
    const first = byPath(files, assign(files, 6));
    const reversed = files.toReversed();
    const interleaved = [...files.filter((_, i) => i % 2 === 1), ...files.filter((_, i) => i % 2 === 0)];
    expect(byPath(reversed, assign(reversed, 6))).toEqual(first);
    expect(byPath(interleaved, assign(interleaved, 6))).toEqual(first);
  });

  it("places the heaviest file first, and two as heavy by their paths", () => {
    // Each goes to the machine with the least so far; of empty machines, the first.
    const files = [
      { path: "b.test.ts", seconds: 10 },
      { path: "a.test.ts", seconds: 10 },
      { path: "c.test.ts", seconds: 30 },
    ];
    expect(assign(files, 3)).toEqual([2, 1, 0]);
  });

  it("gives files of equal seconds their machines by path alone, whatever their order", () => {
    const files = ["d", "b", "e", "a", "c"].map((name) => ({ path: `${name}.test.ts`, seconds: 5 }));
    const want = { "a.test.ts": 0, "b.test.ts": 1, "c.test.ts": 2, "d.test.ts": 3, "e.test.ts": 4 };
    expect(byPath(files, assign(files, 5))).toEqual(want);
    const sorted = files.toSorted((x, y) => (x.path < y.path ? -1 : 1));
    expect(byPath(sorted, assign(sorted, 5))).toEqual(want);
    expect(byPath(sorted.toReversed(), assign(sorted.toReversed(), 5))).toEqual(want);
  });
});

// T890, today's CI. A file with no row is placed, not refused: after every measured file, in
// path order, on the machine with the least seconds so far (ties: the first), counting the median
// row, so several new files spread over the machines.
// Plants, each run once on vitest.shards.ts and restored: a file with no row adds 0 s (red: the new
// files pile onto one machine); place files with no row first (red in L14); give Shards
// `measured[path] ?? 0` (red in the Shards scenario); take the upper middle, or 0 s of nothing
// (red in L16); count the table's median in place of `unmeasured` (red in L14).

// Files with and without a row. fast-check supplies them; no domain schema describes test paths.
const rowFiles = fc.uniqueArray(
  fc.record({
    path: fc.string({ minLength: 1 }),
    seconds: fc.option(fc.integer({ min: 0, max: 500 }), { nil: undefined }),
  }),
  { selector: (f) => f.path, minLength: 1, maxLength: 40 },
);

/** Two tied measured files, a 0 s row and two files with no row. Made up. */
const tied = [
  { path: "new2.test.ts", seconds: undefined },
  { path: "new.test.ts", seconds: undefined },
  { path: "zero.test.ts", seconds: 0 },
  { path: "b.test.ts", seconds: 5 },
  { path: "a.test.ts", seconds: 5 },
];

describe("median", () => {
  it("L16: the median is an input of middle rank, the lower middle of an even count, 1 s of nothing, in any order", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.integer({ min: 0, max: 6000 }).map((tenths) => tenths / 10),
          { maxLength: 50 },
        ),
        fc.array(fc.nat(), { maxLength: 50 }),
        (seconds, order) => {
          const middle = median(seconds);

          if (seconds.length === 0) {
            expect(middle).toBe(1);
            return;
          }

          const rank = Math.floor((seconds.length - 1) / 2);
          expect(seconds).toContain(middle);
          expect(seconds.filter((value) => value < middle).length).toBeLessThanOrEqual(rank);
          expect(seconds.filter((value) => value <= middle).length).toBeGreaterThanOrEqual(rank + 1);
          const shuffled = seconds
            .map((value, i) => ({ value, key: order[i] ?? 0 }))
            .toSorted((x, y) => x.key - y.key)
            .map(({ value }) => value);
          expect(median(shuffled)).toBe(middle);
        },
      ),
      {
        seed: 119120,
        numRuns: 100,
        examples: [
          [[], []],
          [
            [4, 1, 3, 2],
            [3, 0, 2, 1],
          ],
        ],
      },
    );
  });

  it("L17: a file with no row counts the median of every row by default", () => {
    fc.assert(
      fc.property(rowFiles, fc.integer({ min: 1, max: 12 }), (files, count) => {
        expect(assign(files, count)).toEqual(assign(files, count, [], median(Object.values(measured))));
      }),
      { seed: 119120, numRuns: 100 },
    );
  });
});

describe("assign, for a file with no row", () => {
  it("L14: files with no row move no measured file, and each goes to the least load counting the median", () => {
    fc.assert(
      fc.property(
        rowFiles,
        fc.integer({ min: 1, max: 12 }),
        fc.array(fc.integer({ min: 0, max: 2000 }), { maxLength: 12 }),
        fc.integer({ min: 0, max: 50 }),
        (files, count, start, unmeasured) => {
          const machines = assign(files, count, start, unmeasured);
          const known = files.filter((file) => file.seconds !== undefined);
          const alone = assign(known, count, start, unmeasured);
          expect(known.map((file) => machines[files.indexOf(file)])).toEqual(alone);
          const load = Array.from({ length: count }, (_, m) =>
            known.reduce((sum, file, i) => sum + (alone[i] === m ? file.seconds! : 0), start[m] ?? 0),
          );

          for (const file of files
            .filter((file) => file.seconds === undefined)
            .toSorted((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0))) {
            const least = load.indexOf(Math.min(...load));
            expect(machines[files.indexOf(file)]).toBe(least);
            load[least] = load[least]! + unmeasured;
          }
        },
      ),
      {
        seed: 119120,
        numRuns: 100,
        examples: [
          // Made up, median 2. a 10 -> 0, b 6 -> 1, c 5 -> 2 (10, 6, 5); m.new -> 2 (7); z.new -> 1.
          [
            [
              { path: "z.new.test.ts", seconds: undefined },
              { path: "a.test.ts", seconds: 10 },
              { path: "m.new.test.ts", seconds: undefined },
              { path: "c.test.ts", seconds: 5 },
              { path: "b.test.ts", seconds: 6 },
            ],
            3,
            [],
            2,
          ],
          // Made up, median 3: a tie goes to the first machine, a 0 s row is measured, new files
          // spread. a 5 -> 0, b 5 -> 1, zero -> 0; new -> 0 (8); new2 -> 1 (8).
          [tied, 2, [], 3],
          // The same with machine 0 starting at 8: a and b -> 1, zero -> 0, new -> 0, new2 -> 1.
          [tied, 2, [8], 3],
        ],
      },
    );
  });

  it("L15: new files with no row spread evenly over machines that start level", () => {
    // Nine new files, as one pull request can add, never pile onto one machine.
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 0, max: 2000 }),
        fc.double({ min: 0.1, max: 600, noNaN: true }),
        (files, count, level, unmeasured) => {
          const fresh = Array.from({ length: files }, (_, i) => ({ path: `next/new.${i}.test.ts` }));
          const per = perMachine(
            assign(
              fresh,
              count,
              Array.from({ length: count }, () => level),
              unmeasured,
            ),
            count,
          );
          expect(Math.max(...per) - Math.min(...per)).toBeLessThanOrEqual(1);
        },
      ),
      { seed: 119120, numRuns: 100 },
    );
  });

  it("scenario: Shards spreads two new next/ files with no row over two machines", async () => {
    // Today's CI. Access.types and compiler have rows of 0.0 s, so both stay on shard 1/2 with the
    // machines tied at 0. The first new file counts the median and goes to shard 1/2, which leaves
    // shard 2/2 the least for the second. The rows are the merge line's, so the sequencer is built
    // over them: the config's own is over the full-depth rows when the schedule runs this test.
    const paths = [
      "next/packages/libfabrika/src/access/Access.types.test.ts",
      "next/packages/libfabrika/src/node/build/compiler.test.ts",
      "next/apps/toy/src/a.new.test.ts",
      "next/apps/toy/src/b.new.test.ts",
    ];
    expect(paths.map(rowOf)).toEqual([0, 0, undefined, undefined]);
    expect(noRow).toBeGreaterThan(0);
    const kept: string[][] = [];

    for (const index of [1, 2]) {
      const vitest = await createVitest("test", { root: ROOT, watch: false, shard: `${index}/2` });

      try {
        const Sequencer = shardsOver(measured);
        const mine = await new Sequencer(vitest).shard(paths.map((path) => ({ moduleId: join(ROOT, path) })) as never);
        kept.push(mine.map((spec) => relative(ROOT, spec.moduleId)));
      } finally {
        await vitest.close();
      }
    }

    expect(kept).toEqual([paths.slice(0, 3), [paths[3]]]);
  });
});

describe("measured", () => {
  it("names only files that are in the repo, so a renamed file cannot quietly keep a row", () => {
    const keys = Object.keys(measured);
    expect(keys.length).toBeGreaterThan(0);
    const isFile = (path: string) => statSync(join(ROOT, path), { throwIfNoEntry: false })?.isFile() === true;
    expect(keys.filter((path) => !isFile(path))).toEqual([]);
  });
});

describe("full, the rows at full depth", () => {
  const WATCH = "next/packages/libfabrika/src/node/dev/watch.laws.integration.test.ts";
  const GIT = "next/packages/libfabrika/src/node/repositories/RepositoriesGit.test.ts";

  it("names only files that are in the repo, so a renamed file cannot quietly keep a row", () => {
    const keys = Object.keys(full);
    expect(keys.length).toBeGreaterThan(0);
    const isFile = (path: string) => statSync(join(ROOT, path), { throwIfNoEntry: false })?.isFile() === true;
    expect(keys.filter((path) => !isFile(path))).toEqual([]);
  });

  it("vector: F1 a run at full depth reads a file's full row first, then its merge-line row, and a fast run only the merge-line rows", () => {
    // The two files of scheduled runs 43723335863 and 43771306886: watch.laws had no row at all, and
    // RepositoriesGit's row was its 28 s on memory git, while the schedule runs real git beside it.
    // The visual file has no full row, so its merge-line row stands at both depths.
    // Plant, run once and restored: `rowsAt` answers `measured` at both depths (red, both files).
    const visual = "next/apps/fabrika/e2e/resources.laws.visual.test.ts";
    expect(rowsAt("fast")).toBe(measured);
    expect([WATCH, GIT, visual].map((path) => measured[path])).toEqual([undefined, 28, 366.6]);
    expect([WATCH, GIT, visual].map((path) => rowsAt("full")[path])).toEqual([380.2, 167.8, 366.6]);

    for (const [path, seconds] of Object.entries(full)) {
      expect(rowsAt("full")[path], path).toBe(seconds);
    }
  });

  it("scenario: F2 at full depth the schedule's vitest legs balance by full seconds, and each starts its heaviest file first", async () => {
    // Today's CI, the schedule: the real config, the real next/ files and the count of vitest legs,
    // check.yaml's, which workflow-lint holds scheduled.yaml's next matrix to (SC7), each leg as
    // vitest runs it at full depth, `sort` after `shard`. On scheduled
    // runs 43723335863 (leg 4) and 43771306886 (leg 5) the split by merge-line rows gave one leg
    // about 2100 s of files at full depth where the others had 1000 to 1500 s, and started
    // watch.laws, 363 to 395 s and with no row, last: 702 s and 632 s into a step that has about
    // 1000 s, so the job's limit canceled both legs with no failed test.
    // Plants, each run once and restored: the sequencer over `measured` (red: leg 1's order by
    // full seconds); `rowsAt` answers `measured` at both depths (red: watch.laws is file 45 of leg
    // 5, as on the canceled run, and F1 is red too).
    const legs = vitestLegs(readFileSync(join(ROOT, ".github/workflows/check.yaml"), "utf8")).length;
    expect(legs).toBeGreaterThan(0);
    const rows = rowsAt("full");
    const Sequencer = shardsOver(rows);
    const loads: number[] = [];
    const seen: string[] = [];

    for (let index = 1; index <= legs; index++) {
      const vitest = await createVitest("test", {
        root: ROOT,
        watch: false,
        project: ["next", "next-integration"],
        shard: `${index}/${legs}`,
      });

      try {
        const specs = (await vitest.globTestSpecifications()).filter((spec) =>
          relative(ROOT, spec.moduleId).startsWith("next/"),
        );
        const sequencer = new Sequencer(vitest);
        const order = (await sequencer.sort(await sequencer.shard(specs))).map((spec) => relative(ROOT, spec.moduleId));
        const seconds = order.map((path) => rows[path] ?? noRow);
        expect(seconds, `leg ${index}`).toEqual(seconds.toSorted((a, b) => b - a));
        loads.push(seconds.reduce((sum, each) => sum + each, 0));

        if (order.includes(WATCH)) {
          // A file this heavy is among the first its leg's workers start, never the last.
          expect(order.indexOf(WATCH), `watch.laws on leg ${index}`).toBeLessThan(WORKERS);
        }

        seen.push(...order);
      } finally {
        await vitest.close();
      }
    }

    expect(seen.toSorted()).toEqual((await nextFiles(ROOT)).toSorted());
    const mean = loads.reduce((sum, load) => sum + load, 0) / legs;
    const heaviest = Math.max(...seen.map((path) => rows[path] ?? noRow));
    expect(Math.max(...loads), `loads ${loads.map((load) => load.toFixed(0)).join(", ")}`).toBeLessThanOrEqual(
      mean + heaviest,
    );
  });
});

describe("Shards", () => {
  it("pinned: is vitest's own sequencer with its sharding and its sort changed", () => {
    // The two methods vitest documents for a custom sequencer; L18 and L19 say what `sort` does.
    expect(Object.getPrototypeOf(Shards.prototype)).toBe(BaseSequencer.prototype);
    expect(Object.hasOwn(Shards.prototype, "shard")).toBe(true);
    expect(Object.hasOwn(Shards.prototype, "sort")).toBe(true);
  });

  it("scenario: L18 each next vitest leg starts its heaviest file first, and runs the rest heaviest first", async () => {
    // Today's CI: the real config, the real next/ files and the workflow's own count of vitest legs,
    // each leg as vitest runs it, `sort` after `shard`. On main runs 43615844695 and 43618656328
    // vitest's own order, by file size with no cache in CI, started StartChild 266 s and 284 s in on
    // leg 3, which then took 748 s and 816 s while leg 4 took 415 s and 468 s.
    // Plants, each run once and restored: `sort` returns `super.sort(files)` (red: leg 1 starts
    // smaller files before Watchers); `sort` orders lightest first (red). The seconds are the rows of
    // this run's depth, the ones the config's sequencer orders by.
    const rows = rowsAt(depth);
    const legs = vitestLegs(readFileSync(join(ROOT, ".github/workflows/check.yaml"), "utf8")).length;
    const seen: string[] = [];

    for (let index = 1; index <= legs; index++) {
      // The vitest legs' projects, as the schedule runs them; a pull request's `next` alone is a part.
      const vitest = await createVitest("test", {
        root: ROOT,
        watch: false,
        project: ["next", "next-integration"],
        shard: `${index}/${legs}`,
      });

      try {
        const specs = (await vitest.globTestSpecifications()).filter((spec) =>
          relative(ROOT, spec.moduleId).startsWith("next/"),
        );
        const sequencer = new vitest.config.sequence.sequencer(vitest);
        const order = (await sequencer.sort(await sequencer.shard(specs))).map((spec) => relative(ROOT, spec.moduleId));
        const seconds = order.map((path) => rows[path] ?? noRow);
        expect(seconds, `leg ${index}`).toEqual(seconds.toSorted((a, b) => b - a));
        seen.push(...order);
      } finally {
        await vitest.close();
      }
    }

    expect(seen.toSorted()).toEqual((await nextFiles(ROOT)).toSorted());
  });

  it("vector: L19 sort keeps vitest's pools and its failed-first, then the heaviest row, and equal rows keep vitest's order", async () => {
    // vitest 5's `groupSpecs` runs every project of one group order in one pool, a project of one
    // isolated file at a time in a pool of its own, and a file that failed last time first; `sort`
    // keeps the pools apart and orders only by seconds inside them. Projects a and c share group 0's
    // pool, d runs one file at a time and b is group 1. Access.types and compiler both have rows of 0.0 s,
    // so vitest's own order of the two (larger file first) stands.
    // Plants, each run once and restored: order by seconds alone (red: Watchers, in group 1, comes
    // first); key the pool by project too (red: admission, in project c, comes after runner); drop
    // the one-at-a-time pool (red: StartChild comes before admission); drop the failed-first term
    // (red: the failed light file comes after the heavier one); break equal seconds by path (red:
    // Access.types, the smaller, comes before compiler). The rows are the merge line's, so the sequencer is built over them.
    const project = (name: string, groupOrder: number, maxWorkers: number) => ({
      name,
      config: { sequence: { groupOrder }, isolate: true, maxWorkers },
    });
    const spec = (path: string, name: string, groupOrder = 0, maxWorkers = 3) => ({
      moduleId: join(ROOT, path),
      project: project(name, groupOrder, maxWorkers),
    });
    const watchers = spec("next/packages/libfabrika/src/node/Watchers.integration.test.ts", "b", 1);
    const admission = spec("next/packages/libfabrika/src/node/RunnerAdmission.integration.test.ts", "c");
    const startChild = spec("next/packages/libfabrika/src/node/StartChild.integration.test.ts", "d", 0, 1);
    const runner = spec("next/packages/libfabrika/src/runtime/Runner.integration.test.ts", "a");
    // 0591 moved the exam's clock and compiler tests; the compiler laws keep their 0.0 s row at their
    // new path, and Access.types stands in for clock: a 0.0 s file, smaller, whose path sorts first.
    const clock = spec("next/packages/libfabrika/src/access/Access.types.test.ts", "a");
    const compiler = spec("next/packages/libfabrika/src/node/build/compiler.test.ts", "a");
    const failedLight = spec("next/packages/libfabrika/src/ledger/Ledger.integration.test.ts", "a");
    expect(
      [watchers, admission, startChild, runner, clock, compiler, failedLight].map((s) =>
        rowOf(relative(ROOT, s.moduleId)),
      ),
    ).toEqual([217.6, 258.9, 262.9, 123.8, 0, 0, 3.2]);
    const vitest = await createVitest("test", { root: ROOT, watch: false });

    try {
      const lastRun = vitest.cache.getTestSpecificationResult.bind(vitest.cache);
      vitest.cache.getTestSpecificationResult = (s) =>
        s === (failedLight as never) ? { failed: true, duration: 3200 } : lastRun(s);
      const ties = await new BaseSequencer(vitest).sort([clock, compiler] as never);
      const order = await new (shardsOver(measured))(vitest).sort([
        clock,
        watchers,
        startChild,
        compiler,
        runner,
        failedLight,
        admission,
      ] as never);
      const paths = (specs: readonly { readonly moduleId: string }[]) => specs.map((s) => relative(ROOT, s.moduleId));
      expect(paths(order)).toEqual(paths([failedLight, admission, runner, ...ties, startChild, watchers]));
      expect(paths(ties)).toEqual(paths([compiler, clock]));
    } finally {
      await vitest.close();
    }
  });

  it("scenario: L13 lane-only shards cover every lane once and balance on top of the rest", async () => {
    // The real repo config selects lanes before sharding. Plant: start lanes from zero.
    const lanes = readdirSync(join(ROOT, LANES))
      .filter((name) => /^lane\..*\.test\.ts$/.test(name))
      .map((name) => `${LANES}/${name}`);
    const kept: string[][] = [];

    for (const index of [1, 2, 3, 4, 5, 6]) {
      // This repo's config, as `vitest run --shard k/6` reads it; nothing runs.
      const vitest = await createVitest("test", { root: ROOT, watch: false, shard: `${index}/6` });

      try {
        const specs = (await vitest.globTestSpecifications()).filter((spec) =>
          inLaneStep(relative(ROOT, spec.moduleId)),
        );
        const Sequencer = vitest.config.sequence.sequencer;
        const mine = await new Sequencer(vitest).shard(specs);
        kept.push(mine.map((spec) => relative(ROOT, spec.moduleId)));
      } finally {
        await vitest.close();
      }
    }

    expect(
      kept
        .flat()
        .filter((p) => lanes.includes(p))
        .toSorted(),
    ).toEqual(lanes.toSorted());
    const rest = Object.entries(measured)
      .filter(([path]) => !path.startsWith("next/") && !inLaneStep(path))
      .map(([path, seconds]) => ({ path, seconds }));
    const placed = assign(rest, 6);
    const loads = Array.from({ length: 6 }, (_, i) =>
      wall(rest.filter((_, j) => placed[j] === i).map((file) => file.seconds)),
    );
    expect(restLoads(6)).toEqual(loads);
    const seconds = kept.map((paths, i) => paths.reduce((sum, p) => sum + (rowOf(p) ?? noRow), loads[i]!));
    const heaviestLane = Math.max(...lanes.map((path) => rowOf(path) ?? noRow));
    const biggest = Math.max(
      ...Object.entries(measured)
        .filter(([path]) => !path.startsWith("next/"))
        .map(([, seconds]) => seconds),
    );
    expect(Math.max(...seconds)).toBeLessThanOrEqual(Math.max(Math.min(...seconds) + heaviestLane, biggest));
  });

  it("scenario: a list holding a lane file and another file is split as `assign` does, from zeros", async () => {
    // Only a list of lane files only starts from `restLoads`: the rest step shares those machines.
    // Plant: start from `restLoads` when any file is a lane file.
    const lanes = readdirSync(join(ROOT, LANES))
      .filter((name) => /^lane\..*\.test\.ts$/.test(name))
      .map((name) => `${LANES}/${name}`);
    const others = Object.keys(measured).filter((path) => !path.startsWith("next/") && !inLaneStep(path));
    const paths = [...lanes, ...others];
    const files = paths.map((path) => ({ path, seconds: rowOf(path) }));
    const placed = assign(files, 6);

    for (const index of [1, 2, 3, 4, 5, 6]) {
      const vitest = await createVitest("test", { root: ROOT, watch: false, shard: `${index}/6` });

      try {
        const Sequencer = vitest.config.sequence.sequencer;
        const mine = await new Sequencer(vitest).shard(paths.map((path) => ({ moduleId: join(ROOT, path) })) as never);
        expect(mine.map((spec) => relative(ROOT, spec.moduleId))).toEqual(
          paths.filter((_, i) => placed[i] === index - 1),
        );
      } finally {
        await vitest.close();
      }
    }
  });
});

it("L9: wall equals the largest file or the shared worker load", () => {
  // Plant: return the plain sum, ignoring parallel workers.
  fc.assert(
    fc.property(fc.array(fc.integer({ min: 0, max: 10000 })), (seconds) => {
      const biggest = Math.max(0, ...seconds);
      const shared = seconds.reduce((sum, seconds) => sum + seconds, 0) / WORKERS;
      const actual = wall(seconds);
      expect(actual).toBeGreaterThanOrEqual(biggest);
      expect(actual).toBeGreaterThanOrEqual(shared);
      expect([biggest, shared]).toContain(actual);
    }),
    { seed: 119120, numRuns: 100 },
  );
});

it("vector: L12 stale non-lane rows hold the three T554 run medians", () => {
  // Runs 42803733957, 42807559589, 42801440878. Gap >20 s; a file with no row counts the median row.
  // The last four rows (box, boxrm, loosening, program-package-layout) come from PR 757's
  // check run 42874119130, attempts 5 to 14, a median of 10. PR 1252 split boxrm and plancheck: the
  // boxrm and plancheck.draft rows are one reading each, from run 43728081584 attempt 1 (tooling legs).
  // Plant: restore plancheck's older median. Lane rows await the PR's own run.
  // catchup.test.ts had a row here until catchup.sh was retired for GitHub's merge queue (0162).
  const expected = {
    ".agents/skills/lead/scripts/box.test.ts": 348.7,
    ".agents/skills/lead/scripts/boxrm.test.ts": 170.2,
    ".agents/skills/lead/scripts/boxrm.storage.test.ts": 250.2,
    ".agents/skills/lead/scripts/boxrm.guards.test.ts": 206.6,
    ".agents/skills/plan/scripts/plancheck.draft.test.ts": 193.3,
    ".agents/skills/lead/scripts/loosening.test.ts": 234.6,
    "oxlint-plugins/program-package-layout.test.ts": 80.3,
    "packages/fabrika/src/host/fence.laws.test.ts": 117.1,
    "scripts/caps.test.ts": 108.5,
    ".agents/skills/plan/scripts/plancheck.test.ts": 106.2,
    "oxlint-plugins/plants.test.ts": 48.2,
    "oxlint-plugins/padding-line-between-statements.test.ts": 44.7,
    ".agents/skills/lead/scripts/leakgrep.test.ts": 34.2,
    ".agents/skills/lead/scripts/mutbox.test.ts": 34.0,
    ".agents/skills/lead/scripts/skillscheck.test.ts": 25.9,
  };

  for (const [path, seconds] of Object.entries(expected)) {
    expect.soft(measured[path], path).toBe(seconds);
  }
});

// T967, today's CI, about next/'s end-to-end files: since 0536 they are the `next-visual` project's
// `*.visual.test.ts` files, which the next job's legs `e2e-1` to `e2e-N` run with
// `vitest run --project next-visual`, split by `Shards`.
describe("the end-to-end legs", () => {
  const workflow = readFileSync(join(ROOT, ".github/workflows/check.yaml"), "utf8");

  /** The longest of `count` legs in seconds, as `assign` splits `files`; no row counts the median. */
  const longest = (files: readonly { path: string; seconds: number | undefined }[], count: number) => {
    const placed = assign(files, count);
    return Math.max(
      ...Array.from({ length: count }, (_, leg) =>
        files.reduce((sum, file, i) => sum + (placed[i] === leg ? (file.seconds ?? noRow) : 0), 0),
      ),
    );
  };

  it("scenario: E4 the workflow runs the fewest e2e legs whose longest leg fits in half the job's limit", async () => {
    // The real table with its fallback, the real end-to-end selection and check.yaml, since the law
    // is about today's legs. A leg's job is its longest `assign` share plus the overhead, the median
    // of e2eSamples' three; it must fit in half of the next job's `timeout-minutes`, the 2x room that
    // limit's own comment sizes. Fewest legs wins over the fastest split: the free plan's 20 jobs at
    // once is what kept the queue waiting. The worst run seen, job 132468626169 (PR 1208's queue
    // group), was canceled at 17 min with resources.laws still running after 622 s; alone on its
    // leg it would have ended near 11.5 min.
    // Plants, each run once with the 8 rows filled from e2eSamples, and restored: legs e2e-3 and
    // `/3` in check.yaml (red: the fewest that fit is 2; workflow-lint stayed green); chaos-revoke's
    // row at 300 (red: the fewest is 3); resources.laws's row at 500 (red, naming that file).
    // Without the rows every file counts the median, so 1 leg fits (red).
    const limit = nextMinutes(workflow) * 60;
    expect(limit).toBeGreaterThan(0);
    const budget = limit / 2 - median(e2eSamples.overhead);
    // legs.ts sizes a pull request's end-to-end legs on this same budget; its vitest legs take the
    // size step's BUDGET setting, capped at their own, shorter setup's room (legs.test.ts).
    expect(room(nextMinutes(workflow), E2E_SETUP)).toBe(budget);
    const files = (await visualFiles(ROOT)).map((path) => ({ path, seconds: rowOf(path) }));
    expect(files.length).toBeGreaterThan(0);
    const heaviest = files.toSorted((x, y) => (y.seconds ?? noRow) - (x.seconds ?? noRow))[0]!;
    // No count of legs makes a leg shorter than its heaviest file: that file must be split.
    expect(
      heaviest.seconds ?? noRow,
      `${heaviest.path} alone takes over the ${budget} s a leg has; split the file, as its own ticket`,
    ).toBeLessThanOrEqual(budget);
    const fewest = Array.from({ length: files.length }, (_, i) => i + 1).find(
      (count) => longest(files, count) <= budget,
    );
    expect(e2eLegs(workflow), `the fewest e2e legs that fit is ${fewest}`).toHaveLength(fewest!);
  });

  it("scenario: E6 each e2e leg keeps exactly assign's files for it, and every end-to-end file runs once", async () => {
    // The real config's visual project, as `vitest run --project next-visual --shard k/N` reads it,
    // with N the workflow's count of e2e legs; nothing runs. As the two-new-files Shards scenario.
    // Plant (T967, then on vitest.e2e.config.ts): drop `sequence.sequencer`, so Vitest's own split by
    // count keeps other files on each leg (red, with the rows and without them).
    const count = e2eLegs(workflow).length;
    const files = await visualFiles(ROOT);
    const placed = assign(
      files.map((path) => ({ path, seconds: rowOf(path) })),
      count,
    );
    const kept: string[][] = [];

    for (let index = 1; index <= count; index++) {
      const vitest = await createVitest("test", {
        root: ROOT,
        watch: false,
        project: "next-visual",
        shard: `${index}/${count}`,
      });

      try {
        const specs = await vitest.globTestSpecifications();
        const Sequencer = vitest.config.sequence.sequencer;
        const mine = await new Sequencer(vitest).shard(specs);
        kept.push(mine.map((spec) => relative(ROOT, spec.moduleId)).toSorted());
      } finally {
        await vitest.close();
      }
    }

    expect(kept).toEqual(Array.from({ length: count }, (_, leg) => files.filter((_, i) => placed[i] === leg)));
    expect(kept.flat().toSorted()).toEqual(files);
  });

  it("scenario: E7 the visual project, resolved through real Vitest, runs one file at a time from the repo root, with 120 s limits", async () => {
    // The `next-visual` project's values, the end-to-end config's of ticket 967 carried over (0536):
    // one glob, one worker, no file parallelism, the runner's old 120 s test and hook limits, no
    // setup file and no `passWithNoTests`, so a leg with no file fails; `Shards` is the root's
    // sequencer, which every project shares. Plants, each run once on vitest.config.ts and restored:
    // the project's `testTimeout` 60_000 (red); its include `next/apps/fabrika/e2e/*.visual.test.ts`
    // (red, here and in E8). It extends nothing from the root, so it carries the host-only guard
    // itself (0178, caps.test.ts holds what the guard does).
    expect(projects.find((project) => project.test.name === "next-visual")).toEqual({
      extends: false,
      plugins: [expect.objectContaining({ name: "fabrika-local-host-only" })],
      test: {
        name: "next-visual",
        root: ROOT,
        include: ["next/**/*.visual.test.{ts,tsx}"],
        exclude: [...configDefaults.exclude, ".agents/skills/*/scripts/**/fixtures/**", "next/**/dist/**"],
        maxWorkers: 1,
        fileParallelism: false,
        testTimeout: 120_000,
        hookTimeout: 120_000,
      },
    });
    const vitest = await createVitest("test", { root: ROOT, watch: false, project: "next-visual" });

    try {
      const visual = vitest.projects.find((project) => project.name === "next-visual");
      expect(visual, "vitest.config.ts has a next-visual project").toBeDefined();
      const config = visual!.config;
      expect(config.root).toBe(ROOT);
      expect(config.include).toEqual(["next/**/*.visual.test.{ts,tsx}"]);
      expect(config.setupFiles).toEqual([]);
      // Unset is Vitest's own default, which fails a run with no file.
      expect(vitest.config.passWithNoTests ?? false).toBe(false);
      expect(config.fileParallelism).toBe(false);
      expect(config.maxWorkers).toBe(1);
      expect([config.testTimeout, config.hookTimeout]).toEqual([120_000, 120_000]);
      expect(Object.getPrototypeOf(vitest.config.sequence.sequencer.prototype)).toBe(BaseSequencer.prototype);
      expect(vitest.config.sequence.sequencer.name).toBe(Shards.name);
    } finally {
      await vitest.close();
    }
  });
});

it.each(["vitest.shards.json", "vitest.shards.full.json"])(
  "scenario: L20 a change to the shard table %s alone selects the tests that import vitest.shards.ts, not every test",
  async (table) => {
    // Today's CI. vitest.config.ts imports vitest.shards.ts, and Vitest selects every test when a
    // file its config imports changes. The table is data read from disk, vitest.shards.json, and the
    // config makes it that module's watched file, so a row edit selects the tests that import it and
    // no other. The real config, the real files: the law is about this repo's graph. Plants, each run
    // once and restored: vitest.shards.ts imports the JSON (red: every test); the config's
    // `shardTable` adds no watched file (red: no test). The full-depth table is held the same way.
    const vitest = await createVitest("test", {
      root: ROOT,
      watch: false,
      related: [join(ROOT, table)],
      project: ["tooling", "next"],
    });

    try {
      const picked = (await vitest.specifications.getRelevantTestSpecifications()).map((s) =>
        relative(ROOT, s.moduleId),
      );
      const all = (await vitest.globTestSpecifications()).map((s) => relative(ROOT, s.moduleId));
      // Files that import vitest.shards.ts, directly or through legs.ts, shard-rows.ts or shard-times.ts.
      expect(picked).toEqual(
        expect.arrayContaining([
          "vitest.shards.test.ts",
          ".github/ci/legs.test.ts",
          ".github/ci/shard-rows.test.ts",
          ".github/ci/shard-times.test.ts",
          ".github/ci/related.test.ts",
        ]),
      );

      // Files that import nothing of it.
      for (const path of ["vitest.changed.test.ts", "scripts/testhome.test.ts", "oxlint-plugins/no-of.test.ts"]) {
        expect(picked).not.toContain(path);
      }

      expect(picked.filter((path) => path.startsWith("next/"))).toEqual([]);
      expect(picked.length).toBeLessThan(all.length);
    } finally {
      await vitest.close();
    }
  },
);
