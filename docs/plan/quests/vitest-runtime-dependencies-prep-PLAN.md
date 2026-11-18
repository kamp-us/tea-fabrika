Approved by the lead agent, builds approved 0580 dependency preparation and 0594; body f043b1261ec6
Plancheck-Version: 3

# Plan: prepare the vitest package's three existing runtime dependencies

This is tracker ticket 1142, a separate `next/` product pull request, before ticket 1140's protected execution work for https://github.com/kamp-us/tea-fabrika/pull/1497. It keeps the normal plan, tests, build and independent review steps. It is not lead tooling and does not use that fast track. Tracker 1142 was filed and read back through the existing app CLI. Ticket 1140 identifies the consuming work.

Read against main `f966dac3ad5d3b268e055bc6892674e23c15815e`. The approved 0580 plan, body `6d31e3a40575`, already assigns these three moves in its Files table. The approved execution amendment, body `1cb8a58fda04`, requires this separate preparation before the existing trusted runner can accept the consuming source's lock. This plan enables no law option, record API or plant-check gate.

```text
existing dev entries -> existing runtime entries -> pnpm-generated lock -> unchanged trusted lock equality
```

## Ground and the known way

The existing approved choice is to move `@effect/vitest`, `fast-check` and `vitest` from development dependencies to runtime dependencies. Keep `effect` where it is. Keep `@effect/platform-node`, the type packages and TypeScript where they are. Every specifier remains `catalog:`. Current resolved versions are `@effect/vitest` 4.1.3, fast-check 4.10.2 and Vitest 5.0.5; Effect 4.1.3 keeps main's existing patch.

npm distinguishes the dependencies a consumer needs from a package's own development tools. Here the consuming approved law implementation uses the three packages at runtime. Moving their declarations first does not expose that implementation. pnpm supports the same `catalog:` reference in both dependency fields, and its existing production deploy command supplies an isolated install without development dependencies. Sources, read November 17, 2026: [npm dependency fields](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#dependencies), [pnpm catalogs](https://pnpm.io/catalogs), [pnpm deploy](https://pnpm.io/cli/deploy). The pinned pnpm 12.16.1 help also confirms production deployment and frozen lock checking. No Elm machine, OTP process, service, schema or library patch changes here.

Settled searches used runtime/dependency/lock and package/dependencies/trusted preparation wording on the fetched main, read-only. Read 0255, 0580, 0584 and 0594, the approved plans, main's package and importer, and the existing strict source-version guard. Version declarations follow 0255. Resource checks follow 0584 and 0594.

## Shape

The only manifest change is the location of three existing entries. Sketch of the relevant fields:

```json
{
  "dependencies": {
    "@effect/vitest": "catalog:",
    "effect": "catalog:",
    "fast-check": "catalog:",
    "vitest": "catalog:"
  },
  "devDependencies": {
    "@effect/platform-node": "catalog:",
    "@types/node": "catalog:",
    "typescript": "catalog:"
  }
}
```

Keep main's description, `sideEffects: false`, root export, database subpath export, scripts, name, version and private flag exactly as they are. In particular, do not copy the consuming branch's `Law.ts` side-effect declaration or any new source export into this prep.

Regenerate the lock with pinned pnpm from current main and this exact proposed manifest. The intended semantic lock delta is only this package's importer grouping. Keep all resolved package versions, peer bindings, integrity values, catalogs, patch references and every other importer unchanged. pnpm 12's lock has a summary document and a full document; let pnpm maintain both. Never hand-edit a generated importer or copy the old job branch's whole lock. Unexpected resolution churn stops this slice for investigation.

No setting is added. Dependency classification is already decided. No new fact can be lost here: the old and new declarations and exact resolutions stay in Git, and each actual check records its source and result in its step row.

## One dependency traced through

Before prep, the trusted main package lists Vitest only as a development dependency. A production deployment of that package must not be allowed to borrow the workspace's development install. After prep, pnpm includes the existing locked Vitest package in the isolated deployed package, and Node resolves it from that package's own install. The consuming 0580 source can later merge this prep without retaining its dependency-only lock difference. The existing trusted runner still compares the complete two lockfiles byte for byte. Any other difference still refuses `source_versions_unsupported`.

## Existing tools

No new helper, source module, test file, dependency or workflow is proposed. Searched the approved plan, current package, lock, existing package laws and trusted runner. Reuse pinned pnpm's lock generation, frozen install and isolated production deployment, Node's module resolver, the existing package laws, and the existing trusted source-version refusal. A new JSON-key assertion would repeat the implementation and is not part of this plan.

## Checks and their witnesses

These are existing behavior checks and a one-time dependency-resolution witness, not new retained shape tests.

| Check | Kind | Generator | Plant |
|---|---|---|---|
| An isolated production deployment resolves all three packages from its own install without workspace development packages | test | scenario: the one approved package graph, because the package-manager boundary is the fact under test | use main's pre-prep development-only declarations in the disposable baseline |
| Existing depth, Recorder and Stub behaviors still pass | test | scenario: run the unchanged existing law files, because no new input or law is introduced; retain each generator and count | no new plant owed: no law body or product implementation changes |
| The existing source-version guard still rejects unequal complete lock bytes | test | scenario: run the existing in-memory setup-failure regression, including `source_versions_unsupported`; unchanged inputs and counts | no new plant owed: guard implementation and its laws remain unchanged |

