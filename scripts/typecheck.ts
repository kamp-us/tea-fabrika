// `pnpm typecheck`: one type check at a time across every shell on the machine (0410, 0012), ported
// from typecheck.sh to TypeScript and Effect (0113, ticket 766). The program is in
// `typecheck/Typecheck.ts`. This file loads it with one dynamic import, so a worktree whose
// node_modules cannot load Effect gets one line and exit 1 rather than a stack. The commands sit
// here, so the cache lint (`.github/ci/workflow-lint/caches.ts`) reads the buildinfo path from this
// file. Today's tooling, following next/'s rules (0033).
import type { Command } from "./typecheck/Commands.ts";

/** This worktree's own install, from the warm store, with no network; it replaces a linked node_modules. */
export const INSTALL: Command = { cmd: "pnpm", args: ["install", "--offline", "--frozen-lockfile"] };

/** Effect's language service patch of the TypeScript compiler, so the check runs Effect's own checks. */
export const PATCH: Command = { cmd: "pnpm", args: ["exec", "effect-tsgo", "patch", "--typescript"] };

// Each package keeps what its last check found in this file, relative to the package, and checks
// again only the files whose text changed and the files that reach them. tsc keys each file by a
// hash of its text, never its mtime, so a fresh checkout reads it too. CI keeps these files in its
// cache (check.yaml's typecheck job). Planted on next/packages/libfabrika, 2026-11-14: an error in
// one file, an error only an unchanged importer shows, a change under the old mtime and an Effect
// check each failed the warm run; fresh mtimes on every file kept it warm.
/** The check of every workspace package. */
export const CHECK: Command = {
  cmd: "pnpm",
  args: ["-r", "typecheck", "--incremental", "--tsBuildInfoFile", "node_modules/.cache/tsc/typecheck.tsbuildinfo"],
};

const CANNOT_LOAD =
  "typecheck: cannot load the typecheck's modules from node_modules; run pnpm install --offline --frozen-lockfile\n";

if (import.meta.main) {
  // oxlint-disable-next-line fabrika/no-promises -- edge: the one dynamic import that loads Effect, so a missing node_modules gets one line
  import("./typecheck/Typecheck.ts").then(
    (typecheck) => typecheck.main(),
    () => {
      process.stderr.write(CANNOT_LOAD);
      process.exitCode = 1;
    },
  );
}
