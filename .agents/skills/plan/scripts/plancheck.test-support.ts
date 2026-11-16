// Today's tooling: what plancheck.test.ts and plancheck.draft.test.ts share, so CI can run the two
// files on different machines.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { expect } from "vitest";

// Today's tooling. Run each plant in a disposable copy of the script beside this test.
export const script = join(import.meta.dirname, "plancheck.sh");

export const options = { seed: 520, numRuns: 24 };

export const table = (heads: string[], rows: string[][]) =>
  [heads, heads.map(() => "---"), ...rows].map((row) => `| ${row.join(" | ")} |`).join("\n");

export const laws = (cell: string) => table(["Law", "Generator", "Plant"], [["holds", cell, "break it"]]);

export const check = (body: string, marker = "Plancheck-Version: 2") => {
  const folder = mkdtempSync(join(tmpdir(), "pc-"));

  try {
    const plan = join(folder, "plan.md");
    writeFileSync(plan, `Approved by the lead agent, builds ticket 520.\n\n${marker}\n\n${body}\n`);
    const words = join(folder, "words");
    writeFileSync(words, "private_generated\n");

    const ran = spawnSync("sh", [script, plan], {
      encoding: "utf8",
      timeout: 5_000,
      env: { ...process.env, FABRIKA_LEAK_WORDS: words, TYPESAFE_API_KEY: undefined },
    });

    expect(ran.error).toBeUndefined();
    expect(ran.signal).toBeNull();

    return { code: ran.status, text: ran.stdout + ran.stderr };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
};

export const word = fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/);

export const handoff = (text: string, draft = false) => {
  const folder = mkdtempSync(join(tmpdir(), "pc-300-"));

  try {
    const plan = join(folder, "plan.md");
    writeFileSync(plan, text);
    const words = join(folder, "words");
    writeFileSync(words, "private_generated\n");

    const ran = spawnSync("sh", [script, ...(draft ? ["--draft"] : []), plan], {
      encoding: "utf8",
      timeout: 5_000,
      env: { ...process.env, FABRIKA_LEAK_WORDS: words, TYPESAFE_API_KEY: undefined },
    });

    expect(ran.error).toBeUndefined();
    expect(ran.signal).toBeNull();

    return { code: ran.status, text: ran.stdout + ran.stderr };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
};

export const constructor = fc.constantFrom(
  "boolean",
  "integer",
  "nat",
  "bigInt",
  "float",
  "double",
  "string",
  "array",
  "uniqueArray",
  "tuple",
  "record",
  "oneof",
  "option",
  "constantFrom",
  "dictionary",
  "anything",
  "jsonValue",
  "uint8Array",
  "shuffledSubarray",
);

export const allowed = fc.oneof(
  fc.constantFrom("lint", "type"),
  fc
    .tuple(constructor, fc.boolean(), word)
    .map(([name, described, description]) => `fc.${name}${described ? `: ${description}` : ""}`),
  fc
    .tuple(fc.constantFrom("arbMsg", "arbRecordMsg", "arbMsgSequence", "arbGuidedSequence"), fc.boolean(), word)
    .map(([name, described, description]) => `@demlik/tea/pbt.${name}${described ? `: ${description}` : ""}`),
  fc.tuple(word, word).map(([a, b]) => `Effect Arbitrary: ${a}.${b}`),
  fc
    .tuple(fc.constantFrom("vector", "format", "pinned", "scenario"), word)
    .map(([label, description]) => `${label}: ${description}`),
);

const refused = fc.oneof(
  fc.constantFrom("example-based", "examples(3)", "TBD", "todo", "?", "hand-picked", "", "none"),
  word.map((name) => `fc.unknown_${name}`),
  constructor.map((name) => `some text fc.${name}`),
  constructor.map((name) => `fc.${name}()`),
  fc.constantFrom(
    "vector:",
    "format:  ",
    "pinned: !!!",
    "scenario: ?",
    "FC.string",
    "Effect Arbitrary: x + y",
    "@demlik/tea/pbt.unknown",
    "fc.string trailing text",
  ),
);

export const wrap = fc.constantFrom("", "`", "**", "_");

export const cell = fc.oneof(
  allowed.map((text) => ({ text, pass: true })),
  refused.map((text) => ({ text, pass: false })),
);

// T321's complete plan, and its approval line over the body's digest.
export const digest = (body: string) => createHash("sha256").update(Buffer.from(body)).digest("hex");

export const estimateLine = "Estimate: 4 steps, $6";

export const complete = (extra = "") =>
  [
    "# Today's tooling",
    "",
    "```text",
    "plan -> check -> approve",
    "```",
    "",
    "## Laws",
    laws("fc.record: generated inputs"),
    "",
    "## Files",
    table(["File", "Owner step"], [["src/plain.ts", "build"]]),
    "",
    "## Size",
    "Size: 1 agent hour, 80 lines. Confidence: 85%.",
    estimateLine,
    "",
    "## What it records",
    "Approval digests and run IDs.",
    "",
    "## What it cannot tell us",
    "No live run was tried.",
    "",
    "## Open questions",
    "None.",
    extra,
  ].join("\n");

// Version 2 by default: a plan approved before the Estimate line keeps passing.
export const approved = (body: string, note = "the decided note", version = 2) =>
  `Approved by the lead agent, builds ${note}; body ${digest(body).slice(0, 12)}\nPlancheck-Version: ${version}\n${body}`;
