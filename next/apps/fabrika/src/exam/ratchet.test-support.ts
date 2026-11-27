// What ratchet.test.ts and ratchet.integration.test.ts share: a list file's text from its rows, and
// the rows every scenario starts from.
export const text = (entries: ReadonlyArray<object>) => JSON.stringify({ entries });

export const ROWS = {
  "next-ledger.json": [{ file: "next/a.ts", rule: "fabrika(no-of)", code: "const a = 1;" }],
  "agents-ledger.json": [{ file: ".agents/a.mjs", rule: "fabrika(no-of)", code: "const a = 1;" }],
  "unreachable-ledger.json": [{ scope: ".", kind: "only-called-from-tests", id: "a.ts:a", reason: "kept" }],
} as const;

/** The lead's tsconfig, with these paths in `exclude`: a comment line above each, and the file's own comments, as it is written. */
export const tsconfigText = (paths: ReadonlyArray<string>, note = "why it fails") =>
  [
    "{",
    "  // the file's own comments, which the reader drops",
    '  "include": ["raw.d.ts", "skills/**/*.ts"],',
    '  "exclude": [',
    ...paths.map((path, i) => `    // ${note}\n    ${JSON.stringify(path)}${i < paths.length - 1 ? "," : ""}`),
    "  ]",
    "}",
    "",
  ].join("\n");

/** The key the ratchet gives an `exclude` path of `.agents/tsconfig.json`. */
export const excludeKey = (path: string) => JSON.stringify([`.agents/${path}`]);
