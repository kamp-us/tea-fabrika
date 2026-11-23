import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { afterAll, beforeAll, expect } from "vitest";
import { scope } from "./survivors.ts";

// Today's tooling: what a call of the guard check looks at, from a real git repository made for the law.

const folders: Array<string> = [];

afterAll(() => {
  for (const folder of folders) {
    rmSync(folder, { recursive: true, force: true });
  }
});

const LAW = "kalfa/x/src/a.test.ts";

const PRODUCT = "kalfa/x/src/a.ts";

const repo = (() => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "survivors-scope-")));
  folders.push(root);

  const git = (...args: ReadonlyArray<string>) => {
    const ran = spawnSync(
      "/usr/bin/git",
      ["-C", root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", ...args],
      { encoding: "utf8" },
    );

    expect(ran.status, ran.stderr).toBe(0);

    return ran.stdout.trim();
  };

  return { root, git };
})();

/** The base, then the head that changes the product file. */
const commits = { base: "", head: "" };

beforeAll(() => {
  const { root, git } = repo;
  git("init", "-q");
  mkdirSync(join(root, "kalfa/x/src"), { recursive: true });
  writeFileSync(join(root, PRODUCT), "export const a = 1;\n");
  writeFileSync(join(root, LAW), "// the law\n");
  git("add", ".");
  git("commit", "-qm", "base");
  commits.base = git("rev-parse", "HEAD");
  writeFileSync(join(root, PRODUCT), "export const a = 2;\n");
  git("commit", "-qam", "change the product file");
  commits.head = git("rev-parse", "HEAD");
});

const key = (head: string) =>
  scope(repo.root, {
    base: commits.base,
    head,
    files: PRODUCT,
    index: join(repo.root, "unused-index"),
    cap: 8,
    version: "v1",
    seconds: 300,
  }).pipe(
    Effect.map((got) => got.key),
    Effect.provide(NodeServices.layer),
  );

// Plants: take the tree of the files to mutate alone (a change to a law alone hits the saved run); take
// the head's commit and not its tree (a message edit or an amend with the same files misses).
it.effect.prop(
  "a change to a law alone, with the product files as they were, misses a saved run, and a new message on the same tree hits",
  {
    text: Schema.String.check(Schema.isPattern(/^[a-z][a-z ]{0,20}$/)),
    message: Schema.String.check(Schema.isPattern(/^[a-z]{1,12}$/)),
  },
  ({ text, message }) =>
    Effect.gen(function* () {
      const { git } = repo;
      const before = yield* key(commits.head);

      writeFileSync(join(repo.root, LAW), `// changed ${text}\n`);
      git("commit", "-qam", `law ${message}`);
      const lawOnly = git("rev-parse", "HEAD");
      git("reset", "-q", "--hard", commits.head);

      const tree = git("rev-parse", `${commits.head}^{tree}`);
      const reworded = git("commit-tree", tree, "-p", commits.base, "-m", message);

      expect(yield* key(lawOnly), "a law changed, the product file did not").not.toBe(before);
      expect(yield* key(reworded), "the same tree under another message").toBe(before);
    }),
  { arbitrary: { seed: 119120, runs: 12 } },
);
