import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { fixture, input, kept } from "./boxrm.test-support.ts";

// Today's tooling: box.sh rm keeps a box that holds work MAIN has not saved, and removes a clean one.
// The rest of its laws are in boxrm.storage.test.ts and boxrm.guards.test.ts.
describe("box rm, today's tooling", () => {
  // Plant: peel a tag to its commit and accept it without retaining its annotation object.
  // Signature bytes are saved content here, not a claim about signature validity. No key is used.
  it.each(
    (["direct"] as const).flatMap((entry) =>
      (["plain", "signed", "nested"] as const).flatMap((kind) =>
        (kind === "nested"
          ? (["commit-only", "objects-only", "different-tag", "inner-only", "retained"] as const)
          : (["commit-only", "objects-only", "different-tag", "retained"] as const)
        ).map((retention) => ({ entry, kind, retention })),
      ),
    ),
  )("T318 $entry preserves $kind annotation objects with $retention retention", ({ entry, kind, retention }) => {
    fc.assert(
      fc.property(
        input,
        fc.record({
          messages: fc.array(fc.string({ unit: "grapheme", maxLength: 80 }), {
            minLength: 0,
            maxLength: 5,
          }),
          depth: fc.integer({ min: 2, max: 5 }),
          signedInner: fc.boolean(),
        }),
        (v, annotation) =>
          fixture(v, (f) => {
            const commit = f.git(f.work, "rev-parse", "HEAD");
            const objects: string[] = [];
            const raw: string[] = [];
            const tag = (target: string, message: string, signed: boolean, label = v.name) => {
              const text = `object ${target}\ntype ${target === commit ? "commit" : "tag"}\ntag ${label}\ntagger Fixture <fixture@example.test> 1794096000 +0000\n\n${message}${signed ? `\n-----BEGIN PGP SIGNATURE-----\n${Buffer.from(v.value).toString("base64")}\n-----END PGP SIGNATURE-----\n` : ""}`;
              const made = spawnSync("/usr/bin/git", ["-C", f.work, "mktag"], {
                input: text,
                encoding: "utf8",
                env: f.env,
              });
              expect(made.status, made.stderr).toBe(0);
              return { oid: made.stdout.trim(), text };
            };
            let target = commit;

            for (let i = 0; i < (kind === "nested" ? annotation.depth : 1); i++) {
              const made = tag(
                target,
                annotation.messages.join("\n"),
                kind === "signed" || (kind === "nested" && annotation.signedInner),
              );
              objects.push(made.oid);
              raw.push(made.text);
              target = made.oid;
            }

            const ref = `refs/tags/${v.name}`;
            f.git(f.work, "update-ref", ref, target);
            const retainTag = (source: string) =>
              f.git(f.main, "fetch", "-q", "--no-tags", f.data, `${source}:refs/keep/${v.name}`);

            if (retention === "retained" || retention === "objects-only") {
              retainTag(ref);

              if (retention === "objects-only") {
                f.git(f.main, "update-ref", "-d", `refs/keep/${v.name}`);
              }
            }

            if (retention === "different-tag") {
              const other = tag(commit, annotation.messages.join("\n"), false, `other-${v.name}`);
              f.git(f.work, "update-ref", `refs/tags/other-${v.name}`, other.oid);
              retainTag(`refs/tags/other-${v.name}`);
            }

            if (retention === "inner-only") {
              retainTag(objects.at(-2)!);
            }

            const reachable = f
              .git(f.main, "rev-list", "--objects", "--all")
              .split("\n")
              .map((line) => line.split(" ")[0]);
            expect(reachable.includes(target)).toBe(retention === "retained");

            if (retention === "commit-only") {
              const absent = spawnSync("/usr/bin/git", ["-C", f.main, "cat-file", "-e", target], {
                env: f.env,
                encoding: "utf8",
              });
              expect(absent.status).not.toBe(0);
            }

            const got = f.run(f.name, {}, entry);
            const remove = retention === "retained";
            expect(got.code, got.text).toBe(remove ? 0 : 1);
            expect(got.text).toMatch(
              new RegExp(`^${remove ? "removed" : "kept"} box ${f.name}${remove ? "$" : ": [^\\n]+$"}`, "m"),
            );
            expect(existsSync(f.work)).toBe(!remove);
            expect(existsSync(f.data)).toBe(!remove);

            for (const [i, oid] of objects.entries()) {
              const at = remove ? f.main : f.work;
              const read = spawnSync("/usr/bin/git", ["-C", at, "cat-file", "tag", oid], {
                env: f.env,
                encoding: "utf8",
              });
              expect(read.status, read.stderr).toBe(0);
              expect(read.stdout).toBe(raw[i]);
            }
          }),
      ),
      { seed: 31841, numRuns: 3, endOnFailure: true },
    );
  });

  // Plants: count fetched refs, remote reflogs or FETCH_HEAD as saved work; reject ORIG_HEAD
  // or config.worktree after a completed merge. All are normal in boxes made by box.sh new.
  it.each([false, true])(
    "T318 a fetched box branch removes with remote copies and config.worktree %s",
    (worktreeConfig) => {
      const branches = fc.uniqueArray(fc.stringMatching(/^[a-z]{2,8}$/), {
        minLength: 2,
        maxLength: 4,
      });
      fc.assert(
        fc.property(input, branches, fc.nat(), (v, names, choice) => {
          const remote = {
            branches: names.map((name) => `topic-${name}`),
            local: choice % names.length,
          };
          fixture(
            v,
            (f) => {
              const origin = join(f.dir, "origin.git"),
                branch = `step-${v.name}`,
                base = f.git(f.work, "rev-parse", "HEAD"),
                tree = f.git(f.main, "rev-parse", "HEAD^{tree}"),
                changed = remote.branches[remote.branches.length - 1]!;
              const packed = readFileSync(join(f.data, "packed-refs"), "utf8");

              for (const name of remote.branches) {
                expect(packed).toContain(` refs/remotes/origin/${name}\n`);
              }

              expect(f.git(f.main, "for-each-ref", "--format=%(refname)", "refs/heads")).toBe(
                ["main", ...remote.branches.slice(0, remote.local)]
                  .sort()
                  .map((name) => `refs/heads/${name}`)
                  .join("\n"),
              );
              f.git(f.work, "checkout", "-qb", branch);

              for (let i = 0; i < v.depth; i++) {
                writeFileSync(join(f.work, "tracked"), `${v.value} step ${i}`);
                f.commit();
              }

              const step = f.git(f.work, "rev-parse", "HEAD");

              // Move origin/main and one topic after both clones. The topic's older packed
              // tip, loose tip and remote reflog are all fetched copies, absent from MAIN's
              // retained history. FETCH_HEAD records every remote branch, too.
              for (const name of ["main", changed]) {
                const parent = f.git(f.main, "rev-parse", `origin/${name}`),
                  tip = f.git(f.main, "commit-tree", tree, "-p", parent, "-m", `advance ${name}`);
                f.git(origin, "fetch", "-q", f.main, `${tip}:refs/heads/${name}`);
              }

              f.git(f.main, "fetch", "-q", "origin");
              f.git(f.work, "fetch", "-q", "origin");
              f.git(f.work, "merge", "-qm", `${v.value} merge`, "origin/main");
              expect(f.git(f.work, "rev-parse", "ORIG_HEAD")).toBe(step);
              expect(f.git(f.work, "rev-parse", "HEAD^2")).not.toBe(base);
              const fetched = f.git(f.work, "rev-parse", `origin/${changed}`);
              expect(readFileSync(join(f.data, "refs/remotes/origin", changed), "utf8").trim()).toBe(fetched);
              expect(readFileSync(join(f.data, "logs/refs/remotes/origin", changed), "utf8")).toContain(fetched);
              const fetchHead = readFileSync(join(f.data, "FETCH_HEAD"), "utf8");
              expect(fetchHead.trim().split("\n")).toHaveLength(remote.branches.length + 1);
              expect(fetchHead).toContain(fetched);

              if (worktreeConfig) {
                f.git(f.work, "config", "extensions.worktreeConfig", "true");
                f.git(f.work, "config", "--worktree", "user.name", "Fixture");
                expect(existsSync(join(f.data, "config.worktree"))).toBe(true);
              }

              f.retained(`refs/heads/${branch}`);
              expect(
                f.git(f.main, "rev-list", "--branches", "--tags", `refs/keep/${v.name}`).split("\n"),
              ).not.toContain(fetched);
              expect(f.run()).toEqual({ code: 0, text: `removed box ${f.name}` });
              expect(existsSync(f.work)).toBe(false);
              expect(existsSync(f.data)).toBe(false);
            },
            true,
            remote,
          );
        }),
        { seed: 31828, numRuns: 4, endOnFailure: true },
      );
    },
  );

  // Plant: allow ORIG_HEAD as ordinary metadata but never read its saved commit.
  it("T318 a local commit saved only by ORIG_HEAD keeps the pair", () => {
    fc.assert(
      fc.property(input, (v) =>
        fixture(v, (f) => {
          const base = f.git(f.work, "rev-parse", "HEAD");

          for (let i = 0; i < v.depth; i++) {
            writeFileSync(join(f.work, "tracked"), `${v.value} saved ${i}`);
            f.commit();
          }

          const saved = f.git(f.work, "rev-parse", "HEAD");
          f.git(f.work, "checkout", "-q", "--detach", base);
          f.git(f.work, "branch", "-f", "main", base);
          rmSync(join(f.data, "logs"), { recursive: true });
          f.git(f.work, "update-ref", "ORIG_HEAD", saved);
          expect(f.git(f.work, "rev-list", "HEAD", "--all").split("\n")).not.toContain(saved);
          expect(existsSync(join(f.data, "logs"))).toBe(false);
          expect(f.git(f.work, "rev-parse", "ORIG_HEAD")).toBe(saved);
          kept(f);
        }),
      ),
      { seed: 31829, numRuns: 4, endOnFailure: true },
    );
  });

  // Plant: skip every reflog, or skip names that merely start with refs/remotes.
  it.each(["HEAD", "refs/heads/saved", "refs/notes/saved", "refs/custom/saved", "refs/remotes-copy/saved"])(
    "T318 a local commit saved only by the %s reflog keeps the pair",
    (ref) => {
      fc.assert(
        fc.property(input, (v) =>
          fixture(v, (f) => {
            const base = f.git(f.work, "rev-parse", "HEAD");

            for (let i = 0; i < v.depth; i++) {
              writeFileSync(join(f.work, "tracked"), `${v.value} saved ${i}`);
              f.commit();
            }

            const saved = f.git(f.work, "rev-parse", "HEAD");
            f.git(f.work, "checkout", "-q", "--detach", base);
            f.git(f.work, "branch", "-f", "main", base);
            rmSync(join(f.data, "logs"), { recursive: true });
            const name = ref === "HEAD" ? ref : `${ref}/${v.name}`,
              path = join(f.data, "logs", name);
            f.git(f.work, "update-ref", "--create-reflog", name, saved);
            f.git(f.work, "update-ref", "--create-reflog", name, base);

            if (name !== "HEAD") {
              rmSync(join(f.data, name));
            }

            expect(f.git(f.work, "rev-list", "HEAD", "--all").split("\n")).not.toContain(saved);
            expect(existsSync(join(f.data, "ORIG_HEAD"))).toBe(false);
            expect(readFileSync(path, "utf8")).toContain(saved);
            kept(f);
          }),
        ),
        { seed: 31830, numRuns: 4, endOnFailure: true },
      );
    },
  );

  // Plant: refuse the symbolic origin/HEAD that box.sh new creates.
  it("T318 a normal separate-gitdir clone keeps origin and removes cleanly", () => {
    fc.assert(
      fc.property(input, (v) =>
        fixture(
          v,
          (f) => {
            expect(f.git(f.work, "symbolic-ref", "refs/remotes/origin/HEAD")).toBe("refs/remotes/origin/main");
            expect(f.run()).toEqual({ code: 0, text: `removed box ${f.name}` });
            expect(existsSync(f.work)).toBe(false);
            expect(existsSync(f.data)).toBe(false);
          },
          true,
        ),
      ),
      { seed: 31820, numRuns: 4, endOnFailure: true },
    );
  });

  // Plant: enumerate only heads/stash/notes, dropping tags and other namespaces.
  it.each(["lightweight", "annotated", "custom"])("T318 every %s ref saves unretained work", (kind) => {
    const namespace = fc.array(fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/), {
      minLength: 1,
      maxLength: 5,
    });
    fc.assert(
      fc.property(input, namespace, (v, parts) =>
        fixture(v, (f) => {
          const base = f.git(f.work, "rev-parse", "HEAD");
          writeFileSync(join(f.work, "tracked"), v.value);
          const tip = f.commit();
          f.git(f.work, "checkout", "-q", "--detach", base);
          f.git(f.work, "branch", "-f", "main", base);

          if (kind === "annotated") {
            f.git(f.work, "tag", "-a", parts.join("/"), tip, "-m", v.value);
          } else {
            f.git(f.work, "update-ref", `refs/${kind === "lightweight" ? "tags" : parts.join("/")}/${v.name}`, tip);
          }

          kept(f);
        }),
      ),
      { seed: 31821, numRuns: 5, endOnFailure: true },
    );
  });

  // Plant: inspect refs/stash alone instead of every saved entry in its reflog.
  it("T318 every stash depth stays when only newer entries are retained", () => {
    fc.assert(
      fc.property(input, fc.integer({ min: 2, max: 9 }), fc.nat(), (v, depth, choice) =>
        fixture(v, (f) => {
          const missing = 1 + (choice % (depth - 1));

          for (let i = 0; i < depth; i++) {
            writeFileSync(join(f.work, "tracked"), `${v.value} ${i}`);
            f.git(f.work, "stash", "push", "-qm", `${v.name}-${i}`);
          }

          for (let i = 0; i < depth; i++) {
            if (i !== missing) {
              f.git(
                f.main,
                "fetch",
                "-q",
                f.data,
                `${f.git(f.work, "rev-parse", `stash@{${i}}`)}:refs/keep/stash-${i}`,
              );
            }
          }

          kept(f);
        }),
      ),
      { seed: 31822, numRuns: 5, endOnFailure: true },
    );
  });

  // Plant: ignore operation state, including an unretained MERGE_AUTOSTASH.
  it("T318 every operation-state file keeps the pair", () => {
    const states = fc.oneof(
      fc.constantFrom(
        "MERGE_AUTOSTASH",
        "MERGE_HEAD",
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
        "REBASE_HEAD",
        "AUTO_MERGE",
        "rebase-merge/autostash",
        "rebase-apply/autostash",
        "sequencer/head",
        "BISECT_START",
      ),
      fc.stringMatching(/^[A-Z]{2,12}$/).map((s) => `${s}_HEAD`),
    );
    fc.assert(
      fc.property(input, states, (v, state) =>
        fixture(v, (f) => {
          const base = f.git(f.work, "rev-parse", "HEAD");
          writeFileSync(join(f.work, "tracked"), v.value);
          const tip = f.commit();
          f.git(f.work, "checkout", "-q", "--detach", base);
          f.git(f.work, "branch", "-f", "main", base);
          const path = join(f.data, state);
          mkdirSync(join(path, ".."), { recursive: true });
          writeFileSync(path, `${tip}\n`);
          kept(f);
        }),
      ),
      { seed: 31823, numRuns: 12, endOnFailure: true },
    );
  });

  // Plants: inspect only the primary HEAD/index; ignore a linked worktree's saved index.
  it.each(["detached", "staged"])("T318 linked worktrees keep %s work", (kind) => {
    fc.assert(
      fc.property(input, fc.integer({ min: 1, max: 4 }), fc.boolean(), (v, total, inside) =>
        fixture(v, (f) => {
          for (let i = 0; i < total; i++) {
            const linked = join(inside ? f.work : f.dir, `${v.name}-linked-${i}`);
            f.git(f.work, "worktree", "add", "-q", "--detach", linked, "HEAD");

            if (i !== total - 1) {
              continue;
            }

            writeFileSync(join(linked, "tracked"), `${v.value} saved`);
            f.git(linked, "add", "tracked");

            if (kind === "detached") {
              f.git(linked, "commit", "-qm", v.value);
            } else {
              writeFileSync(join(linked, "tracked"), readFileSync(join(f.main, "tracked")));
            }
          }

          kept(f);
        }),
      ),
      { seed: 31824, numRuns: 4, endOnFailure: true },
    );
  });

  // Plant: accept a valid pair even though it holds MAIN or BOXES/state.
  it.each(["main-work", "main-data", "main-child", "main-data-child", "state"])(
    "T318 protected %s locations survive direct removal",
    (kind) => {
      fc.assert(
        fc.property(input, (v) =>
          // Only an older tree can be BOXES/state itself; one in BOXES/box named state is a box like any other.
          fixture(kind === "state" ? { ...v, name: "state", space: false, old: true } : v, (f) => {
            let main = f.main;

            if (kind.startsWith("main")) {
              main =
                kind === "main-work"
                  ? f.work
                  : kind === "main-data"
                    ? f.data
                    : join(
                        kind === "main-data-child" ? f.data : f.work,
                        ...Array.from({ length: v.depth }, (_, i) => `child-${v.value}-${i}`),
                      );

              if (kind.endsWith("child")) {
                mkdirSync(main, { recursive: true });
              }
            }

            const saved = join(kind === "state" ? f.work : main, "saved.md");
            writeFileSync(saved, v.value);
            const got = f.run(f.name, { MAIN: main });
            expect(got.code, got.text).toBe(1);
            expect(got.text).toMatch(/^kept box .*: [^\n]+$/);
            expect(existsSync(f.work)).toBe(true);
            expect(existsSync(f.data)).toBe(true);
            expect(readFileSync(saved, "utf8")).toBe(v.value);
          }),
        ),
        { seed: 31825, numRuns: 3, endOnFailure: true },
      );
    },
  );

  // Plants: use exists() for commondir/shallow; omit the sharedindex guard.
  it.each(["commondir", "shallow", "sharedindex"])("T318 dangling %s metadata keeps both paths", (kind) => {
    fc.assert(
      fc.property(input, fc.stringMatching(/^[0-9a-f]{40}$/), (v, hash) =>
        fixture(v, (f) => {
          symlinkSync(
            join(f.dir, `${v.value}-missing`),
            join(f.data, kind === "sharedindex" ? `sharedindex.${hash}` : kind),
          );
          kept(f);
        }),
      ),
      { seed: 31826, numRuns: 4, endOnFailure: true },
    );
  });

  // Plant: ignore only status's failed exit while ls-files still succeeds.
  it("T318 failed status alone keeps both paths", () => {
    fc.assert(
      fc.property(input, (v) =>
        fixture(v, (f) => {
          const bin = join(f.dir, "bin"),
            log = join(f.dir, "git-calls");
          mkdirSync(bin);
          writeFileSync(
            join(bin, "git"),
            `#!/bin/sh\nfor arg do\n case "$arg" in status) echo status >> '${log}'; exit 1;; ls-files) echo ls-files >> '${log}';; esac\ndone\nexec /usr/bin/git "$@"\n`,
            { mode: 0o755 },
          );
          // box.sh rm runs box.ts, so Node's own folder follows the planted git.
          const got = f.run(f.name, { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin` });
          expect(got.code, got.text).toBe(1);
          expect(got.text).toMatch(/^kept box .*: [^\n]+$/);
          expect(readFileSync(log, "utf8").trim().split("\n")).toEqual(["ls-files", "status"]);
          expect(existsSync(f.work)).toBe(true);
          expect(existsSync(f.data)).toBe(true);
        }),
      ),
      { seed: 31827, numRuns: 4, endOnFailure: true },
    );
  });
  // Plants: split a space-containing name; reject untracked-only files; delete a neighbor.
  it("T318 rm deletes exactly a clean pair including spaces and untracked-only contents and repeats", () => {
    fc.assert(
      fc.property(input, (v) =>
        fixture({ ...v, space: true }, (f) => {
          for (const path of [join(f.boxes, `${f.name}-neighbor`), join(f.boxes, "state")]) {
            mkdirSync(path);
            writeFileSync(join(path, "saved.md"), v.value);
          }

          writeFileSync(join(f.work, `${v.value}.untracked`), v.value);
          mkdirSync(join(f.work, "node_modules"));
          writeFileSync(join(f.work, "node_modules/install"), v.value);
          const got = f.run();
          expect(got.code, got.text).toBe(0);
          expect(got.text).toBe(`removed box ${f.name}`);
          expect(existsSync(f.work)).toBe(false);
          expect(existsSync(f.data)).toBe(false);

          for (const path of [`${f.name}-neighbor`, "state"]) {
            expect(readFileSync(join(f.boxes, path, "saved.md"), "utf8")).toBe(v.value);
          }

          expect(f.run()).toEqual({ code: 0, text: `absent box ${f.name}` });
        }),
      ),
      { seed: 3186, numRuns: 4 },
    );
  });

  // Plant: drop the keepruns.sh call; the box's runs/ goes with the folder (field note 2026-11-09:
  // experiment 244's raw answers were lost that way).
  it.each(["direct"] as const)(
    "T475 %s rm moves the box's runs/ into MAIN's runs/<box>/ before the box goes",
    (entry) => {
      fc.assert(
        fc.property(input, (v) =>
          fixture({ ...v, space: true }, (f) => {
            mkdirSync(join(f.work, "runs", v.value), { recursive: true });
            writeFileSync(join(f.work, "runs", v.value, "answers.jsonl"), v.value);
            const got = f.run(f.name, {}, entry);
            expect(got.code, got.text).toBe(0);
            expect(got.text).toContain(`kept runs of ${f.name} at runs/${f.name}`);
            expect(got.text).toContain(`removed box ${f.name}`);
            expect(existsSync(f.work)).toBe(false);
            expect(readFileSync(join(f.main, "runs", f.name, v.value, "answers.jsonl"), "utf8")).toBe(v.value);
          }),
        ),
        { seed: 3186, numRuns: 3 },
      );
    },
  );
});
