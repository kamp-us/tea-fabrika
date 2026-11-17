import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { fixture, input, storageFiles } from "./boxrm.test-support.ts";

// Today's tooling: box.sh rm keeps a box whose files reach MAIN's git storage, by any path.
// The rest of its laws are in boxrm.test.ts and boxrm.guards.test.ts.
describe("box rm, today's tooling", () => {
  // Plant: review3's root-only walk misses a symlink anywhere below MAIN storage.
  // Arbitrary paths matter too: an unfamiliar storage name must fail closed.
  it.each(
    (["direct"] as const).flatMap((entry) =>
      (["gitdir", "common", "alternate"] as const).flatMap((root) =>
        [false, true].flatMap((data) =>
          ["objects/pack", "loose", "refs", "packed-refs", "logs", "index", "generated-file", "generated-folder"].map(
            (kind) => ({ entry, root, data, kind }),
          ),
        ),
      ),
    ),
  )("T318 review3 $entry keeps nested MAIN $root $kind in box data $data", ({ entry, root: rootKind, data, kind }) => {
    fc.assert(
      fc.property(
        input,
        fc.record({
          parts: fc.array(fc.stringMatching(/^[a-z]{1,8}$/), { minLength: 1, maxLength: 6 }),
          through: fc.boolean(),
          relative: fc.boolean(),
        }),
        (v, path) =>
          fixture(v, (f) => {
            const original = join(f.main, ".git");
            f.git(f.main, "pack-refs", "--all");

            if (kind === "objects/pack") {
              f.git(f.main, "repack", "-ad");
            }

            if (kind === "refs") {
              f.git(f.main, "update-ref", "refs/keep/storage", "HEAD");
            }

            const history = f.git(f.main, "rev-list", "--objects", "--all");
            let root = original;

            if (rootKind === "common") {
              root = join(f.dir, "main-common");
              cpSync(original, root, { recursive: true });
              writeFileSync(join(original, "commondir"), `${path.relative ? relative(original, root) : root}\n`);
            }

            if (rootKind === "alternate") {
              root = join(f.dir, "main-alternate");
              renameSync(join(original, "objects"), root);
              mkdirSync(join(original, "objects/info"), { recursive: true });
              writeFileSync(
                join(original, "objects/info/alternates"),
                `${path.relative ? relative(join(original, "objects"), root) : root}\n`,
              );
            }

            const source = join(
              root,
              kind === "loose"
                ? `${rootKind === "alternate" ? "" : "objects/"}${f.git(f.main, "rev-parse", "HEAD").slice(0, 2)}`
                : kind.startsWith("generated")
                  ? join("extra", ...path.parts, "saved")
                  : rootKind === "alternate"
                    ? kind.replace(/^objects\//, "")
                    : kind,
            );

            if (!existsSync(source)) {
              mkdirSync(join(source, ".."), { recursive: true });

              if (kind === "generated-file" || kind === "packed-refs" || kind === "index") {
                writeFileSync(source, v.value);
              } else {
                mkdirSync(source);
              }
            }

            const target = join(
              data ? join(f.data, "objects/info") : join(f.work, "node_modules"),
              ...path.parts,
              "borrowed",
            );

            mkdirSync(join(target, ".."), { recursive: true });
            const stored = path.through ? join(f.dir, "outside-storage") : target;
            renameSync(source, stored);
            const name = (from: string, to: string) => (path.relative ? relative(from, to) : to);

            if (path.through) {
              symlinkSync(name(join(target, ".."), stored), target);
            }

            symlinkSync(name(join(source, ".."), target), source);
            const saved = storageFiles(stored);
            expect(f.git(f.main, "rev-list", "--objects", "--all")).toBe(history);
            const got = f.run(f.name, {}, entry);
            expect(got.code, got.text).toBe(1);
            expect(got.text).toMatch(new RegExp(`^kept box ${f.name}: [^\\n]+$`, "m"));
            expect(existsSync(f.work), got.text).toBe(true);
            expect(existsSync(f.data), got.text).toBe(true);
            expect(existsSync(target), got.text).toBe(true);
            expect(storageFiles(stored)).toEqual(expect.objectContaining(saved));
            expect(f.git(f.main, "rev-list", "--objects", "--all")).toBe(history);
          }),
      ),
      { seed: 31860, numRuns: 3, endOnFailure: true },
    );
  });

  // Plant: ignore a walk error below an object root, leaving uncertainty treated as safe.
  it.each(["direct"] as const)("T318 review3 %s keeps the pair when MAIN cannot be fully walked", (entry) => {
    fc.assert(
      fc.property(input, fc.array(fc.stringMatching(/^[a-z]{1,8}$/), { minLength: 1, maxLength: 6 }), (v, parts) =>
        fixture(v, (f) => {
          const path = join(f.main, ".git/objects/pack", ...parts);
          mkdirSync(join(path, ".."), { recursive: true });
          symlinkSync(join(f.dir, "missing-storage"), path);
          const got = f.run(f.name, {}, entry);
          expect(got.code, got.text).toBe(1);
          expect(got.text).toMatch(new RegExp(`^kept box ${f.name}: [^\\n]+$`, "m"));
          expect(existsSync(f.work), got.text).toBe(true);
          expect(existsSync(f.data), got.text).toBe(true);
        }),
      ),
      { seed: 31861, numRuns: 3, endOnFailure: true },
    );
  });

  // Plant: today's guard protects only MAIN's checkout, so borrowed storage is deleted.
  // Cover nested alternates and intermediate links. `box.sh rm` is the one public caller since
  // catchup.sh, the other, was retired for GitHub's merge queue (0162).
  it.each(
    (["direct"] as const).flatMap((entry) =>
      (["gitdir-root", "shared", "gitdir", "commondir", "objects", "alternates", "alternates-file"] as const).flatMap(
        (binding) =>
          (binding === "gitdir-root" || binding === "shared"
            ? (["data"] as const)
            : (["work", "data"] as const)
          ).flatMap((location) =>
            (binding === "gitdir-root" || binding === "shared" || binding === "alternates-file"
              ? [false]
              : [false, true]
            ).map((through) => ({ entry, binding, location, through })),
          ),
      ),
    ),
  )(
    "T318 $entry keeps MAIN storage reached by $binding in $location through link $through",
    ({ entry, binding, location, through }) => {
      fc.assert(
        fc.property(
          input,
          fc.record({
            parts: fc.array(fc.stringMatching(/^[a-z]{1,8}$/), { minLength: 1, maxLength: 5 }),
            relative: fc.boolean(),
            hops: fc.integer({ min: 2, max: 4 }),
          }),
          (v, path) =>
            fixture(v, (f) => {
              const original = join(f.main, ".git");
              const history = f.git(f.main, "rev-list", "--objects", "--all");

              const target = join(
                location === "work" ? join(f.work, "node_modules") : join(f.data, "objects/info"),
                ...path.parts,
                "storage",
              );

              const name = (from: string, to: string) => (path.relative ? relative(from, to) : to);
              mkdirSync(join(target, ".."), { recursive: true });

              if (binding === "gitdir-root") {
                rmSync(original, { recursive: true });
                writeFileSync(join(f.main, ".git"), `gitdir: ${name(f.main, f.data)}\n`);
              } else if (binding === "shared") {
                const borrower = join(f.dir, "borrower");
                f.git(f.dir, "clone", "-q", "--shared", f.work, borrower);
                rmSync(original, { recursive: true });
                renameSync(join(borrower, ".git"), original);
                expect(readFileSync(join(original, "objects/info/alternates"), "utf8")).toContain(
                  join(f.data, "objects"),
                );
              } else if (binding === "alternates-file") {
                // The objects stay outside the box. Losing this borrowed metadata still
                // breaks MAIN, even though realpath(objects) points outside the pair.
                const outside = join(f.dir, "outside-objects");
                renameSync(join(original, "objects"), outside);
                mkdirSync(join(original, "objects/info"), { recursive: true });
                writeFileSync(target, `${name(join(original, "objects"), outside)}\n`);
                symlinkSync(name(join(original, "objects/info"), target), join(original, "objects/info/alternates"));
              } else {
                const source = ["gitdir", "commondir"].includes(binding) ? original : join(original, "objects");
                const stored = through ? join(f.dir, "outside-storage") : target;
                renameSync(source, stored);

                if (through) {
                  symlinkSync(name(join(target, ".."), stored), target);
                }

                if (binding === "gitdir") {
                  writeFileSync(original, `gitdir: ${name(f.main, target)}\n`);
                }

                if (binding === "commondir") {
                  mkdirSync(original);
                  writeFileSync(join(original, "HEAD"), readFileSync(join(stored, "HEAD")));
                  writeFileSync(join(original, "commondir"), `${name(original, target)}\n`);
                }

                if (binding === "objects") {
                  symlinkSync(name(original, target), source);
                }

                if (binding === "alternates") {
                  let next = target;

                  for (let i = 0; i < path.hops; i++) {
                    const objects = i === path.hops - 1 ? source : join(f.dir, `alternate-${i}`);
                    mkdirSync(join(objects, "info"), { recursive: true });
                    writeFileSync(join(objects, "info/alternates"), `${name(objects, next)}\n`);
                    next = objects;
                  }
                }
              }

              expect(f.git(f.main, "rev-list", "--objects", "--all")).toBe(history);
              const got = f.run(f.name, {}, entry);
              expect(got.code, got.text).toBe(1);
              expect(got.text).toMatch(new RegExp(`^kept box ${f.name}: [^\\n]+$`, "m"));
              expect(existsSync(f.work)).toBe(true);
              expect(existsSync(f.data)).toBe(true);
              expect(f.git(f.main, "rev-list", "--objects", "--all")).toBe(history);
            }),
        ),
        { seed: 31840, numRuns: 4, endOnFailure: true },
      );
    },
  );
});
