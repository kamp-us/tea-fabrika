import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { estimateIn } from "../../lead/scripts/chain.ts";
import {
  approved,
  check,
  complete,
  constructor,
  digest,
  estimateLine,
  handoff,
  laws,
  script,
  table,
  word,
  wrap,
} from "./plancheck.test-support.ts";

// Today's tooling: plancheck.sh's --draft and --approved checks. Its table grammar is in plancheck.test.ts.

// T321 keeps normal saved-plan reads in plancheck.test.ts. New structure checks run at the approval
// boundary.
const modeCheck = (text: string, mode: "--draft" | "--approved") => {
  const folder = mkdtempSync(join(tmpdir(), "pc-321-"));

  try {
    const path = join(folder, "plan.md");
    writeFileSync(path, Buffer.from(text));
    const words = join(folder, "words");
    writeFileSync(words, "private_generated\n");

    const ran = spawnSync("sh", [script, mode, path], {
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

describe("T686 size advice in the draft check, today's tooling", () => {
  // Plant: let a slice's size fail the draft, name a slice by its size, or drop the size line. 0099
  // says no number caps a pull request, so the exit code is the same whatever the slices expect.
  it("property: the draft prints the plan's size, names no slice by its line count and never changes the exit code", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 5000 }), { minLength: 1, maxLength: 4 }), (slices) => {
        const listed = slices.map((lines, at) => `${at + 1}. **Slice ${at + 1}: ${lines} lines.**`).join("\n");

        const body = complete().replace(
          "Size: 1 agent hour, 80 lines. Confidence: 85%.",
          `Size: 1 agent hour. Confidence: 85%.\n\n${listed}`,
        );

        const ran = modeCheck(`\nPlancheck-Version: 3\n${body}`, "--draft");
        expect(ran.code, ran.text).toBe(0);
        expect(ran.text).toContain(`${slices.length} slices, the largest ${Math.max(...slices)}\n`);
        expect(ran.text).not.toMatch(/size: slice \d+|\bcap\b/);
      }),
      { seed: 686, numRuns: 4 },
    );
  });
});

