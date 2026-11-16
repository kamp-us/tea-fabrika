// Every machine has laws (docs/direction/every-machine-has-laws.md) and passes the sync test
// (docs/direction/saved-state.md, S2), in `next/` (0591, which moves the exam's text scan
// `laws-scan` here). A product file that calls `Machine.make(` has a laws file beside it:
// `<name>.laws.test.ts`, `<name>.<more>.laws.test.ts`, or their `.integration.` and `.visual.`
// forms. One of its laws files holds a property law (`it.prop`, `it.effect.prop`, `it.live.prop`,
// `fc.assert`, or one of tea's pbt runners, `property*` and `law*` from `@demlik/tea/pbt`), and one
// calls `syncTest(` or says `// sync test left out: <why>` with a reason, since a machine leaves the
// sync test "only by name, with a reason". The two checks answer with two messages, so a missing
// laws file and a missing sync test read apart.
//
// A machine made inline counts too, and a laws file named after another file does not. Test files
// pass: `*.test.ts`, `*.test-support.ts` and the `*Test.ts` kits `.oxlintrc.json` names as test
// support. The laws files are read from disk beside the linted file, as `program-package-layout`
// reads its package. Misses: an alias of `Machine`, a laws file in another folder, and a property
// law whose runner is a helper of the laws file's own.
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { CreateRule, ESTree } from "@oxlint/plugins";
import { parseSync, Visitor } from "oxc-parser";
import { below, dotted, type Node } from "./match.ts";

const TEST = /(?:\.test\.tsx?|\.test-support\.tsx?|Test\.tsx?)$/;
const LAWS = /\.laws(?:\.integration|\.visual)?\.test\.tsx?$/;
const PBT = "@demlik/tea/pbt";
const PROPERTY_CALLS = new Set(["it.prop", "it.effect.prop", "it.live.prop", "fc.assert"]);
const PBT_RUNNER = /^(?:property|law)[A-Z]/;
const LEFT_OUT = /^[ \t]*sync test left out:[ \t]*\S/;

const member = (node: ESTree.MemberExpression): string | null =>
  !node.computed && node.property.type === "Identifier"
    ? node.property.name
    : node.computed && node.property.type === "Literal" && typeof node.property.value === "string"
      ? node.property.value
      : null;

/** `Machine.make(...)`, `Machine["make"](...)` or `tea.Machine.make(...)`. */
const makesMachine = (node: Node): boolean => {
  if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression") {
    return false;
  }

  const { callee } = node;
  const object = callee.object;
  return (
    member(callee) === "make" &&
    ((object.type === "Identifier" && object.name === "Machine") ||
      (object.type === "MemberExpression" && member(object) === "Machine"))
  );
};

/** What one laws file holds: a property law, and a sync test or its reason. */
type Held = { readonly property: boolean; readonly sync: boolean };

const NOTHING: Held = { property: false, sync: false };

const heldBy = (file: string): Held => {
  let text: string;

  try {
    text = readFileSync(file, "utf8");
  } catch {
    return NOTHING;
  }

  const parsed = parseSync(file, text);
  const runners = new Set<string>();
  let property = false;
  let sync = parsed.comments.some((c) => c.type === "Line" && LEFT_OUT.test(c.value));

  for (const statement of parsed.program.body) {
    if (statement.type === "ImportDeclaration" && statement.source.value === PBT && statement.importKind !== "type") {
      for (const spec of statement.specifiers) {
        if (spec.type === "ImportSpecifier" && spec.importKind !== "type" && spec.imported.type === "Identifier") {
          if (PBT_RUNNER.test(spec.imported.name)) {
            runners.add(spec.local.name);
          }
        }
      }
    }
  }

  new Visitor({
    CallExpression(node) {
      const name = dotted(node.callee as Node);

      if (name === null) {
        return;
      }

      if (PROPERTY_CALLS.has(name) || runners.has(name)) {
        property = true;
      }

      if (name === "syncTest" || name.endsWith(".syncTest")) {
        sync = true;
      }
    },
  }).visit(parsed.program);
  return { property, sync };
};

/** The laws files beside `file`: same folder, named `<stem>.` and ending in a laws suffix. */
const lawsOf = (file: string): ReadonlyArray<string> => {
  const stem = basename(file).replace(/\.tsx?$/, "");
  let names: ReadonlyArray<string>;

  try {
    names = readdirSync(dirname(file));
  } catch {
    return [];
  }

  return names
    .filter((name) => name.startsWith(`${stem}.`) && LAWS.test(name))
    .map((name) => join(dirname(file), name));
};

export const machineHasLaws: CreateRule = {
  create(context) {
    return {
      "Program:exit"(program) {
        if (TEST.test(context.filename)) {
          return;
        }

        const call = [...below(program)].find(makesMachine);

        if (call === undefined) {
          return;
        }

        const held = lawsOf(context.filename).map(heldBy);

        if (!held.some((h) => h.property)) {
          context.report({
            node: call,
            message: `Every machine has laws (docs/direction/every-machine-has-laws.md). Add ${basename(context.filename).replace(/\.tsx?$/, "")}.laws.test.ts beside this file, with a property law on the machine's real init and update (it.prop, it.effect.prop, fc.assert or tea's pbt).`,
          });
          return;
        }

        if (!held.some((h) => h.sync)) {
          context.report({
            node: call,
            message:
              "Every machine passes the sync test (docs/direction/saved-state.md, S2). Call syncTest( from libfabrika's Testing.ts in one of its laws files, or write `// sync test left out: <why>` with the reason read from the machine.",
          });
        }
      },
    };
  },
};
