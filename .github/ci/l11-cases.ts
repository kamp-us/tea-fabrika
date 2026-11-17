// Today's lead tooling. Fixed mappings for next/'s L11 experiment, never caller-provided edits.
import { Effect, Result, Schema } from "effect";
import { Digest } from "effect/crypto";

export const cached = "875e45de42b4dceee1aa47b57a046050ada4a4dc";

export const uncached = "ab47ff27805749e5cfb27a2170cbea381304b7ca";

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
} as const;

export const hashes = {
  [runtime]: "b9a29ebd2f4b153c392983d09c2781bacbb9d581a98cc8cf1f68908f389c24fc",
  [children]: "f4a3d647242f362c5b6292e54eae107d936331469aee9b7a2c44a1b316f1ab51",
  lock: "1800791fae8716cfb063adc7bd50822a0bfe07d7980eb599543e07c948032c95",
  workspace: "2dbe2a8e5e781cefa412fb2a43723b6dad1c8586bb49948d5d79eb1f81bef758",
  product: "569885dc19fffbfad3b52a48eb763be0fe525318",
};

export const transformed: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "l11-inputs/uncached": { [file]: "4eb7f414dc28e22fda77f624be321b8a6ec13303e8adc32898cc3666de27aa0d" },
  "l11-inputs/cached": { [file]: "2581ca91788402f9da602e6a776691abb3c04975c317f060a492dda08ceeafa8" },
  "l11-reply/cached": { [runtime]: "0cd49ba37cc7f557e7ce346defee74befe0e108095c0948b68911cd70ce23289" },
  "l11-log/cached": { [runtime]: "04df7c298d87046efa79617ff2fdcd963c0358eb39f2f12e61cf4310329e4ed4" },
  "l11-span-name/cached": {
    [runtime]: "adcb8439d9e85ad6c52e632093745d04a95f463b64e0c8e85c65367f11444bcf",
    [children]: "ffa01bb783d683691039fe89657ae84e200892607c0dea5849696f41569cfe43",
    [file]: "364043301ef9d4245de0cbff34ff0f7d029ee42b37bb145448fa6d07b0aafe1c",
  },
  "l11-span-code/cached": {
    [runtime]: "0412942c3ef0519d797cc2e5373b02b7eea6f3dce90a824b3b0d6f0acae32b4d",
    [children]: "f5e91df698d971c89eeb36004293b7ba0130ce72a04f5da5fa50ecc58db5f1cc",
    [file]: "abe88136f0a736afe7a6059a6e50c2fc10359aaca190324a8094149ce5a601b7",
  },
  "l11-span-errcode/cached": {
    [runtime]: "0412942c3ef0519d797cc2e5373b02b7eea6f3dce90a824b3b0d6f0acae32b4d",
    [children]: "f5e91df698d971c89eeb36004293b7ba0130ce72a04f5da5fa50ecc58db5f1cc",
    [file]: "467db2781c222a489f3ccdc15e17fb13b51e85a9b042316c7674d392d4ca339b",
  },
};

export const diffs: Readonly<Record<string, string>> = {
  "l11-inputs/cached": "07b9a4c2a742106a906fc09fc583c339e8f92e20dfe470baf1b6ef7b1d8bd5e6",
  "l11-inputs/uncached": "c61c599f22261cc12981f76e745c1ffcdafbc7de9aeef84d78f7749f07c4c2da",
  "l11-reply/cached": "8f76d24ae09e4c927d39126baf0cc707fec2a0a8587da24619a9452c90ea5a43",
  "l11-span-name/cached": "4a8b9feadb4f112b96f5a812219d74c6aa25cdeb2ddfe413afc13b5d4a480bea",
  "l11-span-code/cached": "c27de1123acc3928d79bfb0f7ec62fb1cb80dcc8dc03d4ccff6ea6df7c5337e9",
  "l11-span-errcode/cached": "d693b59afc98d6ba9459936fe9c79e3bd722a6e3a0362b1c9cc14ac547e328f0",
  "l11-log/cached": "3f582e883329484a4d6334fa716238091c47b04344a409ea1fe9c762aed1c3d1",
};

const setupHashes: ReadonlyArray<readonly [string, string]> = [
  [hashes.lock, "pnpm-lock.yaml"],
  ...(["cached", "uncached"] as const).flatMap((variant): Array<[string, string]> => [
    [hashes.lock, `source-${variant}/pnpm-lock.yaml`],
    [hashes.workspace, `source-${variant}/pnpm-workspace.yaml`],
    [sources[variant].law, `source-${variant}/${file}`],
    [hashes[runtime], `source-${variant}/${runtime}`],
    [hashes[children], `source-${variant}/${children}`],
  ]),
];

export const bootstrap = [
  `test "$(git -C source-cached rev-parse HEAD)" = ${cached}`,
  `test "$(git -C source-uncached rev-parse HEAD)" = ${uncached}`,
  ...[
    ...new Set(
      setupHashes.flatMap(([, path]) =>
        path
          .split("/")
          .slice(0, -1)
          .map((_, index) =>
            path
              .split("/")
              .slice(0, index + 1)
              .join("/"),
          ),
      ),
    ),
  ].map((path) => `test -d '${path}' && test ! -L '${path}'`),
  ...setupHashes.flatMap(([hash, path]) => [
    `test -f '${path}' && test ! -L '${path}'`,
    `printf '%s\\n' '${hash}  ${path}' | sha256sum --check --status`,
  ]),
].join("\n");

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