describe("T321 K11 sections and K2 approval, today's tooling", () => {
  // Plant: count required content inside fences. Each deletion is tried alone.
  it("K11 requires each section outside fences and a whole opening code block", () => {
    fc.assert(
      fc.property(word, fc.constantFrom("```", "~~~"), (title, fence) => {
        const body = complete(`\n${title}\n`);
        const good = modeCheck(`\nPlancheck-Version: 3\n${body}`, "--draft");
        expect(good.code, good.text).toBe(0);

        for (const part of [
          "```text\nplan -> check -> approve\n```\n",
          `## Laws\n${laws("fc.record: generated inputs")}\n`,
          `## Files\n${table(["File", "Owner step"], [["src/plain.ts", "build"]])}\n`,
          "Size: 1 agent hour, 80 lines. Confidence: 85%.",
          "## What it records\nApproval digests and run IDs.\n",
          "## What it cannot tell us\nNo live run was tried.\n",
          "## Open questions\nNone.",
        ]) {
          const without = body.replace(part, "");
          expect(without).not.toBe(body);

          const decoy = part.startsWith("```")
            ? "## Example\n```text\nlate opening block\n```"
            : `${fence}md\n${part}\n${fence}`;

          const bad = modeCheck(`\nPlancheck-Version: 3\n${without}\n${decoy}\n`, "--draft");
          expect(bad.code, `${part}\n${bad.text}`).toBe(1);
          expect(bad.text).not.toMatch(/usage:|Traceback|cannot read installed/);
        }
      }),
      { seed: 321, numRuns: 3 },
    );
  });

  // Plant: accept one lean for several open questions, or a size with no percent.
  it("K11 checks each question's lean and percent, and the size confidence", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 99 }), word, (percent, text) => {
        for (const questions of [
          "None.",
          `1. ${text}? Lean yes, ${percent}%.`,
          `1. ${text}? Lean yes, ${percent}%.\n2. Another? Lean no, ${percent}%.`,
        ]) {
          const body = complete().replace("None.", questions);
          const good = modeCheck(`\nPlancheck-Version: 3\n${body}`, "--draft");
          expect(good.code, good.text).toBe(0);
        }

        for (const body of [
          complete().replace("85%", "sure"),
          complete().replace("None.", `1. ${text}? Lean yes, ${percent}%.\n2. Another?`),
          complete().replace("None.", `1. ${text}? ${percent}%.`),
          // Review round 1, finding 9: "None." followed by unnumbered questions.
          complete().replace("None.", `None.\n- ${text}?`),
          complete().replace("None.", `None.\n* ${text}?`),
          complete().replace("None.", `None.\n+ ${text}?`),
          complete().replace("None.", `None.\n${text}, and is it ready?`),
        ]) {
          const bad = modeCheck(`\nPlancheck-Version: 3\n${body}`, "--draft");
          expect(bad.code, bad.text).toBe(1);
        }
      }),
      { seed: 321, numRuns: 3 },
    );
  });

  // Plant: scan only table rows. These qualified exam paths appear in prose, lists and fences.
  it("K11 every exam path outside tables needs its own tests-owned files row", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          ".github/workflows/check.yaml",
          "oxlint-plugins/laws.ts",
          ".agents/skills/lead/scripts/box.test.ts",
        ),
        fc.constantFrom("prose", "list", "code"),
        (path, place) => {
          const mention =
            place === "code"
              ? `\n\`\`\`text\n${path}\n\`\`\``
              : place === "list"
                ? `\n- \`${path}\``
                : `\nChange \`${path}\` here.`;

          const body = complete(mention);
          const bad = modeCheck(`\nPlancheck-Version: 3\n${body}`, "--draft");
          expect(bad.code, bad.text).toBe(1);
          expect(bad.text).toContain(path);
          const withRow = body.replace("| src/plain.ts | build |", `| src/plain.ts | build |\n| ${path} | tests |`);
          const good = modeCheck(`\nPlancheck-Version: 3\n${withRow}`, "--draft");
          expect(good.code, good.text).toBe(0);
        },
      ),
      { seed: 321, numRuns: 6 },
    );
  });

  // Plants: let an anchored path, a bare anchor or a note word through as an owner key, or refuse
  // a plain path, a root file or a folder. stepcommit matches keys to staged paths exactly
  // (ticket 425, quest t411: `serve.test.ts:162`, `:537` and `new` became keys).
  it("property: --draft fails a files-table path that is no repo path, naming its row", () => {
    fc.assert(
      fc.property(word, fc.integer({ min: 1, max: 999 }), (name, line) => {
        const path = `src/${name}.test.ts`;

        const at = (cell: string) =>
          complete().replace("| src/plain.ts | build |", `| src/plain.ts | build |\n| ${cell} | tests |`);

        for (const [cell, key] of [
          [`\`${path}:${line}\``, `${path}:${line}`],
          [`\`${path}\`, \`:${line}\``, `:${line}`],
          [`\`${path}\`, new`, "new"],
        ] as const) {
          const bad = modeCheck(`\nPlancheck-Version: 3\n${at(cell)}`, "--draft");
          expect(bad.code, bad.text).toBe(1);
          expect(bad.text).toContain(`${key} is not a repo path`);
        }

        for (const cell of [`\`${path}\``, "`README.md`", `\`src/${name}/\``]) {
          const good = modeCheck(`\nPlancheck-Version: 3\n${at(cell)}`, "--draft");
          expect(good.code, `${cell}\n${good.text}`).toBe(0);
        }
      }),
      { seed: 425, numRuns: 3 },
    );
  });

  // Plants: hash line one; omit appended amendments; normalize CRLF, UTF-8 or the final LF.
  it("K2/K11 binds approval to exact bytes after the second LF, including amendments", () => {
    fc.assert(
      fc.property(
        fc.record({
          text: word,
          ending: fc.constantFrom("", "\n", "\r\n"),
          unicode: fc.constantFrom("é", "e\u0301", "猫", "🫖"),
        }),
        ({ text, ending, unicode }) => {
          const body = complete(`\n## Amendment 1\n${unicode} ${text}${ending}`);
          const draft = modeCheck(`\nPlancheck-Version: 3\n${body}`, "--draft");
          expect(draft.code, draft.text).toBe(0);
          expect(draft.text).toContain(digest(body));
          const good = modeCheck(approved(body), "--approved");
          expect(good.code, good.text).toBe(0);

          for (const edited of [
            `${body}\n`,
            body.replace(text, `${text}x`),
            body.replaceAll("\n", "\r\n"),
            `${body}\n## Amendment 2\nChanged.\n`,
          ]) {
            const stale = `${approved(body).split("\n").slice(0, 2).join("\n")}\n${edited}`;
            const bad = modeCheck(stale, "--approved");
            expect(bad.code, bad.text).toBe(1);
            expect(bad.text).toMatch(/hash|digest|body|approval/);
            const renewed = modeCheck(approved(edited), "--approved");
            expect(renewed.code, renewed.text).toBe(0);
          }
        },
      ),
      { seed: 321, numRuns: 3 },
    );
  });

  // Plant: read line one with splitlines(), so a CRLF approval passes here and fails in box.sh
  // and stepcommit.sh. Review round 1, finding 7.
  it("K2 approved mode refuses a CRLF approval line, as the byte readers do", () => {
    fc.assert(
      fc.property(word, (text) => {
        const body = complete(`\n## Amendment 1\n${text}\n`);
        const crlf = approved(body).replace("\n", "\r\n");
        const bad = modeCheck(crlf, "--approved");
        expect(bad.code, bad.text).toBe(1);
        expect(bad.text).toMatch(/approval/);
      }),
      { seed: 321, numRuns: 3 },
    );
  });

  // Plant: accept any approval-looking line or a duplicate lower in the body.
  it("K2 approved mode requires the exact lead approval grammar on line one", () => {
    fc.assert(
      fc.property(word, (note) => {
        const body = complete();
        const first = approved(body, note).split("\n")[0]!;
        const good = modeCheck(approved(body, note), "--approved");
        expect(good.code, good.text).toBe(0);

        for (const line of [
          "",
          first.replace("lead agent", "driver"),
          first.replace(`builds ${note};`, "builds ;"),
          first.replace("; body", "; digest"),
          first.replace(digest(body).slice(0, 12), digest(body).slice(0, 11)),
          `${first} extra`,
        ]) {
          const bad = modeCheck(`${line}\nPlancheck-Version: 2\n${body}`, "--approved");
          expect(bad.code, bad.text).toBe(1);
        }

        const duplicate = `${body}\n${first}\n`;
        expect(modeCheck(approved(duplicate), "--approved").code).toBe(1);
      }),
      { seed: 321, numRuns: 3 },
    );
  });
});

