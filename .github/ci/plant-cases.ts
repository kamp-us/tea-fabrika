// Today's lead tooling. Each case fixes its source, selected law and sole temporary edit.
import { Effect, RegExp as Regex, Schema } from "effect";

export const Request = Schema.Struct({
  case: Schema.Literals([
    "checklist-pid",
    "watcher-r1",
    "host-pin",
    "host-discovery-timeout",
    "host-requested-pin",
    "host-pnpm-path",
    "host-env-order",
    "checklist-body",
    "checklist-drop-notify",
    "checklist-early-complete",
    "checklist-held-call",
    "checklist-due-reschedule",
    "checklist-running-replace",
    "checklist-running-delete",
    "checklist-alarm-failure",
    "checklist-late-failure",
  ]),
  sha: Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/)),
}).check(
  Schema.makeFilter((request) => {
    const selected = cases[request.case];

    return !("source" in selected) || request.sha === selected.source;
  }),
);

export type Request = typeof Request.Type;

export const cases = {
  "checklist-pid": {
    project: "next-integration",
    file: "next/packages/libfabrika/src/cloudflare/runtime.ts",
    test: "next/apps/fabrika/src/checklist-instance.laws.integration.test.ts",
    title:
      "L13: notices name their process each view.whole and view.patch for checklist:1 carries its pid and the update its Process published",
    selector:
      "L13: notices name their process > each view.whole and view.patch for checklist:1 carries its pid and the update its Process published",
    before: "p.publish(client, { ...update, pid: active })",
    after: "p.publish(client, { ...update })",
  },
  "watcher-r1": {
    project: "next-integration",
    file: "next/packages/libfabrika/src/node/dev/watch.laws.integration.test.ts",
    test: "next/packages/libfabrika/src/node/dev/watch.laws.integration.test.ts",
    title:
      "P15 slice 1: the watcher scenario: R1 a held same reply from boot or a preceding save cannot complete a good or broken save",
    selector:
      "P15 slice 1: the watcher > scenario: R1 a held same reply from boot or a preceding save cannot complete a good or broken save",
    before: "        if (same) {\n          yield* duplicate(answer);",
    after:
      '        if (same) {\n          expect(answer).toMatchObject(syntax ? { _tag: "failed", reason: "bundle" } : { _tag: "loaded" });\n          yield* duplicate(answer);',
  },
  "host-pin": {
    project: "tooling",
    file: ".agents/skills/lead/scripts/flow/host.ts",
    test: ".agents/skills/lead/scripts/flow/host.test.ts",
    title:
      "the host step's outcomes scenario: an explicit pin keeps direct and nested pnpm on that Node, even when the manifest differs",
    selector:
      "the host step's outcomes > scenario: an explicit pin keeps direct and nested pnpm on that Node, even when the manifest differs",
    before: "node === null ? Effect.succeed(env) : boxEnv(dir, { ...process.env, ...env }, node)",
    after: "node === null ? Effect.succeed(env) : Effect.succeed({ ...process.env, ...env })",
  },
  "host-discovery-timeout": {
    project: "tooling",
    file: ".agents/skills/lead/scripts/flow/host.ts",
    test: ".agents/skills/lead/scripts/flow/host.test.ts",
    title:
      "the host step's outcomes scenario: stalled runtime discovery shares the first command's deadline and is reaped before returning",
    selector:
      "the host step's outcomes > scenario: stalled runtime discovery shares the first command's deadline and is reaped before returning",
    before: `  const childEnv = yield* Effect.cached(
    node === null ? Effect.succeed(env) : boxEnv(dir, { ...process.env, ...env }, node),
  );

  for (const line of lines) {
    const ended = yield* childEnv.pipe(
      Effect.flatMap((prepared) => runLine(dir, line, prepared, log)),
      Effect.timeoutOption(Duration.minutes(minutes)),
    );`,
    after: `  const childEnv = node === null ? env : yield* boxEnv(dir, { ...process.env, ...env }, node);

  for (const line of lines) {
    const ended = yield* runLine(dir, line, childEnv, log).pipe(
      Effect.timeoutOption(Duration.minutes(minutes)),
    );`,
  },
  "host-requested-pin": {
    project: "tooling",
    file: ".agents/skills/lead/scripts/boxnode.ts",
    test: ".agents/skills/lead/scripts/flow/host.test.ts",
    title:
      "the host step's outcomes scenario: an explicit pin keeps direct and nested pnpm on that Node, even when the manifest differs",
    selector:
      "the host step's outcomes > scenario: an explicit pin keeps direct and nested pnpm on that Node, even when the manifest differs",
    before: "    const pin = requested ?? (yield* repoNode(main));",
    after: "    const pin = yield* repoNode(main);",
  },
  "host-pnpm-path": {
    project: "tooling",
    file: ".agents/skills/lead/scripts/boxnode.ts",
    test: ".agents/skills/lead/scripts/flow/host.test.ts",
    title:
      "the host step's outcomes scenario: an explicit pin keeps direct and nested pnpm on that Node, even when the manifest differs",
    selector:
      "the host step's outcomes > scenario: an explicit pin keeps direct and nested pnpm on that Node, even when the manifest differs",
    before: '    return { ...parent, PATH: firstOnPath(parent.PATH ?? "", pnpm === null ? [node] : [node, pnpm]) };',
    after: '    return { ...parent, PATH: firstOnPath(parent.PATH ?? "", [node]) };',
  },
  "host-env-order": {
    project: "tooling",
    file: ".agents/skills/lead/scripts/flow/host.ts",
    test: ".agents/skills/lead/scripts/flow/host.test.ts",
    title:
      "the host step's outcomes scenario: an explicit pin keeps direct and nested pnpm on that Node, even when the manifest differs",
    selector:
      "the host step's outcomes > scenario: an explicit pin keeps direct and nested pnpm on that Node, even when the manifest differs",
    before: "    node === null ? Effect.succeed(env) : boxEnv(dir, { ...process.env, ...env }, node),",
    after: "    node === null ? Effect.succeed(env) : boxEnv(dir, { ...env, ...process.env }, node),",
  },
  "checklist-body": {
    project: "next-integration",
    file: "next/apps/fabrika/src/checklist-instance.laws.integration.test.ts",
    test: "next/apps/fabrika/src/checklist-instance.laws.integration.test.ts",
    title:
      "L13: notices name their process each view.whole and view.patch for checklist:1 carries its pid and the update its Process published",
    selector:
      "L13: notices name their process > each view.whole and view.patch for checklist:1 carries its pid and the update its Process published",
    source: "a062f7a2515aa1917dfae05d3af95e3705b88812",
    before: "              heard.push({ client, news: structuredClone(news) });",
    after:
      "              const delivered = News.guards.view(news) ? { ...news, update: { ...news.update, rev: -1 } } : news;\n              heard.push({ client, news: structuredClone(delivered) });",
    preparation: [],
    hashes: {
      source: "08a5cfd7af599b98e3a68c887328f5d2462f455c9e19aefe2258e5766a03f50f",
      prepared: "08a5cfd7af599b98e3a68c887328f5d2462f455c9e19aefe2258e5766a03f50f",
      edited: "061a14624cb441a033477a741668f2e46d8d87ab64ff670b3bfa486f9564c8ee",
    },
    failures: [
      {
        diagnostic: "AssertionError: the update its Process published reached the client unchanged",
        line: 830,
        column: 99,
      },
    ],
  },
  "checklist-drop-notify": {
    project: "next-integration",
    file: "next/apps/fabrika/src/checklist-instance.laws.integration.test.ts",
    test: "next/apps/fabrika/src/checklist-instance.laws.integration.test.ts",
    title:
      "L13: notices name their process each view.whole and view.patch for checklist:1 carries its pid and the update its Process published",
    selector:
      "L13: notices name their process > each view.whole and view.patch for checklist:1 carries its pid and the update its Process published",
    source: "a062f7a2515aa1917dfae05d3af95e3705b88812",
    before: "              heard.push({ client, news: structuredClone(news) });",
    after:
      "              if (News.guards.view(news) && published.filter((h) => Schema.is(Published)(h.news)).length === 1) {\n                return;\n              }\n\n              heard.push({ client, news: structuredClone(news) });",
    preparation: [],
    hashes: {
      source: "08a5cfd7af599b98e3a68c887328f5d2462f455c9e19aefe2258e5766a03f50f",
      prepared: "08a5cfd7af599b98e3a68c887328f5d2462f455c9e19aefe2258e5766a03f50f",
      edited: "d95cdb439345596c7f54d64d469e71f95c51761fd832685da47f74496e18421d",
    },
    failures: [
      {
        diagnostic: "AssertionError: the client heard the checklist's views",
        line: 828,
        column: 80,
      },
      {
        diagnostic: "AssertionError: checklist notice count differs",
        line: 829,
        column: 38,
      },
    ],
  },
  "checklist-early-complete": {
    project: "next-integration",
    file: "next/apps/fabrika/src/checklist-instance.laws.integration.test.ts",
    test: "next/apps/fabrika/src/checklist-instance.laws.integration.test.ts",
    title:
      "L13: notices name their process successive sends land and a client joining after the first send opens the current checklist",
    selector:
      "L13: notices name their process > successive sends land and a client joining after the first send opens the current checklist",
    source: "a062f7a2515aa1917dfae05d3af95e3705b88812",
    before: "                              yield* Effect.void;",
    after: "                              yield* Deferred.succeed(work.done, undefined);",
    preparation: [
      {
        before: "type AlarmWork = {",
        after:
          "type AlarmProbe = {\n  readonly entered: Deferred.Deferred<AlarmWork>;\n  readonly release: Deferred.Deferred<void>;\n  readonly failure: Error;\n  readonly arm: (at: number | null) => Effect.Effect<void, AlarmFailure>;\n  readonly calls: Set<Deferred.Deferred<void>>;\n};\n\ntype AlarmWork = {",
      },
      {
        before: "        running = new Set<AlarmWork>();",
        after: "        running = new Set<AlarmWork>(),\n        probes = new Map<string, AlarmProbe>();",
      },
      {
        before: "                      counts.started++;",
        after:
          "                      counts.started++;\n                      const probe = probes.get(storageKey);\n                      const returned = probe === undefined ? undefined : Deferred.makeUnsafe<void>();\n\n                      if (probe !== undefined && returned !== undefined) {\n                        probe.calls.add(returned);\n                      }\n\n                      const turn = probe?.calls.size ?? 0;",
      },
      {
        before:
          '                          Effect.tryPromise({\n                            try: () => current.object.call("alarm", []),\n                            catch: (cause) => new AlarmFailure({ cause }),\n                          }).pipe(\n                            Effect.asVoid,\n',
        after:
          '                          Effect.gen(function* () {\n                            if (probe !== undefined && turn === 1) {\n                              yield* Effect.void;\n                              Deferred.doneUnsafe(probe.entered, Effect.succeed(work));\n                              yield* Deferred.await(probe.release);\n                            }\n\n                            yield* Effect.tryPromise({\n                              try: () => current.object.call("alarm", []),\n                              catch: (cause) => new AlarmFailure({ cause }),\n                            }).pipe(Effect.asVoid);\n                          }).pipe(\n',
      },
      {
        before: "                                counts.completed++;",
        after:
          "                                counts.completed++;\n\n                                if (returned !== undefined) {\n                                  Deferred.doneUnsafe(returned, Effect.void);\n                                }",
      },
      {
        before: "        published,\n        settled,",
        after:
          '        published,\n        settled,\n        pause: (pid: string) =>\n          Effect.acquireRelease(\n            Effect.sync(() => {\n              const entry = processes.get(pid);\n\n              if (entry === undefined) {\n                throw new Error("checklist probe process missing");\n              }\n\n              const probe: AlarmProbe = {\n                entered: Deferred.makeUnsafe<AlarmWork>(),\n                release: Deferred.makeUnsafe<void>(),\n                failure: new Error("checklist alarm failure probe"),\n                calls: new Set(),\n                arm: (at) => Effect.tryPromise({\n                  try: () => at === null ? entry.ctx.storage.deleteAlarm() : entry.ctx.storage.setAlarm(at),\n                  catch: (cause) => new AlarmFailure({ cause }),\n                }),\n              };\n              probes.set(pid, probe);\n\n              return probe;\n            }),\n            (probe) => Effect.gen(function* () {\n              probes.delete(pid);\n              yield* Deferred.succeed(probe.release, undefined);\n              yield* Effect.forEach([...probe.calls], (returned) => Deferred.await(returned), { concurrency: "unbounded" });\n            }),\n          ),',
      },
      {
        before: "              for (const [n] of names.entries()) {\n                counts.moves++;",
        after:
          "              for (const [n] of names.entries()) {\n                const probe = yield* w.pause(Schema.decodeUnknownSync(Schema.String)(pid));\n                counts.moves++;",
      },
      {
        before:
          "                // Plant: finish the alarm record before a Deferred-held Process call.\n                yield* w.settled;",
        after:
          '                const work = yield* Deferred.await(probe.entered);\n                expect(yield* Deferred.isDone(work.done), "alarm completion waits for the real callback").toBe(false);\n                yield* Deferred.succeed(probe.release, undefined);\n                yield* w.settled;',
      },
    ],
    hashes: {
      source: "08a5cfd7af599b98e3a68c887328f5d2462f455c9e19aefe2258e5766a03f50f",
      prepared: "d097eed69883a94ee40d8824e84844567672012f97a6e3e71001167c3ed45336",
      edited: "5a166e8c8fc6b26afa845cc793052ac228037237c557a1c01a662bbfb116db15",
    },
    failures: [
      {
        diagnostic: "AssertionError: alarm completion waits for the real callback",
        line: 769,
        column: 107,
      },
    ],
  },
  "checklist-held-call": {
    project: "next-integration",
    file: "next/apps/fabrika/src/checklist-instance.laws.integration.test.ts",
    test: "next/apps/fabrika/src/checklist-instance.laws.integration.test.ts",
    title:
      "L13: notices name their process successive sends land and a client joining after the first send opens the current checklist",
    selector:
      "L13: notices name their process > successive sends land and a client joining after the first send opens the current checklist",
    source: "a062f7a2515aa1917dfae05d3af95e3705b88812",
    before: '          yield* Effect.forEach(due, (work) => Deferred.await(work.done), { concurrency: "unbounded" });',
    after: "          yield* Effect.void;",
    preparation: [
      {
        before: 'import { Cause, Deferred, Effect, Exit, Schema } from "effect";',
        after: 'import { Cause, Deferred, Effect, Exit, Fiber, Schema } from "effect";',
      },
      {
        before: "type AlarmWork = {",
        after:
          "type AlarmProbe = {\n  readonly entered: Deferred.Deferred<AlarmWork>;\n  readonly release: Deferred.Deferred<void>;\n  readonly failure: Error;\n  readonly arm: (at: number | null) => Effect.Effect<void, AlarmFailure>;\n  readonly calls: Set<Deferred.Deferred<void>>;\n};\n\ntype AlarmWork = {",
      },
      {
        before: "        running = new Set<AlarmWork>();",
        after: "        running = new Set<AlarmWork>(),\n        probes = new Map<string, AlarmProbe>();",
      },
      {
        before: "                      counts.started++;",
        after:
          "                      counts.started++;\n                      const probe = probes.get(storageKey);\n                      const returned = probe === undefined ? undefined : Deferred.makeUnsafe<void>();\n\n                      if (probe !== undefined && returned !== undefined) {\n                        probe.calls.add(returned);\n                      }\n\n                      const turn = probe?.calls.size ?? 0;",
      },
      {
        before: "                                counts.completed++;",
        after:
          "                                counts.completed++;\n\n                                if (returned !== undefined) {\n                                  Deferred.doneUnsafe(returned, Effect.void);\n                                }",
      },
      {
        before:
          '                          Effect.tryPromise({\n                            try: () => current.object.call("alarm", []),\n                            catch: (cause) => new AlarmFailure({ cause }),\n                          }).pipe(\n                            Effect.asVoid,\n',
        after:
          '                          Effect.gen(function* () {\n                            if (probe !== undefined && turn === 1) {\n                              yield* Effect.void;\n                              Deferred.doneUnsafe(probe.entered, Effect.succeed(work));\n                              yield* Deferred.await(probe.release);\n                            }\n\n                            yield* Effect.tryPromise({\n                              try: () => current.object.call("alarm", []),\n                              catch: (cause) => new AlarmFailure({ cause }),\n                            }).pipe(Effect.asVoid);\n                          }).pipe(\n',
      },
      {
        before: "        published,\n        settled,",
        after:
          '        published,\n        settled,\n        pause: (pid: string) =>\n          Effect.acquireRelease(\n            Effect.sync(() => {\n              const entry = processes.get(pid);\n\n              if (entry === undefined) {\n                throw new Error("checklist probe process missing");\n              }\n\n              const probe: AlarmProbe = {\n                entered: Deferred.makeUnsafe<AlarmWork>(),\n                release: Deferred.makeUnsafe<void>(),\n                failure: new Error("checklist alarm failure probe"),\n                calls: new Set(),\n                arm: (at) => Effect.tryPromise({\n                  try: () => at === null ? entry.ctx.storage.deleteAlarm() : entry.ctx.storage.setAlarm(at),\n                  catch: (cause) => new AlarmFailure({ cause }),\n                }),\n              };\n              probes.set(pid, probe);\n\n              return probe;\n            }),\n            (probe) => Effect.gen(function* () {\n              probes.delete(pid);\n              yield* Deferred.succeed(probe.release, undefined);\n              yield* Effect.forEach([...probe.calls], (returned) => Deferred.await(returned), { concurrency: "unbounded" });\n            }),\n          ),',
      },
      {
        before: "              for (const [n] of names.entries()) {\n                counts.moves++;",
        after:
          "              for (const [n] of names.entries()) {\n                const probe = yield* w.pause(Schema.decodeUnknownSync(Schema.String)(pid));\n                counts.moves++;",
      },
      {
        before:
          "                // Plant: finish the alarm record before a Deferred-held Process call.\n                yield* w.settled;",
        after:
          '                const waiting = yield* Effect.forkChild(w.settled, { startImmediately: true });\n                const work = yield* Deferred.await(probe.entered);\n                expect(waiting.pollUnsafe(), "settled stays pending while the callback is held").toBeUndefined();\n                yield* Deferred.succeed(probe.release, undefined);\n                yield* Fiber.join(waiting);\n                expect(yield* Deferred.isDone(work.done), "released callback completes its wait").toBe(true);\n                yield* w.settled;',
      },
    ],
    hashes: {
      source: "08a5cfd7af599b98e3a68c887328f5d2462f455c9e19aefe2258e5766a03f50f",
      prepared: "5ab79a9bd1333b20874fcfd26659f7fbb4c1d799fac4a441b78b2b2a9cf79087",
      edited: "ea0866f9735cb11103994209e889f2a5e23cb57ecb7d6ff28711d589f4aa24ef",
    },
    failures: [
      {
        diagnostic: "AssertionError: settled stays pending while the callback is held",
        line: 770,
        column: 98,
      },
    ],
  },
  "checklist-due-reschedule": {
    project: "next-integration",
    file: "next/apps/fabrika/src/checklist-instance.laws.integration.test.ts",
    test: "next/apps/fabrika/src/checklist-instance.laws.integration.test.ts",
    title:
      "L13: notices name their process successive sends land and a client joining after the first send opens the current checklist",
    selector:
      "L13: notices name their process > successive sends land and a client joining after the first send opens the current checklist",
    source: "a062f7a2515aa1917dfae05d3af95e3705b88812",
    before: "          for (const work of due) {\n            alarms.delete(work);\n          }",
    after: "          for (const work of due) {\n            alarms.delete(work);\n          }\n\n          return;",
    preparation: [
      {
        before: 'import { Cause, Deferred, Effect, Exit, Schema } from "effect";',
        after: 'import { Cause, Deferred, Effect, Exit, Fiber, Schema } from "effect";',
      },
      {
        before: "type AlarmWork = {",
        after:
          "type AlarmProbe = {\n  readonly entered: Deferred.Deferred<AlarmWork>;\n  readonly release: Deferred.Deferred<void>;\n  readonly failure: Error;\n  readonly arm: (at: number | null) => Effect.Effect<void, AlarmFailure>;\n  readonly calls: Set<Deferred.Deferred<void>>;\n};\n\ntype AlarmWork = {",
      },
      {
        before: "        running = new Set<AlarmWork>();",
        after: "        running = new Set<AlarmWork>(),\n        probes = new Map<string, AlarmProbe>();",
      },
      {
        before: "                      counts.started++;",
        after:
          "                      counts.started++;\n                      const probe = probes.get(storageKey);\n                      const returned = probe === undefined ? undefined : Deferred.makeUnsafe<void>();\n\n                      if (probe !== undefined && returned !== undefined) {\n                        probe.calls.add(returned);\n                      }\n\n                      const turn = probe?.calls.size ?? 0;",
      },
      {
        before: "                                counts.completed++;",
        after:
          "                                counts.completed++;\n\n                                if (returned !== undefined) {\n                                  Deferred.doneUnsafe(returned, Effect.void);\n                                }",
      },
      {
        before:
          '                          Effect.tryPromise({\n                            try: () => current.object.call("alarm", []),\n                            catch: (cause) => new AlarmFailure({ cause }),\n                          }).pipe(\n                            Effect.asVoid,\n',
        after:
          '                          Effect.gen(function* () {\n                            if (probe !== undefined && turn === 2) {\n                              yield* Effect.void;\n                              Deferred.doneUnsafe(probe.entered, Effect.succeed(work));\n                              yield* Deferred.await(probe.release);\n                            }\n\n                            yield* Effect.tryPromise({\n                              try: () => current.object.call("alarm", []),\n                              catch: (cause) => new AlarmFailure({ cause }),\n                            }).pipe(Effect.asVoid);\n\n                            if (probe !== undefined && turn === 1) {\n                              yield* probe.arm(0);\n                            }\n                          }).pipe(\n',
      },
      {
        before: "        published,\n        settled,",
        after:
          '        published,\n        settled,\n        pause: (pid: string) =>\n          Effect.acquireRelease(\n            Effect.sync(() => {\n              const entry = processes.get(pid);\n\n              if (entry === undefined) {\n                throw new Error("checklist probe process missing");\n              }\n\n              const probe: AlarmProbe = {\n                entered: Deferred.makeUnsafe<AlarmWork>(),\n                release: Deferred.makeUnsafe<void>(),\n                failure: new Error("checklist alarm failure probe"),\n                calls: new Set(),\n                arm: (at) => Effect.tryPromise({\n                  try: () => at === null ? entry.ctx.storage.deleteAlarm() : entry.ctx.storage.setAlarm(at),\n                  catch: (cause) => new AlarmFailure({ cause }),\n                }),\n              };\n              probes.set(pid, probe);\n\n              return probe;\n            }),\n            (probe) => Effect.gen(function* () {\n              probes.delete(pid);\n              yield* Deferred.succeed(probe.release, undefined);\n              yield* Effect.forEach([...probe.calls], (returned) => Deferred.await(returned), { concurrency: "unbounded" });\n            }),\n          ),',
      },
      {
        before: "              for (const [n] of names.entries()) {\n                counts.moves++;",
        after:
          "              for (const [n] of names.entries()) {\n                const probe = yield* w.pause(Schema.decodeUnknownSync(Schema.String)(pid));\n                counts.moves++;",
      },
      {
        before:
          "                // Plant: finish the alarm record before a Deferred-held Process call.\n                yield* w.settled;",
        after:
          '                const waiting = yield* Effect.forkChild(w.settled, { startImmediately: true });\n                const work = yield* Deferred.await(probe.entered);\n                expect(waiting.pollUnsafe(), "settled includes the rescheduled due callback").toBeUndefined();\n                yield* Deferred.succeed(probe.release, undefined);\n                yield* Fiber.join(waiting);\n                expect(yield* Deferred.isDone(work.done), "released callback completes its wait").toBe(true);\n                yield* w.settled;',
      },
    ],
    hashes: {
      source: "08a5cfd7af599b98e3a68c887328f5d2462f455c9e19aefe2258e5766a03f50f",
      prepared: "15a20a30009ce885e2fce5b77164a70dde147c44286ecefb7bf7a13abda32852",
      edited: "4ce6941d2ad4b4780a411b994b63f4a078052b9bca5ac9e0a225b2f521a1eeda",
    },
    failures: [
      {
        diagnostic: "AssertionError: settled includes the rescheduled due callback",
        line: 776,
        column: 95,
      },
    ],
  },
  "checklist-running-replace": {
    project: "next-integration",
    file: "next/apps/fabrika/src/checklist-instance.laws.integration.test.ts",
    test: "next/apps/fabrika/src/checklist-instance.laws.integration.test.ts",
    title:
      "L13: notices name their process successive sends land and a client joining after the first send opens the current checklist",
    selector:
      "L13: notices name their process > successive sends land and a client joining after the first send opens the current checklist",
    source: "a062f7a2515aa1917dfae05d3af95e3705b88812",
    before: "          Deferred.doneUnsafe(pending.work.done, Effect.void);",
    after:
      "          Deferred.doneUnsafe(pending.work.done, Effect.void);\n\n          for (const active of running) {\n            Deferred.doneUnsafe(active.done, Effect.void);\n          }",
    preparation: [
      {
        before: 'import { Cause, Deferred, Effect, Exit, Schema } from "effect";',
        after: 'import { Cause, Deferred, Effect, Exit, Fiber, Schema } from "effect";',
      },
      {
        before: "type AlarmWork = {",
        after:
          "type AlarmProbe = {\n  readonly entered: Deferred.Deferred<AlarmWork>;\n  readonly release: Deferred.Deferred<void>;\n  readonly failure: Error;\n  readonly arm: (at: number | null) => Effect.Effect<void, AlarmFailure>;\n  readonly calls: Set<Deferred.Deferred<void>>;\n};\n\ntype AlarmWork = {",
      },
      {
        before: "        running = new Set<AlarmWork>();",
        after: "        running = new Set<AlarmWork>(),\n        probes = new Map<string, AlarmProbe>();",
      },
      {
        before: "                      counts.started++;",
        after:
          "                      counts.started++;\n                      const probe = probes.get(storageKey);\n                      const returned = probe === undefined ? undefined : Deferred.makeUnsafe<void>();\n\n                      if (probe !== undefined && returned !== undefined) {\n                        probe.calls.add(returned);\n                      }\n\n                      const turn = probe?.calls.size ?? 0;",
      },
      {
        before: "                                counts.completed++;",
        after:
          "                                counts.completed++;\n\n                                if (returned !== undefined) {\n                                  Deferred.doneUnsafe(returned, Effect.void);\n                                }",
      },
      {
        before:
          '                          Effect.tryPromise({\n                            try: () => current.object.call("alarm", []),\n                            catch: (cause) => new AlarmFailure({ cause }),\n                          }).pipe(\n                            Effect.asVoid,\n',
        after:
          '                          Effect.gen(function* () {\n                            if (probe !== undefined && turn === 1) {\n                              yield* Effect.void;\n                              Deferred.doneUnsafe(probe.entered, Effect.succeed(work));\n                              yield* Deferred.await(probe.release);\n                            }\n\n                            yield* Effect.tryPromise({\n                              try: () => current.object.call("alarm", []),\n                              catch: (cause) => new AlarmFailure({ cause }),\n                            }).pipe(Effect.asVoid);\n                          }).pipe(\n',
      },
      {
        before: "        published,\n        settled,",
        after:
          '        published,\n        settled,\n        pause: (pid: string) =>\n          Effect.acquireRelease(\n            Effect.sync(() => {\n              const entry = processes.get(pid);\n\n              if (entry === undefined) {\n                throw new Error("checklist probe process missing");\n              }\n\n              const probe: AlarmProbe = {\n                entered: Deferred.makeUnsafe<AlarmWork>(),\n                release: Deferred.makeUnsafe<void>(),\n                failure: new Error("checklist alarm failure probe"),\n                calls: new Set(),\n                arm: (at) => Effect.tryPromise({\n                  try: () => at === null ? entry.ctx.storage.deleteAlarm() : entry.ctx.storage.setAlarm(at),\n                  catch: (cause) => new AlarmFailure({ cause }),\n                }),\n              };\n              probes.set(pid, probe);\n\n              return probe;\n            }),\n            (probe) => Effect.gen(function* () {\n              probes.delete(pid);\n              yield* Deferred.succeed(probe.release, undefined);\n              yield* Effect.forEach([...probe.calls], (returned) => Deferred.await(returned), { concurrency: "unbounded" });\n            }),\n          ),',
      },
      {
        before: "              for (const [n] of names.entries()) {\n                counts.moves++;",
        after:
          "              for (const [n] of names.entries()) {\n                const probe = yield* w.pause(Schema.decodeUnknownSync(Schema.String)(pid));\n                counts.moves++;",
      },
      {
        before:
          "                // Plant: finish the alarm record before a Deferred-held Process call.\n                yield* w.settled;",
        after:
          '                const work = yield* Deferred.await(probe.entered);\n                const future = Date.now() + 86_400_000;\n                yield* probe.arm(future);\n                yield* probe.arm(future + 1);\n                expect(yield* Deferred.isDone(work.done), "canceling a schedule keeps the running call pending").toBe(false);\n                const waiting = yield* Effect.forkChild(w.settled, { startImmediately: true });\n                expect(waiting.pollUnsafe(), "a future schedule does not complete a running call").toBeUndefined();\n                yield* Deferred.succeed(probe.release, undefined);\n                yield* Fiber.join(waiting);\n                yield* w.settled;',
      },
    ],
    hashes: {
      source: "08a5cfd7af599b98e3a68c887328f5d2462f455c9e19aefe2258e5766a03f50f",
      prepared: "a7a798a65be92dabc32d25540c0b9fd6ef4b328a4bb0c7af5d53669e47fde6a5",
      edited: "84c27c3333f5eeb55c26c33219671a09008dc0abee7d7797245997872305facf",
    },
    failures: [
      {
        diagnostic: "AssertionError: canceling a schedule keeps the running call pending",
        line: 776,
        column: 114,
      },
    ],
  },
  "checklist-running-delete": {
    project: "next-integration",
    file: "next/apps/fabrika/src/checklist-instance.laws.integration.test.ts",
    test: "next/apps/fabrika/src/checklist-instance.laws.integration.test.ts",
    title:
      "L13: notices name their process successive sends land and a client joining after the first send opens the current checklist",
    selector:
      "L13: notices name their process > successive sends land and a client joining after the first send opens the current checklist",
    source: "a062f7a2515aa1917dfae05d3af95e3705b88812",
    before: "          Deferred.doneUnsafe(pending.work.done, Effect.void);",
    after:
      "          Deferred.doneUnsafe(pending.work.done, Effect.void);\n\n          for (const active of running) {\n            Deferred.doneUnsafe(active.done, Effect.void);\n          }",
    preparation: [
      {
        before: 'import { Cause, Deferred, Effect, Exit, Schema } from "effect";',
        after: 'import { Cause, Deferred, Effect, Exit, Fiber, Schema } from "effect";',
      },
      {
        before: "type AlarmWork = {",
        after:
          "type AlarmProbe = {\n  readonly entered: Deferred.Deferred<AlarmWork>;\n  readonly release: Deferred.Deferred<void>;\n  readonly failure: Error;\n  readonly arm: (at: number | null) => Effect.Effect<void, AlarmFailure>;\n  readonly calls: Set<Deferred.Deferred<void>>;\n};\n\ntype AlarmWork = {",
      },
      {
        before: "        running = new Set<AlarmWork>();",
        after: "        running = new Set<AlarmWork>(),\n        probes = new Map<string, AlarmProbe>();",
      },
      {
        before: "                      counts.started++;",
        after:
          "                      counts.started++;\n                      const probe = probes.get(storageKey);\n                      const returned = probe === undefined ? undefined : Deferred.makeUnsafe<void>();\n\n                      if (probe !== undefined && returned !== undefined) {\n                        probe.calls.add(returned);\n                      }\n\n                      const turn = probe?.calls.size ?? 0;",
      },
      {
        before: "                                counts.completed++;",
        after:
          "                                counts.completed++;\n\n                                if (returned !== undefined) {\n                                  Deferred.doneUnsafe(returned, Effect.void);\n                                }",
      },
      {
        before:
          '                          Effect.tryPromise({\n                            try: () => current.object.call("alarm", []),\n                            catch: (cause) => new AlarmFailure({ cause }),\n                          }).pipe(\n                            Effect.asVoid,\n',
        after:
          '                          Effect.gen(function* () {\n                            if (probe !== undefined && turn === 1) {\n                              yield* Effect.void;\n                              Deferred.doneUnsafe(probe.entered, Effect.succeed(work));\n                              yield* Deferred.await(probe.release);\n                            }\n\n                            yield* Effect.tryPromise({\n                              try: () => current.object.call("alarm", []),\n                              catch: (cause) => new AlarmFailure({ cause }),\n                            }).pipe(Effect.asVoid);\n                          }).pipe(\n',
      },
      {
        before: "        published,\n        settled,",
        after:
          '        published,\n        settled,\n        pause: (pid: string) =>\n          Effect.acquireRelease(\n            Effect.sync(() => {\n              const entry = processes.get(pid);\n\n              if (entry === undefined) {\n                throw new Error("checklist probe process missing");\n              }\n\n              const probe: AlarmProbe = {\n                entered: Deferred.makeUnsafe<AlarmWork>(),\n                release: Deferred.makeUnsafe<void>(),\n                failure: new Error("checklist alarm failure probe"),\n                calls: new Set(),\n                arm: (at) => Effect.tryPromise({\n                  try: () => at === null ? entry.ctx.storage.deleteAlarm() : entry.ctx.storage.setAlarm(at),\n                  catch: (cause) => new AlarmFailure({ cause }),\n                }),\n              };\n              probes.set(pid, probe);\n\n              return probe;\n            }),\n            (probe) => Effect.gen(function* () {\n              probes.delete(pid);\n              yield* Deferred.succeed(probe.release, undefined);\n              yield* Effect.forEach([...probe.calls], (returned) => Deferred.await(returned), { concurrency: "unbounded" });\n            }),\n          ),',
      },
      {
        before: "              for (const [n] of names.entries()) {\n                counts.moves++;",
        after:
          "              for (const [n] of names.entries()) {\n                const probe = yield* w.pause(Schema.decodeUnknownSync(Schema.String)(pid));\n                counts.moves++;",
      },
      {
        before:
          "                // Plant: finish the alarm record before a Deferred-held Process call.\n                yield* w.settled;",
        after:
          '                const work = yield* Deferred.await(probe.entered);\n                const future = Date.now() + 86_400_000;\n                yield* probe.arm(future);\n                yield* probe.arm(null);\n                expect(yield* Deferred.isDone(work.done), "canceling a schedule keeps the running call pending").toBe(false);\n                const waiting = yield* Effect.forkChild(w.settled, { startImmediately: true });\n                expect(waiting.pollUnsafe(), "a future schedule does not complete a running call").toBeUndefined();\n                yield* Deferred.succeed(probe.release, undefined);\n                yield* Fiber.join(waiting);\n                yield* w.settled;',
      },
    ],
    hashes: {
      source: "08a5cfd7af599b98e3a68c887328f5d2462f455c9e19aefe2258e5766a03f50f",
      prepared: "e82cf996bf5a94d236f5c3022e0e3ee02748a427946fd6ea3817455ddbf9c678",
      edited: "13c9dae45705b697abede18a004fc6656235918bd9198b6c665b4b5da016c09b",
    },
    failures: [
      {
        diagnostic: "AssertionError: canceling a schedule keeps the running call pending",
        line: 776,
        column: 114,
      },
    ],
  },
  "checklist-alarm-failure": {
    project: "next-integration",
    file: "next/apps/fabrika/src/checklist-instance.laws.integration.test.ts",
    test: "next/apps/fabrika/src/checklist-instance.laws.integration.test.ts",
    title:
      "L13: notices name their process successive sends land and a client joining after the first send opens the current checklist",
    selector:
      "L13: notices name their process > successive sends land and a client joining after the first send opens the current checklist",
    source: "a062f7a2515aa1917dfae05d3af95e3705b88812",
    before: "                          }).pipe(\n                            Effect.ensuring(",
    after:
      "                          }).pipe(\n                            Effect.catch(() => Effect.void),\n                            Effect.ensuring(",
    preparation: [
      {
        before: 'import { Cause, Deferred, Effect, Exit, Schema } from "effect";',
        after: 'import { Cause, Deferred, Effect, Exit, Fiber, Schema } from "effect";',
      },
      {
        before: "type AlarmWork = {",
        after:
          "type AlarmProbe = {\n  readonly entered: Deferred.Deferred<AlarmWork>;\n  readonly release: Deferred.Deferred<void>;\n  readonly failure: Error;\n  readonly arm: (at: number | null) => Effect.Effect<void, AlarmFailure>;\n  readonly calls: Set<Deferred.Deferred<void>>;\n};\n\ntype AlarmWork = {",
      },
      {
        before: "        running = new Set<AlarmWork>();",
        after: "        running = new Set<AlarmWork>(),\n        probes = new Map<string, AlarmProbe>();",
      },
      {
        before: "                      counts.started++;",
        after:
          "                      counts.started++;\n                      const probe = probes.get(storageKey);\n                      const returned = probe === undefined ? undefined : Deferred.makeUnsafe<void>();\n\n                      if (probe !== undefined && returned !== undefined) {\n                        probe.calls.add(returned);\n                      }\n\n                      const turn = probe?.calls.size ?? 0;",
      },
      {
        before: "                                counts.completed++;",
        after:
          "                                counts.completed++;\n\n                                if (returned !== undefined) {\n                                  Deferred.doneUnsafe(returned, Effect.void);\n                                }",
      },
      {
        before:
          '                          Effect.tryPromise({\n                            try: () => current.object.call("alarm", []),\n                            catch: (cause) => new AlarmFailure({ cause }),\n                          }).pipe(\n                            Effect.asVoid,\n',
        after:
          '                          Effect.gen(function* () {\n                            if (probe !== undefined && turn === 1) {\n                              yield* Effect.void;\n                              Deferred.doneUnsafe(probe.entered, Effect.succeed(work));\n                              yield* Deferred.await(probe.release);\n                            }\n\n                            yield* Effect.tryPromise({\n                              try: async () => {\n                                await current.object.call("alarm", []);\n\n                                if (probe !== undefined && turn === 1) {\n                                  throw probe.failure;\n                                }\n                              },\n                              catch: (cause) => new AlarmFailure({ cause }),\n                            }).pipe(Effect.asVoid);\n                          }).pipe(\n',
      },
      {
        before: "        published,\n        settled,",
        after:
          '        published,\n        settled,\n        pause: (pid: string) =>\n          Effect.acquireRelease(\n            Effect.sync(() => {\n              const entry = processes.get(pid);\n\n              if (entry === undefined) {\n                throw new Error("checklist probe process missing");\n              }\n\n              const probe: AlarmProbe = {\n                entered: Deferred.makeUnsafe<AlarmWork>(),\n                release: Deferred.makeUnsafe<void>(),\n                failure: new Error("checklist alarm failure probe"),\n                calls: new Set(),\n                arm: (at) => Effect.tryPromise({\n                  try: () => at === null ? entry.ctx.storage.deleteAlarm() : entry.ctx.storage.setAlarm(at),\n                  catch: (cause) => new AlarmFailure({ cause }),\n                }),\n              };\n              probes.set(pid, probe);\n\n              return probe;\n            }),\n            (probe) => Effect.gen(function* () {\n              probes.delete(pid);\n              yield* Deferred.succeed(probe.release, undefined);\n              yield* Effect.forEach([...probe.calls], (returned) => Deferred.await(returned), { concurrency: "unbounded" });\n            }),\n          ),',
      },
      {
        before: "                ).toEqual(model.items.map((item) => item.name));\n              }\n",
        after:
          '                ).toEqual(model.items.map((item) => item.name));\n              }\n              const probe = yield* w.pause(Schema.decodeUnknownSync(Schema.String)(pid));\n              yield* probe.arm(0);\n              yield* Deferred.await(probe.entered);\n              const waiting = yield* Effect.forkChild(Effect.exit(w.settled), { startImmediately: true });\n              yield* Deferred.succeed(probe.release, undefined);\n              const exit = yield* Fiber.join(waiting);\n              expect(Exit.isFailure(exit), "alarm failure reaches the completion waiter").toBe(true);\n              const error = Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : null;\n              expect(error, "alarm failure stays typed").toMatchObject({ _tag: "Some", value: { _tag: "AlarmFailure" } });\n\n              if (error?._tag === "Some") {\n                expect(error.value.cause, "alarm failure keeps its original cause").toBe(probe.failure);\n              }\n',
      },
    ],
    hashes: {
      source: "08a5cfd7af599b98e3a68c887328f5d2462f455c9e19aefe2258e5766a03f50f",
      prepared: "ea8d42e1ae68ac5f544227f17c5c29ea7a4e009e29936308d6963e61ff3ed073",
      edited: "c976a384dc41751fc74e96f21b588314333033e1cb03618d23de85405378ef9a",
    },
    failures: [
      {
        diagnostic: "AssertionError: alarm failure reaches the completion waiter",
        line: 800,
        column: 91,
      },
    ],
  },
  "checklist-late-failure": {
    project: "next-integration",
    file: "next/apps/fabrika/src/checklist-instance.laws.integration.test.ts",
    test: "next/apps/fabrika/src/checklist-instance.laws.integration.test.ts",
    title:
      "L13: notices name their process successive sends land and a client joining after the first send opens the current checklist",
    selector:
      "L13: notices name their process > successive sends land and a client joining after the first send opens the current checklist",
    source: "a062f7a2515aa1917dfae05d3af95e3705b88812",
    before: "                                running.delete(work);",
    after:
      "                                running.delete(work);\n                                alarms.delete(work);",
    preparation: [
      {
        before: "type AlarmWork = {",
        after:
          "type AlarmProbe = {\n  readonly entered: Deferred.Deferred<AlarmWork>;\n  readonly release: Deferred.Deferred<void>;\n  readonly failure: Error;\n  readonly arm: (at: number | null) => Effect.Effect<void, AlarmFailure>;\n  readonly calls: Set<Deferred.Deferred<void>>;\n};\n\ntype AlarmWork = {",
      },
      {
        before: "        running = new Set<AlarmWork>();",
        after: "        running = new Set<AlarmWork>(),\n        probes = new Map<string, AlarmProbe>();",
      },
      {
        before: "                      counts.started++;",
        after:
          "                      counts.started++;\n                      const probe = probes.get(storageKey);\n                      const returned = probe === undefined ? undefined : Deferred.makeUnsafe<void>();\n\n                      if (probe !== undefined && returned !== undefined) {\n                        probe.calls.add(returned);\n                      }\n\n                      const turn = probe?.calls.size ?? 0;",
      },
      {
        before:
          '                          Effect.tryPromise({\n                            try: () => current.object.call("alarm", []),\n                            catch: (cause) => new AlarmFailure({ cause }),\n                          }).pipe(\n                            Effect.asVoid,\n',
        after:
          '                          Effect.gen(function* () {\n                            if (probe !== undefined && turn === 1) {\n                              yield* Effect.void;\n                              Deferred.doneUnsafe(probe.entered, Effect.succeed(work));\n                              yield* Deferred.await(probe.release);\n                            }\n\n                            yield* Effect.tryPromise({\n                              try: async () => {\n                                await current.object.call("alarm", []);\n\n                                if (probe !== undefined && turn === 1) {\n                                  throw probe.failure;\n                                }\n                              },\n                              catch: (cause) => new AlarmFailure({ cause }),\n                            }).pipe(Effect.asVoid);\n                          }).pipe(\n',
      },
      {
        before: "                                counts.completed++;",
        after:
          "                                counts.completed++;\n\n                                if (returned !== undefined) {\n                                  Deferred.doneUnsafe(returned, Effect.void);\n                                }",
      },
      {
        before: "        published,\n        settled,",
        after:
          '        published,\n        settled,\n        pause: (pid: string) =>\n          Effect.acquireRelease(\n            Effect.sync(() => {\n              const entry = processes.get(pid);\n\n              if (entry === undefined) {\n                throw new Error("checklist probe process missing");\n              }\n\n              const probe: AlarmProbe = {\n                entered: Deferred.makeUnsafe<AlarmWork>(),\n                release: Deferred.makeUnsafe<void>(),\n                failure: new Error("checklist alarm failure probe"),\n                calls: new Set(),\n                arm: (at) => Effect.tryPromise({\n                  try: () => at === null ? entry.ctx.storage.deleteAlarm() : entry.ctx.storage.setAlarm(at),\n                  catch: (cause) => new AlarmFailure({ cause }),\n                }),\n              };\n              probes.set(pid, probe);\n\n              return probe;\n            }),\n            (probe) => Effect.gen(function* () {\n              probes.delete(pid);\n              yield* Deferred.succeed(probe.release, undefined);\n              yield* Effect.forEach([...probe.calls], (returned) => Deferred.await(returned), { concurrency: "unbounded" });\n            }),\n          ),',
      },
      {
        before: "                ).toEqual(model.items.map((item) => item.name));\n              }\n",
        after:
          '                ).toEqual(model.items.map((item) => item.name));\n              }\n              const probe = yield* w.pause(Schema.decodeUnknownSync(Schema.String)(pid));\n              yield* probe.arm(0);\n              const work = yield* Deferred.await(probe.entered);\n              yield* Deferred.succeed(probe.release, undefined);\n              yield* Effect.exit(Deferred.await(work.done));\n              const exit = yield* Effect.exit(w.settled);\n              expect(Exit.isFailure(exit), "alarm failure reaches the completion waiter").toBe(true);\n              const error = Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : null;\n              expect(error, "alarm failure stays typed").toMatchObject({ _tag: "Some", value: { _tag: "AlarmFailure" } });\n\n              if (error?._tag === "Some") {\n                expect(error.value.cause, "alarm failure keeps its original cause").toBe(probe.failure);\n              }\n',
      },
    ],
    hashes: {
      source: "08a5cfd7af599b98e3a68c887328f5d2462f455c9e19aefe2258e5766a03f50f",
      prepared: "a0a10cef5b8e134ea8a2b87f89930e2f58b715fdac29bdc1b25e30574d77bf3c",
      edited: "5b43a4afb1e77c9f783623dbe1ca34526f419a477da4cf15e17255d035d0ed27",
    },
    failures: [
      {
        diagnostic: "AssertionError: alarm failure reaches the completion waiter",
        line: 800,
        column: 91,
      },
    ],
  },
} as const;

