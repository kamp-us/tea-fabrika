// Today's lead tooling. Fixed mappings for next/'s L11 experiment, never caller-provided edits.
import { Effect, Result, Schema } from "effect";
import { Digest } from "effect/crypto";

export const cached = "461d3f93a8c3d84fc25e8139493c59cab5632ebd";

export const uncached = "e3754f43e9b9cc27f2bf44918e8d657f2a863c9d";

export const file = "next/apps/fabrika/src/start-child.laws.integration.test.ts";

export const runtime = "next/packages/libfabrika/src/cloudflare/runtime.ts";

export const children = "next/packages/libfabrika/src/processes/ChildrenLedger.ts";

export const cases = [
  "l11-compare",
  "l11-inputs",
  "l11-batch",
  "l11-reply",
  "l11-span-name",
  "l11-span-code",
  "l11-span-errcode",
  "l11-log",
  "l11-row",
] as const;

export const Request = Schema.Struct({ case: Schema.Literals(cases), sha: Schema.Literal(cached) });

export type Request = typeof Request.Type;

export const decode = (input: unknown) => Schema.decodeUnknownResult(Request)(input, { onExcessProperty: "error" });

export const Variant = Schema.Literals(["uncached", "cached"]);

export type Variant = typeof Variant.Type;

export const Slot = Schema.Literals([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

export const sources = {
  uncached: { sha: uncached, law: "8c38d7ff077aa796420ac76881be179a12b3461b60e5db05897b2a20727809cb" },
  cached: { sha: cached, law: "9eae1ecb08f3db5834a8c5de8488773ddf280f8f058971725321156d15d083e0" },
};

export const hashes = {
  [runtime]: "175ceddc78e5bf30a68abc3c9d826175f7a8afc7611f247fa2c3bccd41aeaf05",
  [children]: "f4a3d647242f362c5b6292e54eae107d936331469aee9b7a2c44a1b316f1ab51",
  lock: "02d1d1c629105e240ea3b473df3dbb0f89874cfaf5f57352c6d8492da133da4c",
  workspace: "2dbe2a8e5e781cefa412fb2a43723b6dad1c8586bb49948d5d79eb1f81bef758",
  product: "ee87300a92b6ebb287db4e674ef15d95306befb3",
};

export const transformed: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "l11-inputs/uncached": { [file]: "4eb7f414dc28e22fda77f624be321b8a6ec13303e8adc32898cc3666de27aa0d" },
  "l11-inputs/cached": { [file]: "2581ca91788402f9da602e6a776691abb3c04975c317f060a492dda08ceeafa8" },
  "l11-reply/cached": { [runtime]: "4fe8896bab42b53935e659622cc4ae41062524c0eddb31f79065966889030f60" },
  "l11-log/cached": { [runtime]: "aa08b61d600c680199afdcb2e68779d279d3b9b7f8502fafc3968ab72d5e2903" },
  "l11-span-name/cached": {
    [runtime]: "9efff0058347b04ee9bc7d6689e006a49d7256ba272df228684c1130dbb1e37a",
    [children]: "ffa01bb783d683691039fe89657ae84e200892607c0dea5849696f41569cfe43",
    [file]: "f5d0f78c9952b7aa5b66b714f97182fe7589dd4a7078e89ce3716492353375e2",
  },
  "l11-span-code/cached": {
    [runtime]: "b3faa7d900b833da95590fce8cf4d7300b7045395088ec685c4543dd6b5e8dbd",
    [children]: "f5e91df698d971c89eeb36004293b7ba0130ce72a04f5da5fa50ecc58db5f1cc",
    [file]: "0f5912b9a8fc811fb6cd64f189f5bcaa724bba5b6487df7a445437d9d1afdc95",
  },
  "l11-span-errcode/cached": {
    [runtime]: "b3faa7d900b833da95590fce8cf4d7300b7045395088ec685c4543dd6b5e8dbd",
    [children]: "f5e91df698d971c89eeb36004293b7ba0130ce72a04f5da5fa50ecc58db5f1cc",
    [file]: "c01e6bcfadd4bc85b9271bdce94f0ac38c605ca5a3d64fcfb62c06a1fe78d79f",
  },
};

const prefix = "P42 slice 1: a code start on the real Worker path ";

export const aggregate = `${prefix}L11: every storage read and write in the child and lifecycle flows keeps error text and metadata out of outputs`;

export const paths = ["descriptor", "recovery", "configuration", "exit"] as const;

export const storagePaths = [
  "fresh",
  "saved",
  "already",
  "ended",
  "recovery",
  "migration",
  "configuration",
  "exit",
  "status",
  "isLive",
  "info",
  "resolve",
  "receive",
  "object",
  "read",
  "append",
] as const;

export const outputs = ["reply", "span", "row", "log"] as const;

export const sibling = (path: (typeof paths)[number], output: (typeof outputs)[number]) =>
  `${prefix}L11: Project.${path === "exit" ? "processExit" : "processChild"} ${path} failures keep storage text and metadata out of ${output}`;

export const titles = [aggregate, ...paths.flatMap((path) => outputs.map((output) => sibling(path, output)))];

export const output = (request: Request): (typeof outputs)[number] | null => {
  switch (request.case) {
    case "l11-reply":
      return "reply";
    case "l11-span-name":
    case "l11-span-code":
    case "l11-span-errcode":
      return "span";
    case "l11-log":
      return "log";
    case "l11-row":
      return "row";
    default:
      return null;
  }
};

export const selected = (request: Request) => {
  const channel = output(request);

  return channel === null ? titles : [aggregate, ...paths.map((path) => sibling(path, channel))];
};

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const argv = (request: Request, report: string, list = false) => {
  const args = [
    "exec",
    "vitest",
    list ? "list" : "run",
    "--project=next-integration",
    "--maxWorkers=1",
    "--fileParallelism=false",
    file,
  ];

  if (request.case === "l11-inputs") {
    args.push("--disableConsoleIntercept");
  }

  if (output(request) !== null) {
    args.push(`--testNamePattern=^(?:${selected(request).map(escaped).join("|")})$`);
  }

  return list ? [...args, `--json=${report}`] : [...args, "--reporter=json", `--outputFile=${report}`];
};

export const Edit = Schema.Struct({
  path: Schema.Literals([file, runtime, children]),
  before: Schema.String,
  after: Schema.String,
});

export type Edit = typeof Edit.Type;

const edit = (path: Edit["path"], before: string, after: string): Edit => ({ path, before, after });

const guard = (path: typeof runtime | typeof children, field: "name" | "code") => {
  const label = path === runtime ? "LedgerError" : "ChildrenError";
  const indent = path === runtime ? "        " : "          ";
  const before = `${indent}if (key !== "fab.ledger.code") {\n${indent}  attribute(key, key === "error.type" ? "${label}" : value);\n${indent}}`;

  const after =
    field === "name"
      ? `${indent}if (key !== "fab.ledger.code") {\n${indent}  attribute(key, value);\n${indent}}`
      : `${indent}attribute(key, key === "error.type" ? "${label}" : value);`;

  return edit(path, before, after);
};

const catchDefect = '    Effect.catchDefect(() => Effect.fail(new LedgerError({ reason: "storage" }))),';

const fault = (field: "name" | "code" | "errcode") => {
  const marker = "$" + "{marker}";

  const fields =
    field === "code"
      ? 'name: "Error", code: marker'
      : field === "name"
        ? 'name: marker, code: "SQLITE_FULL", errcode: "SQLITE_FULL"'
        : 'name: "Error", code: "SQLITE_FULL", errcode: marker';

  return [
    edit(
      file,
      `    const error = Object.assign(new Error(\`SQLITE_FULL at ${marker}\`), { name: marker, code: marker, errcode: marker });`,
      `    const error = Object.assign(new Error("SQLITE_FULL"), { ${fields} });`,
    ),
    edit(
      file,
      `      const fault = Object.assign(new Error(\`SQLITE_FULL at ${marker}\`), {\n        name: marker,\n        code: marker,\n        errcode: marker,\n      });`,
      `      const fault = Object.assign(new Error("SQLITE_FULL"), { ${fields} });`,
    ),
  ];
};

export const mappings = (request: Request): readonly Edit[] => {
  switch (request.case) {
    case "l11-reply":
      return [
        edit(
          runtime,
          catchDefect,
          '    Effect.catchDefect((defect) => Effect.fail(new LedgerError({ reason: "storage", message: String(defect) }))),',
        ),
      ];
    case "l11-log":
      return [
        edit(
          runtime,
          catchDefect,
          '    Effect.catchDefect((defect) => Effect.logError(defect).pipe(Effect.andThen(Effect.fail(new LedgerError({ reason: "storage" }))))),',
        ),
      ];
    case "l11-span-name":
      return [guard(runtime, "name"), guard(children, "name"), ...fault("name")];
    case "l11-span-code":
      return [guard(runtime, "code"), guard(children, "code"), ...fault("code")];
    case "l11-span-errcode":
      return [guard(runtime, "code"), guard(children, "code"), ...fault("errcode")];
    default:
      return [];
  }
};

export const tracePrefix = "L11_TRACE_V1 ";

const emit = (tag: string, value: string) =>
  `yield* Console.log(${JSON.stringify(tracePrefix)} + JSON.stringify({ ...Schema.TaggedStruct(${JSON.stringify(tag)}, {}).make({}), ...${value} })).pipe(Effect.provideService(Console.Console, Console.Console.defaultValue()));`;

// Each insertion observes an existing boundary. It never replays the command iterable or draws a pick.
export const observer = (variant: Variant): readonly Edit[] => [
  edit(
    file,
    'import { Clock, Effect, Exit, Layer, Logger, ManagedRuntime, Result, Schema, Scope } from "effect";',
    'import { Clock, Console, Effect, Exit, Layer, Logger, ManagedRuntime, Result, Schema, Scope } from "effect";',
  ),
  edit(
    file,
    "  const inventory = [...remaining];",
    `  const inventory = [...remaining];\n  ${emit("inventory", "{ inventory }")}\n  let l11Walk = 0;`,
  ),
  edit(
    file,
    "    let moves = 0;",
    `    let moves = 0;\n    const l11Id = l11Walk++;\n    ${emit("walk", "{ walk: l11Id, secret, forms: forms(secret) }")}`,
  ),
  edit(
    file,
    "      const available = remaining.length > 0 ? remaining : inventory;",
    "      const l11Repeat = remaining.length === 0;\n      const available = remaining.length > 0 ? remaining : inventory;",
  ),
  edit(
    file,
    variant === "cached"
      ? "      const marker = secretForms[pick.encoding] ?? secret;"
      : "      const marker = forms(secret)[pick.encoding] ?? secret;",
    `${variant === "cached" ? "      const marker = secretForms[pick.encoding] ?? secret;" : "      const marker = forms(secret)[pick.encoding] ?? secret;"}\n      ${emit("pick", "{ walk: l11Id, move: moves, pick, cut, repeat: l11Repeat, marker }")}`,
  ),
  edit(
    file,
    "      for (const [output, texts] of Object.entries(outputs)) {",
    `      ${emit("inspect", "{ walk: l11Id, move: moves, counts: Object.fromEntries(Object.entries(outputs).map(([key, texts]) => [key, texts.length])), leaks: Object.fromEntries(Object.entries(outputs).map(([key, texts]) => [key, texts.some((text) => forms(secret).some((form) => text.includes(form)))])) }")}\n      for (const [output, texts] of Object.entries(outputs)) {`,
  ),
  edit(file, "      moves++;", `      moves++;\n      ${emit("move", "{ walk: l11Id, moves }")}`),
  edit(
    file,
    '    expect(moves, "L11: the storage walk is not empty").toBeGreaterThan(0);',
    `    ${emit("end", "{ walk: l11Id, moves }")}\n    expect(moves, "L11: the storage walk is not empty").toBeGreaterThan(0);`,
  ),
  edit(
    file,
    '  expect(remaining, "L11: every storage operation in every flow was cut").toEqual([]);',
    `  ${emit("complete", "{ remaining: remaining.length, reached: reached.size }")}\n  expect(remaining, "L11: every storage operation in every flow was cut").toEqual([]);`,
  ),
  edit(
    file,
    "  const fixture = yield* childProject();\n  const outputs: Record<ChildOutput, Array<string>>",
    `  ${emit("project", "{ path, output, secret, forms: forms(secret) }")}\n  let l11Moves = 0;\n  const fixture = yield* childProject();\n  const outputs: Record<ChildOutput, Array<string>>`,
  ),
  edit(
    file,
    "  const step = Effect.fnUntraced(function* (pick: SecretPick) {\n    if (remaining.size === 0) {",
    `  const step = Effect.fnUntraced(function* (pick: SecretPick) {\n    ${emit("project-pick", "{ path, output, move: l11Moves++, pick, available: [...remaining], repeat: remaining.size === 0 }")}\n    if (remaining.size === 0) {`,
  ),
  edit(
    file,
    "\n    const marker = forms(secret)[pick.encoding] ?? secret;",
    `\n    const marker = forms(secret)[pick.encoding] ?? secret;\n    ${emit("project-cut", "{ path, output, point, marker }")}`,
  ),
  edit(
    file,
    "  for (const text of outputs[output]) {",
    `  ${emit("project-end", "{ path, output, moves: l11Moves, reached: reached.size, expected, inspected: outputs[output].length, leaked: outputs[output].some((text) => secretForms.some((form) => text.includes(form))) }")}\n  for (const text of outputs[output]) {`,
  ),
];

export class MappingError extends Schema.TaggedError<MappingError, { readonly brand: unique symbol }>()(
  "MappingError",
  {
    reason: Schema.Literals(["source_missing", "anchor_missing", "anchor_duplicate", "source_encoding"]),
  },
) {}

const utf8 = new TextDecoder("utf-8", { fatal: true });

const encoder = new TextEncoder();

export const derive = (saved: ReadonlyMap<string, Uint8Array>, edits: readonly Edit[]) => {
  const result = new Map<string, Uint8Array>();

  for (const change of edits) {
    const bytes = result.get(change.path) ?? saved.get(change.path);

    if (bytes === undefined) {
      return Result.fail(MappingError.make({ reason: "source_missing" }));
    }

    const decoded = Result.try(() => utf8.decode(bytes));

    if (Result.isFailure(decoded)) {
      return Result.fail(MappingError.make({ reason: "source_encoding" }));
    }

    const text = decoded.success;
    const at = text.indexOf(change.before);

    if (at < 0) {
      return Result.fail(MappingError.make({ reason: "anchor_missing" }));
    }

    if (text.includes(change.before, at + change.before.length)) {
      return Result.fail(MappingError.make({ reason: "anchor_duplicate" }));
    }

    result.set(change.path, encoder.encode(text.slice(0, at) + change.after + text.slice(at + change.before.length)));
  }

  return Result.succeed(result);
};

export const prepare = Effect.fnUntraced(function* (
  request: Request,
  variant: Variant,
  saved: ReadonlyMap<string, Uint8Array>,
) {
  const digest = yield* Digest.Digest;
  const allowed = transformed[`${request.case}/${variant}`];

  if (allowed === undefined) {
    return Result.fail("mapping_missing");
  }

  const edits = request.case === "l11-inputs" ? observer(variant) : mappings(request);

  for (const path of Object.keys(allowed)) {
    const bytes = saved.get(path);

    const expected =
      path === file
        ? sources[variant].law
        : path === runtime
          ? hashes[runtime]
          : path === children
            ? hashes[children]
            : null;

    if (bytes === undefined || expected === null || (yield* digest.digestHex(Digest.sha256, bytes)) !== expected) {
      return Result.fail("source_drift");
    }
  }

  const result = derive(saved, edits);

  if (Result.isFailure(result)) {
    return result;
  }

  if (result.success.size !== Object.keys(allowed).length) {
    return Result.fail("source_drift");
  }

  for (const [path, bytes] of result.success) {
    if ((yield* digest.digestHex(Digest.sha256, bytes)) !== allowed[path]) {
      return Result.fail("transform_drift");
    }
  }

  return result;
});
