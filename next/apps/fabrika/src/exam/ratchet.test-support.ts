// What ratchet.test.ts and ratchet.integration.test.ts share: a list file's text from its rows, and
// the rows every scenario starts from.
export const text = (entries: ReadonlyArray<object>) => JSON.stringify({ entries });

export const ROWS = {
  "next-ledger.json": [{ file: "next/a.ts", rule: "fabrika(no-of)", code: "const a = 1;" }],
  "agents-ledger.json": [{ file: ".agents/a.mjs", rule: "fabrika(no-of)", code: "const a = 1;" }],
  "unreachable-ledger.json": [{ scope: ".", kind: "only-called-from-tests", id: "a.ts:a", reason: "kept" }],
} as const;