// The Estimate line, version 3 (.decisions/0076): the plan feeds chain.ts's backstop. Edge cases,
// listed before the code (0040), each with its case below:
//   missing                  no Estimate line at all
//   two                      two lines, both well formed, in Size and in another section
//   zero, negative           `0 steps`, `-2 steps`, `$0`, `$0.00`
//   decimal dollars          `$12.50` passes; `2.5 steps` fails
//   no dollar sign           `Estimate: 4 steps, 6`
//   in a code block          only inside a fence fails; a fenced copy beside the real line is two
//   trailing spaces          pass, as a writer cannot see them
//   not last in Size         a line after it in the Size section fails
//   old plans                version 2 approved plans keep passing; a version 2 draft is refused
const drafted = (body: string) => modeCheck(`\nPlancheck-Version: 3\n${body}`, "--draft");

const estimateFaults = {
  missing: () => complete().replace(`${estimateLine}\n`, ""),
  two: () => complete().replace("Approval digests and run IDs.", `Approval digests and run IDs.\n${estimateLine}`),
  zeroSteps: (d: number) => complete().replace(estimateLine, `Estimate: 0 steps, $${d}`),
  negativeSteps: (n: number, d: number) => complete().replace(estimateLine, `Estimate: -${n} steps, $${d}`),
  zeroDollars: (n: number) => complete().replace(estimateLine, `Estimate: ${n} steps, $0`),
  zeroCents: (n: number) => complete().replace(estimateLine, `Estimate: ${n} steps, $0.00`),
  decimalSteps: (n: number, d: number) => complete().replace(estimateLine, `Estimate: ${n}.5 steps, $${d}`),
  noDollarSign: (n: number, d: number) => complete().replace(estimateLine, `Estimate: ${n} steps, ${d}`),
  fencedOnly: (n: number, d: number) =>
    complete().replace(estimateLine, `\`\`\`text\nEstimate: ${n} steps, $${d}\n\`\`\``),
  fencedCopy: (n: number, d: number) =>
    complete().replace(estimateLine, `\`\`\`text\nEstimate: ${n} steps, $${d}\n\`\`\`\n${estimateLine}`),
  notLast: () => complete().replace(estimateLine, `${estimateLine}\nOne more size note.`),
};

