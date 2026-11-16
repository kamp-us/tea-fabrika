// M6 of the exam-to-lint plan (0591): `fabrika/machine-has-laws` holds what the exam's text scan
// `laws-scan` held, on today's constructor `Machine.make(` and today's property laws. The planted
// folders `a` to `l` are the exam's own, rewritten: a machine with no laws file, laws with no
// property law, an inline machine whose laws are another file's, laws with no sync test, an empty
// reason; a test file's machine, a test kit and a plain file pass. Each run plants all twelve
// folders in a fresh temp folder, each laws file in one of its three forms, and lints each folder's
// files through oxlint's RuleTester, which reads the laws files beside them from disk.
//
// Plant, run once (0093): accept a laws file with no sync test and no reason (`held.some((h) =>
// h.sync)` made always true): red, `i/none.ts` and `k/bare.ts` lint clean.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as fc from "fast-check";
import { RuleTester } from "oxlint/plugins-dev";
import { expect, it } from "vitest";
import { machineHasLaws } from "./machine-has-laws.ts";

RuleTester.describe = (_name, fn) => fn();
RuleTester.it = (_name, fn) => fn();
const tester = new RuleTester({ cwd: import.meta.dirname });

const LAWS = /Every machine has laws/;
const SYNC = /Every machine passes the sync test/;

/** The three forms a laws file takes: `<name>.laws.test.ts` and its `.integration.` and `.visual.` kin. */
const FORMS = [".laws.test.ts", ".laws.integration.test.ts", ".laws.visual.test.ts"] as const;
type Form = (typeof FORMS)[number];

type Folder = {
  /** The files that are linted, each with what the rule must answer on its line 1. */
  readonly subjects: Readonly<Record<string, RegExp | null>>;
  /** Every file planted, a laws file named with `{laws}` where its form goes. */
  readonly files: Readonly<Record<string, string>>;
};

const MACHINE = (name: string) => `export const ${name} = Machine.make({ init, update });`;
const PROP = 'it.prop("holds", [Msgs], ([msgs]) => fold(msgs));';

// Each case names the exam folder it was (`laws-scan.integration.test.ts`'s `planted`).
const FOLDERS: Readonly<Record<string, Folder>> = {
  a: {
    subjects: { "machine.ts": null },
    files: { "machine.ts": MACHINE("m"), "machine{laws}": `${PROP}\nsyncTest(m, ctx, opts);` },
  },
  b: { subjects: { "link.ts": LAWS }, files: { "link.ts": MACHINE("link") } },
  c: {
    subjects: { "view.ts": LAWS },
    files: { "view.ts": MACHINE("view"), "view{laws}": 'import { it } from "vitest";\nit("one case", () => {});' },
  },
  d: {
    subjects: { "runner.ts": null },
    files: {
      "runner.ts": MACHINE("runner"),
      "runner.replay{laws}": "fc.assert(fc.property(msgs, (m) => fold(m)));\nsyncTest(runner, ctx, opts);",
    },
  },
  e: {
    subjects: { "inline.tsx": LAWS },
    files: {
      "inline.tsx": "export const parts = { a: Machine.make({ init, update }) };",
      "inline-other{laws}": `${PROP}\nsyncTest(parts.a, ctx, opts);`,
    },
  },
  f: {
    subjects: { "helper.test.ts": null, "helperTest.ts": null },
    files: { "helper.test.ts": MACHINE("m"), "helperTest.ts": MACHINE("kit") },
  },
  g: { subjects: { "plain.ts": null }, files: { "plain.ts": "export const plain = 1;" } },
  h: {
    subjects: { "sync.ts": null },
    files: {
      "sync.ts": MACHINE("sync"),
      "sync{laws}":
        'import { propertyTrace } from "@demlik/tea/pbt";\npropertyTrace(sync, opts);\nsyncTest(sync, ctx, opts);',
    },
  },
  i: {
    subjects: { "none.ts": SYNC },
    files: { "none.ts": MACHINE("none"), "none{laws}": 'it.effect.prop("holds", [Msgs], () => fold());' },
  },
  j: {
    subjects: { "out.ts": null },
    files: {
      "out.ts": MACHINE("out"),
      "out{laws}": 'it.live.prop("holds", [Msgs], () => fold());\n// sync test left out: its model holds a cache',
    },
  },
  k: {
    subjects: { "bare.ts": SYNC },
    files: { "bare.ts": MACHINE("bare"), "bare{laws}": `${PROP}\n// sync test left out:` },
  },
  l: {
    subjects: { "split.ts": null },
    files: { "split.ts": MACHINE("split"), "split{laws}": PROP, "split.sync{laws}": "syncTest(split, ctx, opts);" },
  },
};

const NAMES = Object.keys(FOLDERS);

it("M6: fires on each planted machine with no property law, or no sync test and no reason, in any laws-file form", () => {
  const reached = new Set<string>();

  fc.assert(
    fc.property(fc.array(fc.constantFrom(...FORMS), { minLength: NAMES.length, maxLength: NAMES.length }), (forms) => {
      // The real path: on a Mac the temp folder is behind a link.
      const root = realpathSync(mkdtempSync(join(tmpdir(), "machine-has-laws-")));

      try {
        for (const [i, name] of NAMES.entries()) {
          const form: Form = forms[i] ?? FORMS[0];
          reached.add(`${name}${form}`);

          for (const [file, text] of Object.entries(FOLDERS[name]?.files ?? {})) {
            const full = join(root, name, file.replace("{laws}", form));
            mkdirSync(dirname(full), { recursive: true });
            writeFileSync(full, `${text}\n`);
          }
        }

        for (const name of NAMES) {
          for (const [file, fires] of Object.entries(FOLDERS[name]?.subjects ?? {})) {
            const filename = join(root, name, file);
            const code = `${FOLDERS[name]?.files[file] ?? ""}\n`;
            tester.run("machine-has-laws", machineHasLaws, {
              valid: fires === null ? [{ code, filename }] : [],
              invalid: fires === null ? [] : [{ code, filename, errors: [{ line: 1, message: fires }] }],
            });
          }
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }),
    { seed: 119120, numRuns: 24 },
  );

  // Coverage: every folder was planted in every laws-file form at least once.
  expect(NAMES.flatMap((name) => FORMS.map((form) => `${name}${form}`)).filter((c) => !reached.has(c))).toEqual([]);
});
