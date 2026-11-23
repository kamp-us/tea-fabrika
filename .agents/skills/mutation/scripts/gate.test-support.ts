// What the laws of the guard check's saved results and its line share (gatecache.ts, gatequeue.ts,
// survivors.ts): a file system in memory, and a whole answer of the box. `wx` on a file that is there
// fails as the real one does.
import { Effect, FileSystem, Layer, Path, PlatformError, Schema } from "effect";
import type { Summary } from "../../lead/scripts/mutbox.ts";

const Fault = {
  fields: { module: Schema.Literal("FileSystem"), method: Schema.String, pathOrDescriptor: Schema.String },
};

const NotFound = Schema.TaggedStruct("NotFound", Fault.fields);

const AlreadyExists = Schema.TaggedStruct("AlreadyExists", Fault.fields);

const missing = (method: string, pathOrDescriptor: string) =>
  Effect.fail(PlatformError.systemError(NotFound.make({ module: "FileSystem", method, pathOrDescriptor })));

const taken = (method: string, pathOrDescriptor: string) =>
  Effect.fail(PlatformError.systemError(AlreadyExists.make({ module: "FileSystem", method, pathOrDescriptor })));

/** The files by path, and a file system over them. Every folder is there. */
export const memory = (onKept: (path: string) => void = () => undefined) => {
  const files = new Map<string, string>();

  const layer = Layer.mergeAll(
    Path.layer,
    FileSystem.layerNoop({
      makeDirectory: () => Effect.void,
      readDirectory: (dir) =>
        Effect.succeed(
          [...files.keys()].flatMap((path) =>
            path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes("/") ? [path.slice(dir.length + 1)] : [],
          ),
        ),
      readFileString: (path) => {
        const text = files.get(path);

        return text === undefined ? missing("readFileString", path) : Effect.succeed(text);
      },
      writeFileString: (path, data, options) => {
        if (options?.flag === "wx" && files.has(path)) {
          return taken("writeFileString", path);
        }

        files.set(path, data);
        onKept(path);

        return Effect.void;
      },
      rename: (from, to) => {
        const text = files.get(from);

        if (text === undefined) {
          return missing("rename", from);
        }

        files.delete(from);
        files.set(to, text);
        onKept(to);

        return Effect.void;
      },
      remove: (path) => Effect.sync(() => void files.delete(path)),
    }),
  );

  return { files, layer };
};

export const File = Schema.Literals(["a.ts", "b.ts", "c/d.ts", "e/f/g.ts", "h.tsx"]);

export const Row = Schema.Struct({
  file: File,
  line: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 99 })),
  column: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 99 })),
  endLine: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 99 })),
  endColumn: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 99 })),
  mutator: Schema.Literals(["ConditionalExpression", "StringLiteral", "EqualityOperator"]),
  replacement: Schema.String,
  status: Schema.Literals(["Survived", "NoCoverage"]),
});

/** A whole answer of the box with these survivors, as mutbox writes it. */
export const answer = (
  outcome: Summary["outcome"],
  survivors: ReadonlyArray<typeof Row.Type>,
  seconds: number,
  unreached = 0,
  from: "report" | "events" | "nothing" = "report",
): Summary => ({
  outcome,
  reason: outcome === "stuck" ? "docker_down" : "",
  detail: "",
  ticket: "0",
  build: "0123abc",
  base: null,
  image: null,
  network: "none",
  limits: { cpus: 4, memory: "4g", pids: 512, seconds: 480 },
  seconds,
  usage: null,
  related: [],
  excluded: [],
  skipped: [],
  sample: null,
  reach: null,
  b:
    outcome !== "done"
      ? null
      : {
          exit: 0,
          from,
          counts: { Survived: survivors.length },
          tested: survivors.length,
          unreached,
          survivors,
          uncovered: [],
          ignored: [],
        },
  a: null,
  narrowing: null,
  armA: null,
});
