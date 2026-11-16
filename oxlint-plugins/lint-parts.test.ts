// Ticket 1101, the box-memory ticket: `pnpm lint` runs its parts that open a TypeScript API child one
// after another, never at once. Each such child takes about 3 GB; run together beside one more agent,
// they pushed a cloud box over its memory cgroup's limit, and the kernel killed one mid-run (finding
// 2026-11-16-ts-api-epipe-hides-the-oom-kill). A test, not lint or type: what is held is a value in
// `package.json`, which no lint rule of ours reads and no type sees.
//
// The parts that open one, read from the installed code: `lint:dead` (code-graph `--unreachable`)
// and `lint:kind` (code-graph `--graph --edges`, from oxlint-plugins/test-kind.ts) reach code-graph
// 0.15.0's `TypeContext.open` (dist/index.js:6309, through `assembleGraphWithEdges`), and
// `lint:promise-types` opens the TypeScript 7.0.2 API itself. `lint:layers` and `lint:boundaries`
// run code-graph gates that read imports only, with no TypeScript API.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const API_PARTS = ["lint:dead", "lint:kind", "lint:promise-types"];

const manifest: { readonly scripts: Readonly<Record<string, string>> } = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"),
);

/** The parts `pnpm lint` hands its runner: each single-quoted argument of `parallel.ts`. */
const parts = (script: string): ReadonlyArray<string> => [...script.matchAll(/'([^']*)'/g)].map((m) => m[1] ?? "");

const names = (part: string, name: string) => new RegExp(`(?:^|\\s)${name}(?:\\s|;|&|\\||$)`).test(part);

// Plant: split the TypeScript API parts back into three arguments, as before ticket 1101.
it("scenario: pnpm lint runs its TypeScript API parts one after another, in one part of its runner", () => {
  const lint = manifest.scripts["lint"] ?? "";
  expect(lint.startsWith("node oxlint-plugins/parallel.ts ")).toBe(true);

  // Each named part is still a script, so a rename cannot leave this law holding nothing.
  for (const name of API_PARTS) {
    expect(manifest.scripts[name]).toBeDefined();
  }

  const holding = parts(lint).filter((part) => API_PARTS.some((name) => names(part, name)));
  // One runner part holds all three, so the runner never starts two of them at once.
  expect(holding).toHaveLength(1);
  const [part = ""] = holding;

  for (const name of API_PARTS) {
    expect(names(part, name)).toBe(true);
  }

  // Inside it the shell runs them in turn: nothing is sent to the background with a lone `&`.
  expect(part.replaceAll("&&", "")).not.toContain("&");
});
