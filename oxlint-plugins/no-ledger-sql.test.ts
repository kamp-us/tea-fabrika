// P12, next/. Shape belongs in lint; these laws test that rule with planted source.
// They were the exam's (next/apps/fabrika/src/exam/ledger-sql.integration.test.ts) until the exam-to-lint rule moved them
// here. Plant: stop reading bracket-quoted table names (`main.[entries]`), and line 3 stops firing.

import { String as Str, Array as Arr, pipe } from "effect";

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { plant } from "./plant.ts";

const CODE = "fabrika(no-ledger-sql)";

const FILE = "next/packages/libfabrika/src/cloudflare/runtime.ts";

describe("ledger SQL stays behind its service", () => {
  // One law drew 20 runs from the 12 combinations of table, spacing and case, each run a planted oxlint run: 16.5 s of CI's 60 s limit. Each combination is a law of its
  // own with one run, so all 12 are always checked (the 20 random runs could leave one out).
  for (const [table, space, upper] of [
    ["entries", " ", false],
    ["entries", "\n", false],
    ["entries", " /* checked */ ", false],
    ["entries", " ", true],
    ["entries", "\n", true],
    ["entries", " /* checked */ ", true],
    ["rings", " ", false],
    ["rings", "\n", false],
    ["rings", " /* checked */ ", false],
    ["rings", " ", true],
    ["rings", "\n", true],
    ["rings", " /* checked */ ", true],
  ] as const) {
    it(`refuses ledger table reads and writes outside the service, including aliases and templates, ${table}${upper ? " upper" : ""} with ${JSON.stringify(space)}`, () =>
      fc.assert(
        fc.asyncProperty(fc.constant(null), async () => {
          const word = upper ? Str.toUpperCase(table) : table;

          const queries = [
            `SELECT * FROM${space}${word} AS e`,
            `SELECT e.* FROM dev_clients c JOIN${space}"${word}" e ON 1=1`,
            `SELECT * FROM${space}main.[${word}]`,
            `DELETE FROM${space}\`${word}\``,
            `INSERT INTO${space}${word} VALUES (?)`,
            `UPDATE${space}${word} SET stream=?`,
          ];

          const body = `${pipe(
            queries,
            Arr.map((query) => `sql.exec(${JSON.stringify(query)});`),
            Arr.join("\n"),
          )}\nsql.exec(\`SELECT * FROM entries WHERE stream=\${stream}\`);`;

          const findings = await plant({
            [FILE]: body,
            "next/packages/libfabrika/src/ledger/internal/ledgerStore.ts": body,
            "next/packages/libfabrika/src/cloudflare/runtime.test.ts": body,
            "next/packages/libfabrika/src/processes/Process.test-support.ts": body,
            "packages/today/runtime.ts": body,
            "next/allowed.ts": 'sql.exec("SELECT * FROM dev_descriptors"); sql.exec("SELECT entries FROM directory");',
          });

          expect(findings(CODE, FILE)).toEqual([1, 2, 3, 4, 5, 6, 7]);

          for (const file of [
            "next/packages/libfabrika/src/ledger/internal/ledgerStore.ts",
            "next/packages/libfabrika/src/cloudflare/runtime.test.ts",
            "next/packages/libfabrika/src/processes/Process.test-support.ts",
            "packages/today/runtime.ts",
            "next/allowed.ts",
          ]) {
            expect(findings(CODE, file)).toEqual([]);
          }
        }),
        { seed: 119120, numRuns: 1 },
      ));
  }
});