class UnsupportedEdit extends Schema.TaggedError<UnsupportedEdit, { readonly brand: unique symbol }>()(
  "UnsupportedEdit",
  {},
) {}

export const decodeRequest = Schema.decodeUnknownEffect(Request, { onExcessProperty: "error" });

/** Require the exact unique fragment and lossless UTF-8 before changing any bytes. */
const replace = Effect.fn("plant.replace")(function* (
  bytes: Uint8Array,
  selected: { readonly before: string; readonly after: string },
) {
  const text = new TextDecoder().decode(bytes);
  const encoded = new TextEncoder().encode(text);
  const start = text.indexOf(selected.before);

  if (
    !bytes.every((value, i) => value === encoded[i]) ||
    encoded.length !== bytes.length ||
    start < 0 ||
    (selected.after.includes(selected.before) && text.includes(selected.after)) ||
    text.includes(selected.before, start + 1)
  ) {
    return yield* UnsupportedEdit.make({});
  }

  return new TextEncoder().encode(text.slice(0, start) + selected.after + text.slice(start + selected.before.length));
});

export const derive = (key: Request["case"], bytes: Uint8Array) => replace(bytes, cases[key]);

/** Apply only the selected catalog's fixed neutral edits, in their recorded order. */
export const prepare = Effect.fn("plant.prepare")(function* (key: Request["case"], bytes: Uint8Array) {
  const selected = cases[key];
  let prepared = bytes;

  if ("preparation" in selected) {
    for (const change of selected.preparation) {
      prepared = yield* replace(prepared, change);
    }
  }

  return prepared;
});

export const argv = (key: Request["case"], report: string): readonly string[] => [
  "-n",
  "19",
  "pnpm",
  "exec",
  "vitest",
  "run",
  "--project",
  cases[key].project,
  "--maxWorkers=1",
  "--fileParallelism=false",
  "--reporter=json",
  `--outputFile.json=${report}`,
  cases[key].test,
  "-t",
  `^${Regex.escape(cases[key].selector)}$`,
];
