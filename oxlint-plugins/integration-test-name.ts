// 0584: a test's kind follows what it uses. Vitest picks a file's project by its name
// (vitest.config.ts's projects), and only plain files run on pull requests and the merge queue, so a
// `next/` test file whose own code starts a real thing must be named `*.integration.test.ts`, or
// `*.visual.test.ts` for a browser or Electron, and runs on main's full run (0536, 0581).
//
// What counts as a real thing is starters.ts's, which test-kind.ts reads too: a process, a socket,
// a browser, the local instance or workerd, a signal, the network, a SQLite file or a temp folder.
// It reads calls, never words: experiment 292 found that matching words marked 182 of next/'s 280
// test files and matching calls 137, against 133 that drive a resource. It sees the file's own code,
// not the helpers it calls: test-kind.ts prints those as advice, and the review names the real ones
// (oxlint-plugins/README.md gives the measured misses).
import type { CreateRule } from "@oxlint/plugins";
import { pathIn, type Node } from "./match.ts";
import { DRIVES, reader, visitor } from "./starters.ts";

/** The name of a test file that already says it starts a real thing. */
const NAMED = /\.(?:integration|visual)\.test\.tsx?$/;

export const integrationTestName: CreateRule = {
  meta: {
    messages: {
      opens:
        "`{{call}}` starts {{drives}}, a real thing, so this file runs on main's full run, never on a pull request (0584): name it `{{name}}.integration.test.ts`, or `.visual.test.ts` for a browser or Electron, beside the module it tests. Or run the law on the interface's in-memory layer.",
    },
  },
  create(context) {
    const file = pathIn(context);

    if (!file.startsWith("next/") || !/\.test\.tsx?$/.test(file) || NAMED.test(file)) {
      return {};
    }

    const name =
      file
        .replace(/\.test\.tsx?$/, "")
        .split("/")
        .pop() ?? file;

    const read = reader<Node>();

    return {
      ...visitor(read),
      "Program:exit"() {
        for (const open of read.opens("alone")) {
          context.report({
            node: open.node,
            messageId: "opens",
            data: { call: open.call, drives: DRIVES[open._tag], name },
          });
        }
      },
    };
  },
};