type EstimateFault = keyof typeof estimateFaults;

describe("plan estimate, today's tooling", () => {
  // Plant: accept a draft with no Estimate line, or read the line chain.ts's estimateIn reads apart.
  it("a well-formed Estimate line ending Size passes the draft, and chain.ts reads its numbers", () => {
    fc.assert(
      fc.property(
        fc.record({
          steps: fc.integer({ min: 1, max: 60 }),
          dollars: fc.oneof(
            fc.integer({ min: 1, max: 200 }).map(String),
            fc.integer({ min: 1, max: 20_000 }).map((cents) => (cents / 100).toFixed(2)),
          ),
          unit: fc.constantFrom("steps", "step"),
          trailing: fc.string({ unit: fc.constantFrom(" ", "\t"), maxLength: 3 }),
        }),
        ({ steps, dollars, unit, trailing }) => {
          const line = `Estimate: ${steps} ${unit}, $${dollars}${trailing}`;
          const body = complete().replace(estimateLine, line);
          const got = drafted(body);
          expect(got.code, `${line}\n${got.text}`).toBe(0);
          expect(estimateIn(body)).toEqual({ steps, dollars: Number(dollars) });
        },
      ),
      {
        seed: 76,
        numRuns: 12,
        examples: [
          // vector: a decimal dollar amount.
          [{ steps: 12, dollars: "12.50", unit: "steps", trailing: "" }],
          // vector: trailing spaces a writer cannot see.
          [{ steps: 4, dollars: "6", unit: "steps", trailing: "   " }],
        ],
      },
    );
  });

  // Plant: drop any one fault's check; count a fenced line as the estimate; take the first of two.
  it("a missing, doubled, fenced, misplaced or malformed Estimate line fails with one message", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...(Object.keys(estimateFaults) as EstimateFault[])),
        fc.integer({ min: 1, max: 40 }),
        fc.integer({ min: 1, max: 90 }),
        (fault, n, d) => {
          const body = estimateFaults[fault](n, d);
          const got = drafted(body);
          expect(got.code, `${fault}\n${got.text}`).toBe(1);
          expect(got.text.match(/^plan estimate: /gm), got.text).toHaveLength(1);
          const approvedAt3 = modeCheck(approved(body, "the decided note", 3), "--approved");
          expect(approvedAt3.code, approvedAt3.text).toBe(1);
          expect(approvedAt3.text).toMatch(/^plan estimate: /m);
        },
      ),
      { seed: 76, numRuns: 22 },
    );
  });

  // scenario: plans approved at version 2 have no Estimate line and must keep passing; a draft must
  // carry version 3, so a writer cannot skip the line by writing the old version.
  it("scenario: version 2 approved plans keep passing, and a version 2 draft is refused", () => {
    const old = estimateFaults.missing();
    const kept = modeCheck(approved(old), "--approved");
    expect(kept.code, kept.text).toBe(0);
    expect(kept.text).not.toContain("plan estimate");
    const saved = handoff(approved(old));
    expect(saved.code, saved.text).toBe(0);
    const draft = modeCheck(`\nPlancheck-Version: 2\n${complete()}`, "--draft");
    expect(draft.code, draft.text).toBe(1);
    expect(draft.text).toContain("draft: put Plancheck-Version: 3 on line 2");
  });
});

