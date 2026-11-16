// The ratchet on the list files (0524, ticket 933), as CI runs it: the script on a planted git
// repository. It drives git and a temp folder, so it runs on the schedule (0536); the core's laws
// on generated rows are in ratchet.test.ts.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Formatter, Schema } from "effect";
import { ROWS, text } from "./ratchet.test-support.ts";

import { LISTS } from "./ratchet.ts";

/** A lint row's key, as the ratchet reads it. */
const lintKey = (r: { file: string; rule: string; code: string }) => JSON.stringify([r.file, r.rule, r.code]);

describe("ratchet.ts, as CI runs it (L4)", () => {
  const quiet = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const script = join(import.meta.dirname, "ratchet.ts");
  const extra = { file: "next/b.ts", rule: "fabrika(no-of)", code: "const b = 2;" };
  // Each test builds its own repository in its own scope, which removes it when the test ends (0061).
  const scenario = Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), "ratchet-"))),
    (repo) => Effect.sync(() => rmSync(repo, { recursive: true, force: true })),
  ).pipe(
    Effect.map((repo) => {
      const git = (...args: ReadonlyArray<string>) => {
        const out = spawnSync("git", ["-c", "user.name=exam", "-c", "user.email=exam@example.com", ...args], {
          cwd: repo,
          encoding: "utf8",
          env: quiet,
        });

        if (out.status !== 0) {
          throw new Error(`git ${args.join(" ")}: ${out.stderr}`);
        }

        return out.stdout.trim();
      };
      const put = (file: string, entries: ReadonlyArray<object>) => writeFileSync(join(repo, file), text(entries));
      const commit = (message: string) => {
        git("add", "-A");
        git("commit", "-q", "--allow-empty", "-m", message);
        return git("rev-parse", "HEAD");
      };
      const ratchet = (base: string) =>
        spawnSync(process.execPath, [script, "--base", base], { cwd: repo, encoding: "utf8", env: quiet });

      git("init", "-q", "-b", "main");

      for (const [file, rows] of Object.entries(ROWS)) {
        put(file, rows);
      }

      const base = commit("base");
      return { repo, git, put, commit, ratchet, base };
    }),
  );

  const jsonLines = (stdout: string) =>
    stdout
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(line));

  it.effect("L4 scenario: a head that adds a row exits 1, naming the row in its JSON line and annotation", () =>
    Effect.gen(function* () {
      const { put, commit, ratchet, base } = yield* scenario;
      put("next-ledger.json", [...ROWS["next-ledger.json"], extra]);
      commit("head");
      const out = ratchet(base);
      expect(out.status).toBe(1);
      expect(jsonLines(out.stdout)).toEqual([
        { _tag: "stuck", file: "next-ledger.json", reason: "row_added", rows: [lintKey(extra)] },
        { _tag: "done", file: "agents-ledger.json" },
        { _tag: "done", file: "unreachable-ledger.json" },
      ]);
      expect(out.stdout).toContain("::error file=next-ledger.json::");
    }),
  );

  it.effect("L4 scenario: a head that prunes rows and deletes a list exits 0", () =>
    Effect.gen(function* () {
      const { repo, put, commit, ratchet, base } = yield* scenario;
      put("agents-ledger.json", []);
      unlinkSync(join(repo, "unreachable-ledger.json"));
      commit("head");
      const out = ratchet(base);
      expect(out.status).toBe(0);
      expect(jsonLines(out.stdout)).toEqual(LISTS.map((list) => ({ _tag: "done", file: list.file })));
    }),
  );

  it.effect('L4 scenario: no base, as "" or forty zeros, exits 0 and says so; a base that is not a sha exits 2', () =>
    Effect.gen(function* () {
      const { put, commit, ratchet } = yield* scenario;
      put("next-ledger.json", [...ROWS["next-ledger.json"], extra]);
      commit("head");

      for (const none of ["", "0".repeat(40)]) {
        const out = ratchet(none);
        expect(out.status).toBe(0);
        expect(out.stdout).toContain("no base");
        expect(jsonLines(out.stdout)).toEqual([]);
      }

      const out = ratchet("nothex");
      expect(out.status).toBe(2);
      expect(jsonLines(out.stdout)).toEqual([]);
    }),
  );

  it.effect("L4 scenario: the committed HEAD is judged, never a dirty working tree", () =>
    Effect.gen(function* () {
      const { put, commit, ratchet, base } = yield* scenario;
      // Committed: a row added. Working tree: back to the base's rows, as an uncommitted prune would be.
      put("next-ledger.json", [...ROWS["next-ledger.json"], extra]);
      commit("head");
      put("next-ledger.json", ROWS["next-ledger.json"]);
      expect(ratchet(base).status).toBe(1);
      // Committed: the base's rows. Working tree: a row added and not committed.
      put("next-ledger.json", ROWS["next-ledger.json"]);
      commit("back");
      put("next-ledger.json", [...ROWS["next-ledger.json"], extra]);
      expect(ratchet(base).status).toBe(0);
    }),
  );

  // L5 as CI meets it: a file renamed with `git mv` keeps its rows under the new name.
  it.effect("L5 scenario: a head that renames a file and its rows exits 0, and one more row in it exits 1", () =>
    Effect.gen(function* () {
      const { repo, git, put, commit, ratchet } = yield* scenario;
      writeFileSync(join(repo, "a.ts"), "const a = 1;\n");
      put("next-ledger.json", [{ ...ROWS["next-ledger.json"][0], file: "a.ts" }]);
      const start = commit("a file with a row");
      git("mv", "a.ts", "a.integration.ts");
      put("next-ledger.json", [{ ...ROWS["next-ledger.json"][0], file: "a.integration.ts" }]);
      commit("renamed");
      expect(ratchet(start).status).toBe(0);
      put("next-ledger.json", [
        { ...ROWS["next-ledger.json"][0], file: "a.integration.ts" },
        { ...extra, file: "a.integration.ts" },
      ]);
      commit("and one more row");
      const out = ratchet(start);
      expect(out.status).toBe(1);
      expect(out.stdout).toContain(Formatter.formatJson(lintKey({ ...extra, file: "a.integration.ts" })).slice(1, -1));
    }),
  );
});
