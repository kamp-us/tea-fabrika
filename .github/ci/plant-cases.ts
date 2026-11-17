// Today's lead tooling. Each case fixes its source, selected law and sole temporary edit.
import { Effect, RegExp as Regex, Schema } from "effect";

export const Request = Schema.Struct({
  case: Schema.Literals(["checklist-pid", "watcher-r1", "host-pin", "host-discovery-timeout"]),
  sha: Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/)),
});

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
} as const;

class UnsupportedEdit extends Schema.TaggedError<UnsupportedEdit, { readonly brand: unique symbol }>()(
  "UnsupportedEdit",
  {},
) {}

export const decodeRequest = Schema.decodeUnknownEffect(Request, { onExcessProperty: "error" });

/** Require the exact unique fragment and lossless UTF-8 before changing any bytes. */
export const derive = Effect.fn("plant.derive")(function* (key: Request["case"], bytes: Uint8Array) {
  const text = new TextDecoder().decode(bytes);
  const encoded = new TextEncoder().encode(text);
  const selected = cases[key];
  const start = text.indexOf(selected.before);

  if (
    !bytes.every((value, i) => value === encoded[i]) ||
    encoded.length !== bytes.length ||
    start < 0 ||
    text.includes(selected.before, start + 1)
  ) {
    return yield* UnsupportedEdit.make({});
  }

  return new TextEncoder().encode(text.slice(0, start) + selected.after + text.slice(start + selected.before.length));
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
