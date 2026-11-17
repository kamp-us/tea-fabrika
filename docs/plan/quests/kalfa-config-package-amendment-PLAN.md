Approved by the lead agent, builds 0585, 0556, 0086, 0032, 0579 and 0594; body cb6da618dad1
Plancheck-Version: 3

# Plan amendment: make slice 2 installable as a private config tarball

Ticket 1076, slice 2, our tooling under `kalfa/config/`, used by `next/`.
This adds the packaging and consumer proof needed to use `@kalfa/config` in another project.
It amends the approved `docs/plan/quests/kalfa-config-PLAN.md`, body `317fe648c7e8`, and keeps
`docs/plan/quests/kalfa-config-repair-PLAN.md`, body `79cc605e5cae`, in force.
The extraction changes no settings behavior. Slice 3's commands stay separate.

```jsonc
// Sketch of the split already used by packages/fabrika/package.json.
{
  "name": "@kalfa/config",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "files": ["dist", "!dist/.rsbuild"],
  "exports": { "./App": "./src/App.ts", "./internal/*": null },
  "publishConfig": {
    "exports": {
      "./App": { "types": "./dist/App.d.ts", "default": "./dist/App.js" },
      "./internal/*": null
    }
  }
}
```

## Scope and prerequisites

The owned branch is `fabrikalfa/kalfa-config-package`, in `../tf-kalfa-config-package`.
Its baseline is the clean assembly `54de66b6b0f2ba48154108699f4c2ec635eee899`. It joins retained
lead head `21e896a981807b7eebbca0484038a7e854748e9e` above
[slice 1](https://github.com/kamp-us/tea-fabrika/pull/1427) with the coupled
[spacing change](https://github.com/kamp-us/tea-fabrika/pull/1525) at
`b93fb66d5f16ffe6935fd98960b3838f1d4eff77`. Preserve its spacing,
law bodies, assertions and configuration. Do not modify either prerequisite branch.
This slice lands after both prerequisite pull requests, not as a third queued layer.

The separate CI repair pair,
[1543](https://github.com/kamp-us/tea-fabrika/pull/1543) then
[1581](https://github.com/kamp-us/tea-fabrika/pull/1581), owns the active CI files. This plan gives
the needed follow-up edits below, but no step edits those files while that owner is active.
Author the package and nonconflicting tests now. Join the landed CI repair when available and
apply only this slice's package discovery and delivery additions before final review.

## How others do it

Elm and OTP need no new machine here. S6 loads settings at the program's edge, and this slice
changes where the existing modules are installed.

The known packaging path is already in `packages/fabrika/package.json`, its `rslib.config.ts`,
`tsconfig.build.json` and `pnpm-only.ts`. Source imports serve the workspace. `pnpm pack` substitutes
`publishConfig.exports`, whose targets are compiled ESM and declarations. npm does not make this
substitution, so the source package rejects packing with npm. The resulting archive installs with
npm. `experiments/108-install-from-a-tarball.md` records that approach; its older measurements are
not proof for this package. The new consumer law supplies current proof.

Read versions are rslib 1.0.5, Effect and `@effect/vitest` 4.1.3, TypeScript 7.0.2, Vitest 5.0.5,
toml-eslint-parser 1.0.3 and toml-patch 3.3.2. Reuse those installed versions. No package is patched.
The installed Effect `AGENTS.md` was read. Decisions 0556 and 0585 keep the package private;
registry publication, licensing and a release service are outside this slice.

## Exact moves

Each row is a `git mv`. Apart from module specifiers, keep every body and every law unchanged.
The original plan's exact service-key change from `@kampus/libfabrika/settings/Toml` to
`@kalfa/config/Toml` is the only additional product-text change in the moved engine.
The lead compares that one string separately; it is not permission to rewrite the file.

| File | Owner | Product lines expected | Destination |
|---|---|---|---|
| next/packages/libfabrika/src/settings/App.ts | build | moved | kalfa/config/src/App.ts |
| next/packages/libfabrika/src/settings/Setting.ts | build | moved | kalfa/config/src/Setting.ts |
| next/packages/libfabrika/src/settings/Sources.ts | build | moved | kalfa/config/src/Sources.ts |
| next/packages/libfabrika/src/settings/Toml.ts | build | moved | kalfa/config/src/Toml.ts |
| next/packages/libfabrika/src/settings/TomlParser.ts | build | moved | kalfa/config/src/TomlParser.ts |
| next/packages/libfabrika/src/settings/internal/edit.ts | build | moved | kalfa/config/src/internal/edit.ts |
| next/packages/libfabrika/src/settings/Codec.ts | build | moved | kalfa/config/src/Codec.ts |
| next/packages/libfabrika/src/settings/Files.ts | build | moved | kalfa/config/src/Files.ts |
| next/packages/libfabrika/src/settings/JsonSchema.ts | build | moved | kalfa/config/src/JsonSchema.ts |
| next/packages/libfabrika/src/settings/Reference.ts | build | moved | kalfa/config/src/Reference.ts |
| next/packages/libfabrika/src/settings/Print.ts | build | moved | kalfa/config/src/Print.ts |
| next/packages/libfabrika/src/settings/Snapshot.ts | build | moved | kalfa/config/src/Snapshot.ts |
| next/packages/libfabrika/src/settings/Load.ts | build | moved | kalfa/config/src/Load.ts |
| next/packages/libfabrika/src/settings/App.test.ts | tests | tests | kalfa/config/src/App.test.ts |
| next/packages/libfabrika/src/settings/TomlParser.test.ts | tests | tests | kalfa/config/src/TomlParser.test.ts |
| next/packages/libfabrika/src/settings/Toml.types.test.ts | tests | tests | kalfa/config/src/Toml.types.test.ts |

The destination files have the same owners as their source rows. The tests writer owns both ends
of each test move. The 13 product modules go in one package because they implement one settings
engine. `Fabrika`, declarations, starts, recorded starts and fabrika's node loader/command remain
in libfabrika. The existing repaired App laws retain all sizes, counts, seeds, examples and plants.
The older parser laws are moved as they are, not converted or narrowed in this slice.

## Package and consumer shape

List these 12 public subpaths explicitly in both export maps: `App`, `Setting`, `Sources`, `Toml`,
`TomlParser`, `Codec`, `Files`, `JsonSchema`, `Reference`, `Print`, `Snapshot` and `Load`.
Use `./src/<name>.ts` in the workspace, and a `types`/`default` pair pointing to
`./dist/<name>.d.ts` and `./dist/<name>.js` in the packed map. `./package.json` may expose package
metadata. There is no root barrel, `./cli` or `Kalfa` export in this slice. Do not export a test,
fixture or `internal/` path. Explicit subpaths prevent the original sketch's wildcard from making
`App.test` public. Internal compiled files remain in `dist/` for the parser to load.

The package stays `private: true`, version `0.0.0`, ESM, and Node `>=26`, matching the existing
tarball path. The archive keeps `private: true` too; private prevents registry publication, not
installation from an archive. Do not add a license value that the owner has not chosen.

- Runtime dependencies are `toml-eslint-parser: catalog:` and `@decimalturn/toml-patch: 3.3.2`.
- `effect: catalog:` is a peer and a development dependency, resolving to 4.1.3, as in experiment
  108's existing library package. It remains external to the build, so the client supplies the
  same Effect services and types.
- Development dependencies are `@rslib/core`, `@effect/platform-node`, `@effect/vitest`, `effect`,
  `fast-check`, `@types/node`, `typescript` and `vitest` through the existing catalog, plus
  `@kampus/vitest: workspace:*`. No runtime dependency names fabrika, a workspace package or
  a repository path.
- The original plan explicitly keeps the test-toolbox move later. M2 therefore bans product
  dependencies from runtime modules and the shipped archive; the existing `@kampus/vitest`
  imports in tests remain a development-only exception. This does not grant a runtime exception.
- Libfabrika adds `@kalfa/config: workspace:*` and removes both TOML runtime dependencies. Any
  app that now imports the package directly declares that dependency directly too.
- The root adds `@kalfa/config: workspace:*` as a development dependency. Its new public-import
  law is a real tooling consumer. This also reaches the package under the existing
  workspace-reach rule, which deliberately excludes `next/`; do not change that exclusion.

Use rslib's existing bundleless ESM/declaration configuration, limited to product source files.
Exclude tests and test support from the build. The package has `build`, `prepack` and `typecheck`
scripts. `prepack` first checks pnpm, then builds. Its small `Pnpm.ts` follows the existing guard,
but lives with this package so packing has no path into today's product. It uses no secrets.
No installed consumer needs build tooling. The compiler settings retain every inherited rule that
currently governs the moved settings code; translating globs must not remove checks or enable a
stronger unfinished sweep by accident.

## One value traced

1. CI packs the package with pnpm into a temporary output directory. It records the archive digest,
   source commit and packed manifest. No registry write happens.
2. A new project outside the workspace installs that archive with npm and Effect 4.1.3. It has no
   workspace links, source path aliases, test toolbox or fabrika package.
3. It imports `App` from `@kalfa/config/App`, declares an app named `demo`, and declares
   `service.port` with the existing `Setting.make` options and a default.
4. It loads its own TOML/env/flag inputs through the public modules. The chosen value and origin
   match the declaration; unrelated app inputs stay out. It exercises the shipped parser adapter,
   not a fixture parser.
5. Node loads every public runtime subpath from `.js`. The installed TypeScript checks the same
   consumer against `.d.ts` with `skipLibCheck: false`. An import of `internal/edit` or `App.test`
   fails as an unexported path. The runtime/type results refer to the same archive digest.
6. CI retains that exact archive and a small source/digest receipt. Another project installs the
   downloaded `kalfa-config-0.0.0.tgz`, then imports `@kalfa/config/App`. No CLI is promised yet.

## Laws

F1/F2 and repaired K1 to K5 remain the original plan's laws. M1 keeps the pure-move comparison,
with the exact service-key change separately read. M2 keeps runtime product isolation and permits
only the original test-only toolbox exception. These additions prove the installed boundary.

| Law | Kind | Generator | Plant | Where |
|---|---|---|---|---|
| P1, root tooling consumes the package through public names. Generated app names and declared values resolve through the new package, with correct own-app origin and defaults. Keep 25 fast and 100 full runs, size 100 and shared seed setup. | test | Effect Arbitrary: ConsumerCase | Point the package App export at a missing module or retain a fabrika-only environment prefix: the public-import load fails. | scripts/kalfa-config.test.ts |
| P2, a freshly installed archive works outside the workspace. The same archive supports the runtime flow, every public runtime import, a complete consumer typecheck with skipLibCheck false, and refusal of private/test subpaths. No workspace dependency or source export remains in its packed dependency/export maps. | test | scenario: one real build-pack-install-runtime-typecheck lifecycle; an in-memory package map cannot prove installed Node or compiler resolution | Leave source TypeScript in a packed public export, omit parser output, omit declarations, or retain a workspace runtime dependency: the corresponding consumer stage fails. | kalfa/config/src/Package.integration.test.ts |
| P3, runtime modules cannot import the product, its test toolbox or another workspace package. The development-only toolbox is permitted only in tests, not in runtime outputs. | lint | lint | Import libfabrika or @kampus/vitest from a runtime config module: the existing restricted-import mechanism fails. | .oxlintrc.json |
| P4, automatic changed/related CI selects the new package's unit and real consumer laws and retains the exact tested archive with its source/digest receipt, using the current shared slots and result accounting. | test | scenario: the package's changed paths and one archive produced by the existing automatic related job | Omit kalfa test discovery, drop the consumer file from selection, or upload a different archive: required selection/digest comparison fails. | .github/ci/related-selection.test.ts |

P2 is an integration law because it builds, writes files, starts package managers and a compiler,
and verifies a real installation. A stand-in would miss broken exports, missing output files and
workspace dependencies. It runs only in eligible CI. Build/install once per lifecycle; generated
configuration coverage stays in P1 and the existing App laws. Reuse one scoped package build and installation across its consumer stages. Do not repeat installs
per generated case. Keep current test/file/job timeouts. No workload, skip or existing assertion is lowered. Plants run only in CI through the existing eligible mechanism;
the source reviewer may describe their reach but must not claim an unrun plant passed.

## Files

The exact moves above also form the Files table for both ends. The following rows add ownership
or clarify import followers. Old tests change module specifiers only; preserve their bodies.

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/config/src/App.ts | build | moved | Exact destination in the moves table. |
| kalfa/config/src/Setting.ts | build | moved | Exact destination in the moves table. |
| kalfa/config/src/Sources.ts | build | moved | Exact destination in the moves table. |
| kalfa/config/src/Toml.ts | build | moved | Exact destination in the moves table. |
| kalfa/config/src/TomlParser.ts | build | moved | Exact destination in the moves table. |
| kalfa/config/src/Codec.ts | build | moved | Exact destination in the moves table. |
| kalfa/config/src/Files.ts | build | moved | Exact destination in the moves table. |
| kalfa/config/src/JsonSchema.ts | build | moved | Exact destination in the moves table. |
| kalfa/config/src/Reference.ts | build | moved | Exact destination in the moves table. |
| kalfa/config/src/Print.ts | build | moved | Exact destination in the moves table. |
| kalfa/config/src/Snapshot.ts | build | moved | Exact destination in the moves table. |
| kalfa/config/src/Load.ts | build | moved | Exact destination in the moves table. |
| kalfa/config/src/internal/edit.ts | build | moved | Exact destination in the moves table. |
| kalfa/config/src/App.test.ts | tests | tests | Exact destination; preserve the full existing law body. |
| kalfa/config/src/TomlParser.test.ts | tests | tests | Exact destination; preserve the full existing law body. |
| kalfa/config/src/Toml.types.test.ts | tests | tests | Exact destination; preserve the full existing law body. |
| kalfa/config/package.json | tests | tests | Initial package skeleton only. The lead must approve the ownership transfer below before build fills the runtime/export fields. |
| kalfa/config/rslib.config.ts | build | 20 | Existing bundleless ESM/declaration build pattern, product entries only. |
| kalfa/config/Pnpm.ts | build | 15 | Package-local pnpm packing guard. |
| kalfa/config/README.md | build | docs | How to install the tested archive and use existing public App/Load APIs. |
| kalfa/config/tsconfig.json | tests | tests | Same governing compiler rules as the moved engine, with translated paths. |
| kalfa/config/tsconfig.build.json | tests | tests | Emit declarations/JavaScript; exclude test/support source. |
| kalfa/config/src/Package.integration.test.ts | tests | tests | P2 and its scoped build/consumer lifecycle, using Effect platform services. |
| kalfa/config/test/consumer.mjs | tests | tests | Installed runtime client; never shipped. |
| kalfa/config/test/consumer.ts | tests | tests | Installed type client; never shipped. |
| scripts/kalfa-config.test.ts | tests | tests | P1, actual root tooling import of the package name. |
| package.json | tests | tests | Add real root tooling consumer dependency. Existing build targets remain. |
| pnpm-workspace.yaml | tests | tests | Add kalfa/*, no version/catalog changes. |
| pnpm-lock.yaml | tests | tests | Resolve the new package and moved dependency declarations. |
| tsconfig.base.json | tests | tests | Translate governing next-only rule globs to cover kalfa without dropping checks. |
| vitest.config.ts | tests | tests | Discover kalfa ordinary/integration tests in the existing projects; exclude dist. |
| exam-paths.json | tests | tests | Add kalfa exam globs, package compiler/build config and test fixtures. |
| layer-rules.json | tests | tests | Place moved modules and package consumers; preserve all existing import limits. |
| boundary-rules.json | tests | tests | Recognize config as independent tooling, used by existing consumers, with no product runtime edge. |
| .oxlintrc.json | tests | tests | Carry applicable next rules to kalfa; preserve parser-adapter restriction and runtime isolation. |
| next/packages/libfabrika/package.json | build | 4 | Add config dependency, drop parser/serializer, remove moved engine exports. |
| next/apps/fabrika/package.json | build | 1 | Declare config directly when its source imports it. |
| next/packages/libfabrika/src/index.ts | build | 3 | Follow moved module exports without inventing a new API. |
| next/packages/libfabrika/src/settings/Fabrika.ts | build | 3 | Bind the package's existing functions to fabrika. |
| next/packages/libfabrika/src/settings/Declarations.ts | build | 1 | Follow the moved Setting type import; keep declarations unchanged. |
| next/packages/libfabrika/src/settings/Start.ts | build | 1 | Snapshot import only. |
| next/packages/libfabrika/src/settings/RecordedStart.ts | build | 1 | Snapshot type import only. |
| next/packages/libfabrika/src/settings/StartsTest.ts | tests | tests | Imports only. |
| next/packages/libfabrika/src/settings/Codec.test.ts | tests | tests | Imports only. |
| next/packages/libfabrika/src/settings/DesktopBrain.test.ts | tests | tests | Imports only. |
| next/packages/libfabrika/src/settings/DesktopLink.test.ts | tests | tests | Imports only. |
| next/packages/libfabrika/src/settings/ErrorCause.test.ts | tests | tests | Imports only. |
| next/packages/libfabrika/src/settings/Files.test.ts | tests | tests | Imports only; preserve repaired exact app field. |
| next/packages/libfabrika/src/settings/JsonSchema.test.ts | tests | tests | Imports only. |
| next/packages/libfabrika/src/settings/Mail.test.ts | tests | tests | Imports only. |
| next/packages/libfabrika/src/settings/Print.test.ts | tests | tests | Imports only. |
| next/packages/libfabrika/src/settings/QuotaSettings.test.ts | tests | tests | Imports only. |
| next/packages/libfabrika/src/settings/Reference.test.ts | tests | tests | Imports only. |
| next/packages/libfabrika/src/settings/Setting.test.ts | tests | tests | Imports only. |
| next/packages/libfabrika/src/settings/Snapshot.test.ts | tests | tests | Imports only. |
| next/packages/libfabrika/src/settings/Sources.test.ts | tests | tests | Imports only. |
| next/packages/libfabrika/src/settings/Start.test.ts | tests | tests | Follow the dynamic Snapshot type specifier only. |
| next/packages/libfabrika/src/settings/TomlEdit.test.ts | tests | tests | Imports only. |
| next/packages/libfabrika/src/cloudflare/QuotaSettings.ts | build | 1 | Imports only. |
| next/packages/libfabrika/src/cloudflare/SettingsInput.ts | build | 2 | Imports only. |
| next/packages/libfabrika/src/cloudflare/quotas.test.ts | tests | tests | Imports only. |
| next/packages/libfabrika/src/desktop/BrainLife.ts | build | 1 | Imports only. |
| next/packages/libfabrika/src/desktop/BrainServiceManaged.ts | build | 1 | Imports only. |
| next/packages/libfabrika/src/desktop/BrainServiceTest.ts | tests | tests | Imports only. |
| next/packages/libfabrika/src/node/launchd/BrainControlLaunchd.ts | build | 1 | Imports only. |
| next/packages/libfabrika/src/node/launchd/BrainServiceLaunchd.ts | build | 1 | Imports only. |
| next/packages/libfabrika/src/node/repositories/OpenRepository.ts | build | 2 | Imports only. |
| next/packages/libfabrika/src/node/repositories/OpenRepository.composed.integration.test.ts | tests | tests | Imports only. |
| next/packages/libfabrika/src/node/repositories/RepositoriesGit.ts | build | 1 | Imports only when the integrated source has this follower. |
| next/packages/libfabrika/src/node/repositories/Sources.integration.test.ts | tests | tests | Imports only when the integrated source has this follower. |
| next/packages/libfabrika/src/node/settings/Load.ts | build | 4 | Follow package file/resolve/version helpers; preserve wrapper API and repo minimum context. |
| next/packages/libfabrika/src/node/settings/Command.ts | build | 3 | Imports only. |
| next/packages/libfabrika/src/node/settings/Command.test.ts | tests | tests | Imports only. |
| next/packages/libfabrika/src/node/settings/Load.integration.test.ts | tests | tests | Imports only. |
| next/packages/libfabrika/src/node/settings/RepositoryOpenTest.ts | tests | tests | Imports only. |
| next/packages/libfabrika/src/packs/RepositoryTrust.ts | build | 1 | Imports only. |
| next/packages/libfabrika/src/packs/RepositoryTrustLedger.ts | build | 1 | Imports only. |
| next/packages/libfabrika/src/packs/RepositoryTrustTest.ts | tests | tests | Imports only. |
| next/packages/libfabrika/src/packs/internal/open.ts | build | 1 | Imports only. |
| next/apps/fabrika/cli.ts | build | 1 | Imports only. |
| next/apps/fabrika/dev.ts | build | 1 | Imports only. |
| next/apps/fabrika/hands.ts | build | 1 | Imports only. |
| next/apps/fabrika/settings-generate.ts | build | 3 | Imports only, generated output unchanged. |
| next/apps/fabrika/e2e/node/P19Launchd.test-support.ts | tests | tests | Imports only. |
| next/apps/fabrika/src/exam/layers.integration.test.ts | tests | tests | Imports only if its settings reference is a module specifier; retain graph assertions. |
| next/apps/fabrika/src/settings-generated.integration.test.ts | tests | tests | Translate imports, the ADAPTER module-location literal to kalfa/config/src/TomlParser.ts and the generated public specifier to @kalfa/config/TomlParser only; preserve every assertion, generator, count and parser restriction. |
| next/apps/fabrika/src/settings-start.integration.test.ts | tests | tests | Imports only. |
| next/apps/fabrika/src/worker-mail.integration.test.ts | tests | tests | Imports only. |
| .github/ci/changes.mjs | tests | tests | Deferred until CI owner's repair lands: recognize package paths without narrowing current selection. |
| .github/ci/related.ts | tests | tests | Deferred: include package integration in existing automatic related selection and result accounting. |
| .github/ci/related-selection.test.ts | tests | tests | Deferred: P4 regression coverage, preserving the existing suite. |
| .github/workflows/check.yaml | tests | tests | Deferred: existing related job retains only the consumer law's tested archive and receipt, with existing slots and failure rules. |
| .github/ci/workflow-lint/related.ts | tests | tests | Deferred: extend exact guard for the one bounded archive upload, preserving all current checks. |
| .github/ci/workflow-lint/related.test.ts | tests | tests | Deferred: prove upload requires successful consumer proof and same archive digest/head. |
| .glossary/TERMS.md | build | docs | Existing setting/scope rows name the extracted package. |
| docs/direction/settings.md | build | docs | Engine location line only. |
| docs/plan/README.md | lead | docs | After active CI owner is done, record this slice's actual state. |
| docs/plan/quests/kalfa-config-package-amendment-PLAN.md | lead | docs | Save the approved amendment. |

The tests step creates the bare package manifest first, with its name, version, private/module
identity and test scaffolding. Ownership is per path, not per field. Before the builder changes
any runtime dependency, build script or export in that file, the lead changes this one ownership
row from `tests` to `build`, reads the amendment and re-signs its digest. Neither step may claim
shared ownership. The scaffold remains in history and the builder starts from its exact head.

The moves table is saved privately for the existing move checker and review. The explicit destination rows above give both ends their owners; only the lead approves an amendment. A newly discovered
import follower is recorded with its exact path before a step edits it; it grants imports only.

## Existing tools

- Searched the retained slice-1 engine, which is ahead of main: `next/packages/libfabrika/src/settings/App.ts`, `next/packages/libfabrika/src/settings/Fabrika.ts` and `next/packages/libfabrika/src/settings/Load.ts` already exist at this slice's baseline; they add no helper here.

- Searched the existing engine. These are pure moves of the same modules, not new helpers: `kalfa/config/src/App.ts`, `kalfa/config/src/Setting.ts`, `kalfa/config/src/Sources.ts`, `kalfa/config/src/Toml.ts`, `kalfa/config/src/TomlParser.ts`, `kalfa/config/src/internal/edit.ts`, `kalfa/config/src/Codec.ts`, `kalfa/config/src/Files.ts`, `kalfa/config/src/JsonSchema.ts`, `kalfa/config/src/Reference.ts`, `kalfa/config/src/Print.ts`, `kalfa/config/src/Snapshot.ts`, `kalfa/config/src/Load.ts`.

- `kalfa/config/rslib.config.ts`: searched the installed rslib 1.0.5 package and the repo's
  existing rslib configs. Reuse `defineConfig` and the bundleless ESM/declaration shape.
- `kalfa/config/Pnpm.ts`: searched `packages/fabrika/pnpm-only.ts` and workspace scripts. That
  guard has the required behavior but is private product tooling; a package-local guard avoids
  making this tooling package call today's product by path. No new packing framework is needed.
- `kalfa/config/src/Package.integration.test.ts`: searched existing build integration laws,
  Effect FileSystem/Path/ChildProcess services and experiment 108. Reuse scoped resources and
  platform services; no new process runner or cleanup hook.
- `scripts/kalfa-config.test.ts`: searched the repaired App laws and existing schemas. Use the
  same supported property runner and declaration options through public package imports.
- Consumer fixture files use Node ESM, npm installation and the installed TypeScript compiler.
  They are inputs to P2, not new production APIs or custom validators.
- The existing move checker and restricted-import mechanisms cover M1/M2. A real tarball
  lifecycle supplies the evidence those structural tools cannot provide.

## Calls taken

- Use the existing pnpm tarball/dist path, with no registry write. Confidence 95%. It gives another
  project an installable file now while honoring the private-package decision. Its cost is a
  downloaded archive rather than a registry version.
- Export an explicit list of 12 modules. Confidence 99%. It exposes the approved engine while
  keeping tests/private edits outside the package API. App.Name stays private.
- Effect is the single peer, with the same version used for development. Confidence 95%. Client
  and package then share service identities and types, as the existing library packaging does.
- Keep @kampus/vitest development-only. Confidence 100%. The original approved plan explicitly
  leaves its rename to a later package move.
- Use a genuine root public-import law and root development dependency. Confidence 95%. It is a
  real tooling consumer and preserves workspace-reach's existing rule, without an exception.
- Is this a setting? No. Module exports, dependency roles and distribution format are package
  contracts; this introduces no product choice, settings default, process state or runtime fact.

## Validation and delivery

Only CI runs product tests, test listing, compiler/typecheck, lint, plants, package build and
consumer installation. Use automatic changed/related PR and protected queue CI, not an extra
manually dispatched proof copy. The clarified authoring safeguards permit read-only plan parsing, ownership/digest checks, git
metadata, leak checks and the commit helper's formatting guard. This is a correction to the
coordination handoff, not a new owner ruling. Those structural operations are not runtime proof.

The existing check workflow runs root `pnpm build` only for today's build flag. A config move does
not reliably set that flag. P2 therefore builds/packs the package in its own selected integration
lifecycle, rather than pretending the root build covers it. The automatic route must discover
P2 after kalfa is added to the existing integration project. No extra job, runner pool or slot is
created. The existing related job uploads only its tested archive and receipt after success.
The workflow edit and its exact guard wait for the active CI owner to finish first.

P2 writes `kalfa-config-0.0.0.tgz` and `receipt.json` under the existing job's
`$RUNNER_TEMP/kalfa-config-package/`. That is the upload's complete path set. A scoped staging
folder is cleaned after the two successful outputs are copied there. The workflow guard checks
these exact two paths; no wildcard includes unrelated files. The receipt records the actual
checked-out source commit and the requested PR/queue head separately, so a synthetic merge is
never mislabeled as the branch head.

The receipt also names archive digest, Node/package-manager/compiler versions, the
packed public exports and each consumer stage's result. Archive upload is delivery, not registry
publication. The final report links the actual successful run and archive, separates source-ready
from CI-running and merged, and supplies the install command for the verified file. Registry
release remains a later decision if requested; it does not block tarball use in another project.

## Size

1. Slice 2 remains one complete extraction, about 145 lines of new product code for packaging,
   bindings and import followers, plus about 2,200 moved lines, test ownership/configuration and the
   consumer laws. No engine rewrite or CLI is included.

About 3 agent hours, 75% confidence. The uncertainty is CI route integration after its active
repair, not the engine move. The original plan's roughly $5 per step basis gives tests, build,
review and one possible fix round. No paid service or registry account is introduced.

Estimate: 4 steps, $20

## Records

Save the exact baseline, source/destination map, old/new test mapping and independent step rows.
Keep prior slice-1 evidence and old plants unchanged. Record newly executed consumer/plant
results with their exact head; a structural read cannot be recorded as a runtime pass.
Lost without the receipt: which compiled archive the consumer actually installed. Record the
archive hash and source commit when that file is made. No settings data or secret is added.

## What this cannot tell us

This read-only plan proves no package build, consumer install, compiler result or CI run. It does
not establish a license, registry release, credentials or a new release service. The current
automatic CI repair must land before final route/delivery edits and proof are available.

## Open questions

None.

The prerequisite landing and active CI owner's files are execution dependencies, not new owner design calls.

## Findings

None.