export const names = [
  ...titles,
  `${prefix}scenario: L10: a committed child without its descriptor recovers and configures once`,
  `${prefix}scenario: L10: a retry after the first alarm write fails arms the saved wake`,
  `${prefix}scenario: Desk S1 L1, L2: the founder's letter starts two programs with no start grant, as the fabrika's owner, and each started line names the founder as member`,
  `${prefix}scenario: L9: a code start sends nothing to any client: no view, no notify, no focus`,
  `${prefix}scenario: L10: a started child runs, and a throw restarts it in its own object while others keep their counts`,
  "Desk S1: start and stop refusals decode by name L4: every stop_child and start_child refusal decodes by its name, and no other word does",
];

const cliName = (name: string): string => {
  for (const suite of [
    "P42 slice 1: a code start on the real Worker path",
    "Desk S1: start and stop refusals decode by name",
  ]) {
    const start = `${suite} `;

    if (name.startsWith(start)) {
      return `${suite} > ${name.slice(start.length)}`;
    }
  }

  throw new Error("unmapped fixed L11 title");
};

export const collection = names.map((reporter) => ({ name: cliName(reporter), reporter }));

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

export const argv = (request: Request, report: string, list = false, reporter?: string) => {
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
    args.push(`--testNamePattern=^(?:${selected(request).map(cliName).map(escaped).join("|")})$`);
  }

  return list
    ? [...args, "--staticParse=false", `--json=${report}`]
    : [
        ...args,
        "--reporter=json",
        ...(output(request) !== null && reporter !== undefined ? [`--reporter=${reporter}`] : []),
        `--outputFile=${report}`,
      ];
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

const spanObservation = (field: "name" | "code" | "errcode"): readonly Edit[] => {
  const attribute = field === "name" ? "error.type" : "fab.ledger.code";

  const helper = `const l11Attribution = Schema.Struct({
  path: Schema.Literals(${JSON.stringify([...new Set([...storagePaths, ...paths])])}),
  field: Schema.Literal(${JSON.stringify(field)}), encoding: Schema.Literals([1, 2]),
  operation: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
const l11Observe = (batches: readonly unknown[], secret: string, marker: string, encoding: number, path: (typeof l11Attribution.Type)["path"], operation: number | null = null) => {
  if ((encoding !== 1 && encoding !== 2) || marker === secret) { return; }
  const matched = batches.some((batch) => {
    const rows = Schema.decodeUnknownResult(Schema.Array(Schema.Struct({ span: SpanRow })))(batch);
    return Result.isSuccess(rows) && rows.success.some((row) => row.span.attributes[${JSON.stringify(attribute)}] === marker);
  });
  if (!matched) { return; }
  const task = TestRunner.getCurrentTest();
  if (task === undefined) { return; }
  const before = Schema.decodeUnknownResult(Schema.Struct({ l11: Schema.optional(Schema.Array(l11Attribution)) }))(task.meta);
  if (Result.isFailure(before)) { return; }
  Object.assign(task.meta, { l11: [...(before.success.l11 ?? []), l11Attribution.make({ path, field: ${JSON.stringify(field)}, encoding, operation })] });
};

`;

  return [
    edit(
      file,
      'import { assert, describe, expect, expectTypeOf, it, vi } from "vitest";',
      'import { assert, describe, expect, expectTypeOf, it, vi, TestRunner } from "vitest";',
    ),
    edit(file, "const forms = (text: string) =>", `${helper}const forms = (text: string) =>`),
    edit(
      file,
      "  const fixture = yield* childProject();\n  const outputs: Record<ChildOutput, Array<string>>",
      "  const l11Picks: Array<{ marker: string; encoding: number }> = [];\n  const fixture = yield* childProject();\n  const outputs: Record<ChildOutput, Array<string>>",
    ),
    edit(
      file,
      '    fixture.fail(point, error, path === "exit" || point === "owner" ? undefined : pid);',
      '    l11Picks.push({ marker, encoding: pick.encoding });\n    fixture.fail(point, error, path === "exit" || point === "owner" ? undefined : pid);',
    ),
    edit(
      file,
      "  const secretForms = forms(secret);\n\n  for (const text of outputs[output])",
      '  const secretForms = forms(secret);\n  if (output === "span") {\n    for (const pick of l11Picks) { l11Observe(fixture.recorded, secret, pick.marker, pick.encoding, path); }\n  }\n\n  for (const text of outputs[output])',
    ),
    edit(
      file,
      "            outputs.span.push(...outputText(fixture.recorded));\n          }),",
      "            outputs.span.push(...outputText(fixture.recorded));\n            l11Observe(fixture.recorded, secret, marker, pick.encoding, cut.path, cut.operation);\n          }),",
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
      return [guard(runtime, "name"), guard(children, "name"), ...fault("name"), ...spanObservation("name")];
    case "l11-span-code":
      return [guard(runtime, "code"), guard(children, "code"), ...fault("code"), ...spanObservation("code")];
    case "l11-span-errcode":
      return [guard(runtime, "code"), guard(children, "code"), ...fault("errcode"), ...spanObservation("errcode")];
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

export const derive = (
  saved: ReadonlyMap<string, Uint8Array>,
  edits: readonly Edit[],
): Result.Result<Map<string, Uint8Array>, MappingError> => {
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
): Effect.fn.Return<
  Result.Result<Map<string, Uint8Array>, MappingError | "mapping_missing" | "source_drift" | "transform_drift">,
  never,
  Digest.Digest
> {
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
