// p32 and p65, strict layers: the laws of `fabrika/package-imports`, the names of our own packages
// each part of next/ may import (ticket 987, moved from the exam's `layers.test.ts`). The planted
// files are linted with the repository's own `.oxlintrc.json`, at their real paths, so the config's
// table is under test with the rule. Each case names the lines that fire, or none.
import { describe, expect, it } from "vitest";
import { plant } from "../next/apps/fabrika/src/exam/plant.ts";

const CODE = "fabrika(package-imports)";
const LIB = "next/packages/libfabrika/src";
const TUVAL = "next/packages/tuval/src";

const lines = (...each: ReadonlyArray<string>): string => `${each.join("\n")}\n`;

/** Each planted file, and the lines the rule fires on in it. */
const CASES: ReadonlyArray<readonly [path: string, text: string, fires: ReadonlyArray<number>]> = [
  // The library imports none of our packages by name: not tuval, not a program, not itself.
  [`${LIB}/ledger/Log.ts`, lines('import {view} from "@kampus/tuval";'), [1]],
  [`${LIB}/runtime/Runner.ts`, lines('import {member} from "@kampus/libfabrika/processes/Process";'), [1]],
  [`${LIB}/node/Wire.ts`, lines('export * from "@kampus/fabrika-design";', 'import {x} from "effect";'), [1]],
  // A test is not judged here; `pnpm lint:layers` refuses its upward imports.
  [`${LIB}/ledger/Log.test.ts`, lines('import {counter} from "@kampus/counter";'), []],
  [`${TUVAL}/desktop/layout.ts`, lines('import {run} from "@kampus/libfabrika";'), []],
  [`${TUVAL}/desktop/fold.ts`, lines('import {log} from "@kampus/libfabrika/data";'), [1]],
  [
    `${TUVAL}/window/machine.ts`,
    lines(
      'import {Link} from "@kampus/libfabrika/transport/Link";',
      'import {Client} from "@kampus/libfabrika";',
      'import {start} from "@kampus/libfabrika/client/WindowStart";',
      'import {themes} from "@kampus/fabrika-design";',
      'import "@kampus/fabrika-design/tokens.css";',
      'import {wire} from "@kampus/libfabrika/transport";',
    ),
    [],
  ],
  [
    `${TUVAL}/window/main.ts`,
    lines(
      'import {Connection} from "@kampus/libfabrika/transport/Connection";',
      'import {grant} from "@kampus/libfabrika/coordination";',
      'import {support} from "@kampus/libfabrika/client/WindowStart.test-support";',
    ),
    [1, 2, 3],
  ],
  [`${TUVAL}/dom/root.ts`, lines('import {run} from "@kampus/libfabrika";'), [1]],
  [
    `${TUVAL}/browser/rows.ts`,
    lines(
      'import {ClientRows} from "@kampus/libfabrika/transport/ClientRows";',
      'import {Client} from "@kampus/libfabrika";',
      'import {themes} from "@kampus/fabrika-design";',
      'import "@kampus/fabrika-design/tokens.css";',
    ),
    [2, 3, 4],
  ],
  [`${TUVAL}/electron/menu.ts`, lines('import {grant} from "@kampus/libfabrika/coordination";'), []],
  [`${TUVAL}/headless/run.ts`, lines('export const run = () => import("@kampus/libfabrika");'), [1]],
  // tuval's entry file is not a part.
  [`${TUVAL}/index.ts`, lines('export {fold} from "@kampus/libfabrika/ledger/Log";'), []],
  // A program's box takes the library's root; its window, the `.tsx` files, takes tuval's too.
  [
    "next/programs/notes/src/program.ts",
    lines('import {defineProgram} from "@kampus/libfabrika";', 'type View = import("@kampus/tuval").View;'),
    [2],
  ],
  [
    "next/programs/notes/src/root.ts",
    lines('export {send} from "@kampus/tuval";', 'import {wire} from "@kampus/libfabrika/transport/Wire";'),
    [1, 2],
  ],
  [
    "next/programs/notes/src/view.tsx",
    lines(
      'import {useModel} from "@kampus/tuval";',
      'import {key} from "@kampus/tuval/browser";',
      'import "@kampus/tuval/style.css";',
      'import {notes} from "./program.ts";',
    ),
    [2, 3],
  ],
  ["next/programs/notes/src/view.laws.test.tsx", lines('import {Wire} from "@kampus/libfabrika/transport/Wire";'), []],
  // next/apps is the wiring, and imports anything.
  [
    "next/apps/fabrika/src/brain.ts",
    lines('import {log} from "@kampus/libfabrika/ledger/Log";', 'import {fold} from "@kampus/tuval";'),
    [],
  ],
];

describe("fabrika/package-imports", () => {
  // scenario: one planted file per part, with the names its table allows and refuses, since the
  // table is the law and only a real oxlint run reads it from `.oxlintrc.json`.
  // Plant: give the window part's `may` the whole `@kampus/libfabrika/transport/*` reach. Then
  // `transport/Connection` passes in `window/main.ts`, and line 1 stops firing.
  it("each part fires on exactly the names its table refuses", async () => {
    const result = await plant(Object.fromEntries(CASES.map(([path, text]) => [path, text])));
    expect(Object.fromEntries(CASES.map(([path]) => [path, result(CODE, path)]))).toEqual(
      Object.fromEntries(CASES.map(([path, , fires]) => [path, fires])),
    );
  });
});