For the resolution witness, the tests step uses a fresh disposable checkout and a deploy target outside the workspace, without an ambient `NODE_PATH`. Use pinned pnpm's existing `--filter=@kampus/vitest --prod deploy --offline --frozen-lockfile --ignore-scripts <owned-target>` operation. Use pinned pnpm 12.16.1 default deploy. The current official deploy documentation states that pnpm 12.2 removed the injection prerequisite and creates a dedicated deployment lock. A real legacy-mode baseline instead refused unused workspace patches before testing resolution. Drop only the obsolete legacy mode; retain all source patches and frozen checks. The failed command remains recorded and is not missing-module proof. Lifecycle scripts are excluded in both phases because this witness checks only dependency resolution, never native builds or module evaluation. From the deployed package directory, the pinned Node executable checks resolution of the three literal package names. Each resolved entry must belong to that isolated install; do not import Vitest outside its test context merely to check resolution. Record actual missing resolutions on the unmodified main baseline. After build, require all three resolutions. If the baseline already resolves all three, investigate the isolation before calling this a red/green witness; do not manufacture a missing-module result.

This bounded probe installs only cached packages into its own temporary folder. It runs directly under 0594 as an ordinary package-manager and resolution check. It starts no server, socket, Electron, launchd service or process-signal test, and imports none of the resolved modules. Keep HOME, unset the paid key and NODE_PATH, preserve existing installs and use the standard native runtime. A cache miss is a reported prerequisite, not permission to change versions or weaken frozen checks. No workflow or laptop guard override is added. Pinned pnpm 12.16.1 help confirms each option. This planning turn executes none of it.

## Files

The product change is exactly two paths. Other entries below are read-only checks or explicit holds, not construction scope.

| File | Owner | What changes | Product lines expected |
|---|---|---|---|
| `next/packages/vitest/package.json` | build | move the three existing entries; preserve all other main metadata | 6 |
| `pnpm-lock.yaml` | tests | pnpm-generated importer relocation, with all versions and other importers preserved | 20 |
| `next/packages/vitest/src/Depth.test.ts` | tests | read and run existing laws unchanged | 0 |
| `next/packages/vitest/src/Recorder.test.ts` | tests | read and run existing laws unchanged | 0 |
| `next/packages/vitest/src/Stub.test.ts` | tests | read and run existing laws unchanged | 0 |
| `.github/ci/plant.test.ts` | tests | read and run the existing in-memory guard/setup regression unchanged | 0 |
| `.github/ci/plant.ts` | tests | read only; complete lock equality and all refusal paths stay unchanged | 0 |
| `pnpm-workspace.yaml` | tests | read only; no catalog, pin, workspace or setting change | 0 |
| `layer-rules.json` | tests | held and unchanged; no waiver | 0 |

The lock is an exam path, so its generated change belongs to tests, not build. Standard plan and step records accompany the normal pipeline; they do not widen this product scope.

## Steps and validation

1. The lead reads this whole unsigned plan, verifies the separate tracker association and approves the already-decided scope. Each following step has its own agent. No prep construction starts before that approval.
2. Tests reads the existing package laws and cleanup, records their baseline, and records the isolated production-resolution baseline. It prepares the expected lock through pnpm in a disposable copy containing the approved prospective manifest, returns only the generated lock change, and leaves the actual product manifest for build. With that lock and the old actual manifest, pnpm's normal frozen check supplies a genuine manifest/lock mismatch before build. No ignored manifest check, trusted-lock shortcut, manual lock rewrite or new shape test is allowed.
3. Build moves only the three actual manifest entries. Run the normal frozen install, then require the isolated production-resolution witness to pass. Run the unchanged three package law files and the in-memory trusted-runner regression one file at a time, under nice 19 and one worker, with the paid key unset. Keep each existing input, assertion, count and timeout. Do not use a lock/package change's broad local `--changed` run. The coordinator reserves the one final compiler run, normal format/lint checks and required CI. A test or setup check that needs a real process or disk remains routed by its actual behavior.
4. A fresh reviewer reads both complete changed files, the generated-lock diff and actual check receipts. Confirm no API/source, export, side-effect flag, catalog, version, patch, other importer, guard or layer rule changed. Require the prep's own complete checks before the lead lands it. A red or missing check stays visible; no subset of green package laws proves a whole prep pull request.
5. Only after this prep lands, the consuming work merges main normally and obtains fresh exact-head proof. Verify the trusted and source complete lock bytes at the actual commits. Do not normalize, overlay, ignore or allow-list a remaining difference. This prep does not supply the protected fixture, nine plant records or whole-suite proof. P25 keeps its own dependency/lock work separate.

## Size

1. One dependency-only product pull request, about 26 lines in two changed files, plus normal plan and step records. It keeps the full tests/build/review sequence. About 0.5 to 1 agent hour; no new source code. Size confidence 80%, because lock generation may reveal peer-resolution churn that must be investigated rather than accepted.

Budget proxy: the recorded tests/build/review list prices in `field/runs/2026-11-13-layering-s1-tests2.json`, `field/runs/2026-11-13-ciflake-build3.json` and `field/runs/2026-11-13-ciflake-review2.json` total about $8.13. These are cross-task step costs, not measured dependency-prep costs; round up for this small slice.

Estimate: 3 steps, $9

## Records

Keep the approved prep plan and normal tests/build/review run rows. The tests receipt records the exact current-main base, proposed manifest and generated lock hashes, actual baseline resolution failures and existing-law results. Build records the final source, frozen-install result, isolated resolution paths and cleanup. Review records its actual verdict. No observation is inferred from a badge or the consuming PR.

## What this cannot tell

No check ran in this planning turn. This plan cannot establish a successful production install, equal future trusted/source locks, the protected fixture, nine plant records, whole-suite proof or readiness of the consuming PR. It gives no permission to change the held layer rule or strict version guard.

## Open questions

None.

Before tests starts, the lead supplies the verified prep ticket and exact current-main base. Those are work assignments, not a new design choice.
