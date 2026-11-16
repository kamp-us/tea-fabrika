// The exam command and the build share one Compiler check in libfabrika.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { check, Row } from "@kampus/libfabrika/compiler";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { String as Str, pipe, Array as Arr } from "effect";

export { check, compile, Row, type Finding } from "@kampus/libfabrika/compiler";

class Unread extends Schema.TaggedError<Unread, { readonly brand: unique symbol }>()("Unread", {
  path: Schema.String,
}) {}

class Refused extends Schema.TaggedError<Refused, { readonly brand: unique symbol }>()("Refused", {
  findings: Schema.Finite,
}) {}

/** `pnpm lint:compiler`: every `.tsx` file in `next/`, tests left out, against the ledger. */
const lint = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.resolve(import.meta.dirname, "../../../../..");

  const read = (file: string) =>
    fs.readFileString(path.join(root, file)).pipe(Effect.mapError(() => Unread.make({ path: file })));

  const ledger = yield* read("compiler-ledger.json").pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Row)))),
  );

  const paths = pipe(
    yield* fs.glob("next/**/*.tsx", { root, exclude: ["**/node_modules/**"] }),
    Arr.map((p) => path.relative(root, path.join(root, p))),
    Arr.filter((p) => !pipe(p, Str.includes("node_modules")) && !pipe(p, Str.includes(".test."))),
  ).sort();

  const files = new Map<string, string>();

  for (const path of paths) {
    files.set(path, yield* read(path));
  }

  const findings = check(files, ledger);

  for (const f of findings) {
    yield* Console.error(`${f.file}:${f.line} ${f.fn}: ${f.reason}`);
  }

  yield* Console.log(`lint:compiler: ${files.size} files, ${findings.length} findings, ${ledger.length} ledger rows`);

  if (findings.length > 0) {
    return yield* Refused.make({ findings: findings.length });
  }
});

if (import.meta.main) {
  NodeRuntime.runMain(lint.pipe(Effect.provide(NodeServices.layer)));
}