describe("T325 K6 plancheck, today's tooling", () => {
  // No domain Schema for draft text. Plant: skip the shared checker or ignore its refusal.
  it("checks every draft addition with leakgrep and preserves clean plans", () => {
    fc.assert(
      fc.property(fc.record({ suffix: word, leak: fc.boolean(), draft: fc.boolean() }), ({ suffix, leak, draft }) => {
        const dir = mkdtempSync(join(tmpdir(), "pc-leak-"));

        try {
          const root = join(dir, "repo"),
            scripts = join(root, ".agents/skills");

          for (const part of ["plan", "lead", "step-commit"]) {
            mkdirSync(join(scripts, part, "scripts"), { recursive: true });
          }

          for (const file of ["plan/scripts/plancheck.sh", "lead/scripts/leakgrep.sh", "step-commit/scripts/exam.py"]) {
            cpSync(join(import.meta.dirname, "../..", file), join(scripts, file));
          }

          cpSync(join(import.meta.dirname, "../../../../exam-paths.json"), join(root, "exam-paths.json"));
          symlinkSync(join(import.meta.dirname, "../../../../node_modules"), join(root, "node_modules"));
          expect(spawnSync("git", ["init", "-q", root]).status).toBe(0);
          const privateWord = `private_${suffix}`;
          const words = join(dir, "words");
          writeFileSync(
            words,
            `${privateWord}\n${"https://github.com/usirin/tea-fabrika".split("/").slice(-2).join("\n")}\n`,
          );
          const plan = join(root, "plan.md");
          writeFileSync(
            plan,
            `${draft ? "" : "Approved by the lead agent, builds note."}\nPlancheck-Version: 3\n\n# Plan\n\n\`\`\`ts\nconst idea = 1;\n\`\`\`\n\n## Laws\n${laws("fc.record: text")}\n## Files\n${table(["File", "Owner step"], [["src/plain.ts", "build"]])}\n## Existing tools\n- \`src/plain.ts\`: searched src; none found.\n## Size\n2 files, 10 lines, 1 agent hour. Confidence: 90%.\nEstimate: 3 steps, $2\n## What it records\nRefusals.\n## What it cannot tell us\nNo live push.\n## Open questions\nNone.\nhttps://github.com/usirin/tea-fabrika/pull/532\n${leak ? privateWord : "Safe text."}\n`,
          );

          const run = () =>
            spawnSync("sh", [join(scripts, "plan/scripts/plancheck.sh"), ...(draft ? ["--draft"] : []), plan], {
              cwd: root,
              encoding: "utf8",
              timeout: 5_000,
              env: { ...process.env, FABRIKA_LEAK_WORDS: words, TYPESAFE_API_KEY: undefined },
            });

          const out = run();
          expect(out.error).toBeUndefined();
          expect(out.status, out.stdout + out.stderr).toBe(leak ? 1 : 0);
          writeFileSync(
            join(scripts, "lead/scripts/leakgrep.sh"),
            "#!/bin/sh\necho 'leakgrep: planted refusal' >&2\nexit 1\n",
          );
          expect(run().status).toBe(1);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }),
      { seed: 325, numRuns: 6 },
    );
  });
});

// 2026-11-11: a tests step looped on laws its box could never finish: a type law with an fc.
// generator, test laws with no run count, a Validation section asking for a typecheck. Measured
// over the saved plans, the kind check hit about 7 false alarms in 15, so all three advise and
// never change the exit code. Edge cases, each a case below:
//   kind: `type`, `lint: why`, `Type` and a wrapped `` `fc.array` `` advise; a `type` generator, a
//         `test` kind, a kind that also names a test, and a table with no kind column do not; both
//         kind headers (`Kind`, `Lint, type or test?`) are read.
//   runs: a test row with fc. and no count advises; `200 runs`, `1 run` and `default runs`
//         anywhere in the row do not; a non-fc generator does not.
//   validation: `--changed`, `changed tests` and `typecheck` in the Validation section advise,
//         fenced commands included; a line naming the lead, CI or the host, or saying no, does not;
//         the same words in another section do not; a legacy plan gets none of the three.
describe("laws and validation advice, today's tooling", () => {
  const advice = (text: string) => text.split("\n").filter((l) => l.startsWith("advice: "));
  const kindHead = fc.constantFrom("Kind", "Lint, type or test?");
  const row = (kind: string, generator: string, plant = "break it") => ["holds", kind, generator, plant];
  const kinded = (head: string, rows: string[][]) => table(["Law", head, "Generator", "Plant"], rows);
  const fcCell = constructor.map((name) => `fc.${name}: generated cases`);

  // Plant: drop the kind check, or let it fail the plan.
  it("property: a type or lint row with an fc. generator advises, and the exit code stays", () => {
    const kind = fc.constantFrom("type", "lint", "lint: source ownership", "Type");
    fc.assert(
      fc.property(kindHead, kind, fcCell, wrap, (head, k, gen, around) => {
        const got = check(kinded(head, [row(k, `${around}${gen}${around}`)]));
        expect(got.code, got.text).toBe(0);
        expect(advice(got.text), got.text).toEqual([
          expect.stringMatching(/^advice: line \d+: a (type|lint) law carries an fc\. generator/),
        ]);
      }),
      { seed: 1111, numRuns: 6 },
    );
  });

  // Plant: read the kind's first word only, so "type and runtime test" advises.
  it("vector: a type generator, a test kind, a kind that names a test and a table with no kind column do not advise", () => {
    const quiet = [
      kinded("Kind", [row("type", "type")]),
      kinded("Kind", [row("lint", "lint")]),
      kinded("Lint, type or test?", [row("test", "fc.record: x", "break it, 100 runs")]),
      kinded("Kind", [row("Type and runtime test", "fc.array: forged fields, default runs")]),
      table(["Law", "Generator", "Plant"], [["holds", "fc.record: x", "break it"]]),
    ];

    for (const body of quiet) {
      const got = check(body);
      expect(got.code, got.text).toBe(0);
      expect(advice(got.text), body).toEqual([]);
    }
  });

  // Plant: require the count in the generator cell only, or drop the singular.
  it("property: a test row with an fc. generator advises unless the row states its runs", () => {
    const runs = fc.constantFrom("", "200 runs", "1 run", "default runs", "Default runs");
    const at = fc.constantFrom("generator", "plant");
    fc.assert(
      fc.property(kindHead, fcCell, runs, at, (head, gen, count, location) => {
        const cells =
          location === "generator"
            ? row("test", count ? `${gen}, ${count}` : gen)
            : row("test", gen, `break it ${count}`);

        const got = check(kinded(head, [cells]));
        expect(got.code, got.text).toBe(0);
        expect(advice(got.text).length, got.text).toBe(count === "" ? 1 : 0);

        if (count === "") {
          expect(advice(got.text)[0]).toContain("states no run count");
        }
      }),
      { seed: 1112, numRuns: 8, examples: [["Kind", "fc.record: x", "", "generator"]] },
    );
    expect(advice(check(kinded("Kind", [row("test", "vector: the five verbs")])).text)).toEqual([]);
  });

  // Plant: read only text outside fences; skip the lead filter; read every section.
  it("vector: the Validation section advises on --changed, changed tests and typecheck, and nothing else does", () => {
    const law = kinded("Kind", [row("test", "fc.record: x, 50 runs")]);

    const told = [
      "- Run `nice -n 19 pnpm exec vitest run --changed origin/main` once.",
      "- Run changed tests once, then one typecheck.",
      "```sh\npnpm typecheck\n```",
    ];

    const quiet = [
      "- The lead runs `--changed` and one typecheck.",
      "- CI runs typecheck.",
      "- No `pnpm typecheck` in a box.",
      "- Run the narrow test file twice.",
    ];

    for (const said of told) {
      const got = check(`${law}\n\n## Validation\n\n${said}\n`);
      expect(got.code, got.text).toBe(0);
      expect(advice(got.text), said).toEqual([expect.stringContaining("the Validation section tells a boxed step")]);
    }

    for (const said of quiet) {
      expect(advice(check(`${law}\n\n## Validation\n\n${said}\n`).text), said).toEqual([]);
    }

    expect(advice(check(`${law}\n\n## Size\n\n- Run one typecheck.\n`).text)).toEqual([]);
    const legacy = `${kinded("Kind", [row("type", "fc.record: x")])}\n\n## Validation\n\n- Run one typecheck.\n`;
    expect(advice(check(legacy, "").text)).toEqual([]);
  });

  // Ticket 835 pins a quest's scripts: a copy of `.agents/` outside any checkout. box.sh runs the
  // approval check from that copy, so the check must find the repo through MAIN.
  // Plant: always `cd` to the script's own root, and the pinned run fails on "cannot find repository".
  it("scenario: from a pinned copy outside a checkout, the approval check reads the repo MAIN names", () => {
    const folder = mkdtempSync(join(tmpdir(), "pc-pin-"));

    try {
      const repo = join(import.meta.dirname, "../../../..");
      cpSync(join(repo, ".agents/skills/plan/scripts"), join(folder, ".agents/skills/plan/scripts"), {
        recursive: true,
      });
      cpSync(join(repo, ".agents/skills/lead/scripts"), join(folder, ".agents/skills/lead/scripts"), {
        recursive: true,
      });
      const body = complete("");
      const plan = join(folder, "plan.md");
      writeFileSync(plan, approved(body));
      const words = join(folder, "words");
      writeFileSync(words, "private_generated\n");
      const pinned = join(folder, ".agents/skills/plan/scripts/plancheck.sh");

      const run = (main: string | undefined) =>
        spawnSync("sh", [pinned, "--approved", plan], {
          encoding: "utf8",
          timeout: 20_000,
          cwd: folder,
          env: { ...process.env, FABRIKA_LEAK_WORDS: words, TYPESAFE_API_KEY: undefined, MAIN: main },
        });

      const withMain = run(repo);
      expect(withMain.status, withMain.stdout + withMain.stderr).toBe(0);

      const without = run(undefined);
      expect(without.status).toBe(1);
      expect(without.stderr).toContain("MAIN is not set");
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe("0587 an Existing tools line for each new helper, today's tooling", () => {
  // Plants: drop the existing tools check, stop reading the word "searched", read a line inside a
  // fence, or ask a line of a test file, a file in the repo or a file the tests step owns.
  const KNOWN = "- `src/plain.ts`: searched `rg plain src`; none found.";

  const plan = (row: string, line: string) =>
    complete()
      .replace("| src/plain.ts | build |", `| src/plain.ts | build |\n${row}`)
      .replace(KNOWN, `${KNOWN}\n${line}`);

  it("property: a new code file needs a line that names it and says what was searched", () => {
    fc.assert(
      fc.property(word, fc.constantFrom(".ts", ".tsx", ".mjs", ".js"), word, (name, ext, other) => {
        const path = `src/helpers/${name}${ext}`;
        const row = `| ${path} | build |`;
        const draft = (line: string) => modeCheck(`\nPlancheck-Version: 3\n${plan(row, line)}`, "--draft");

        const missing = draft("");
        expect(missing.code, missing.text).toBe(1);
        expect(missing.text).toContain(`plan existing tools: ${path} is a new code file`);

        const good = draft(`- \`${path}\`: searched \`rg ${name}\` and npm; none fits.`);
        expect(good.code, good.text).toBe(0);

        expect(draft(`- \`${path}\`: none fits.`).code).toBe(1);
        expect(draft(`- \`src/helpers/${other}x${ext}\`: searched npm; none fits.`).code).toBe(1);
        expect(draft(`\`\`\`text\n${path}: searched npm\n\`\`\``).code).toBe(1);
      }),
      { seed: 586, numRuns: 4 },
    );
  });

  it("scenario: asks no line of a test file, a file in the repo or a file the tests step owns", () => {
    for (const row of [
      "| src/helpers/fresh.test.ts | build |",
      "| .agents/skills/lead/scripts/pr/Queue.ts | build |",
      "| src/helpers/fresh-support.ts | tests |",
    ]) {
      const ran = modeCheck(`\nPlancheck-Version: 3\n${plan(row, "")}`, "--draft");
      expect(ran.code, ran.text).toBe(0);
    }
  });
});
