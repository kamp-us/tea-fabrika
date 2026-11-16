// `pnpm lint`'s first step: oxlint, with one difference. Oxlint has two levels, warn and error, and
// this repo needs a third: printed, and never failing. So oxlint reports everything as JSON here,
// and this prints all of it and fails on all of it but advice. Advice is a fire of the five old
// advice rules or the docs rule that a dirty folder's warn override grades a warning (advice.ts,
// 0523): each of the six blocks in every folder at zero.
//
// Why one run and not two: an `oxlint-disable` that names a rule turned off counts as unused. A
// second run for the advice rules would turn their own disable comments into failures of the first.
import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { advises, stale, warnLines } from "./advice.ts";
import { audit } from "./anti-slop.ts";
import { checkTracked } from "./gitignore.mjs";
import { type Finding, fingerprint, LEDGERS, outside, settle } from "./ledger.ts";
import { load, scriptReads } from "./script-reads.mjs";

interface Diagnostic {
  readonly code?: string;
  readonly message: string;
  readonly severity?: string;
  readonly help?: string;
  readonly filename?: string;
  readonly labels?: readonly { readonly span: { readonly line: number; readonly column: number } }[];
}

const ROOT = join(import.meta.dirname, "..");

// A run with no path is over the whole repo, as `pnpm lint` and `pnpm format` make it. Only it sees
// every finding, so only it prunes a ledger, and only it runs the check below.
const whole = process.argv.slice(2).every((arg) => arg.startsWith("-"));

// What a lead-script test reads is derived for Vitest (script-reads.mjs). This fails on what the
// derivation cannot see, and on a test that declares by hand what is derived. It reads the whole
// scripts tree whatever the paths given, so a run on a folder or a file leaves it to the whole run:
// it took most of a one-file run's second, and a test that starts 32 of those timed out in CI.
const reads = Effect.gen(function* () {
  const { tree, exists, prose } = load(ROOT);
  const { raw, unreached } = scriptReads(tree, exists, prose);

  for (const row of raw) {
    yield* Console.error(
      `${row.test}: delete the bare import of ${row.path}?raw. A script's reads are derived; one it reads through a built path is named in that script, in a comment`,
    );
  }

  for (const path of unreached) {
    yield* Console.error(
      `${path}: no test reaches it and its SKILL.md names no such tool. Name it in the script that reads it, give it a test, or delete it`,
    );
  }

  return raw.length > 0 || unreached.length > 0 ? 1 : 0;
});

/** What oxlint said, or `null` when it did not finish and report: that must never read as clean. */
const read = (ran: SpawnSyncReturns<string>) =>
  Effect.try({
    try: (): readonly Diagnostic[] | null => {
      const report: {
        readonly diagnostics?: readonly Diagnostic[];
        readonly number_of_files?: number;
      } = JSON.parse(ran.stdout);
      return report.diagnostics !== undefined && report.number_of_files !== 0 ? report.diagnostics : null;
    },
    catch: () => null,
  }).pipe(Effect.orElseSucceed(() => null));

const where = ({ filename, labels }: Diagnostic) => {
  const at = labels?.[0]?.span;
  return at === undefined ? (filename ?? "") : `${filename}:${at.line}:${at.column}`;
};

const lines = new Map<string, readonly string[]>();

/** A finding as the ledger keys it: its file from the repo's top, its rule and its line of code. */
const finding = (d: Diagnostic): Finding => {
  const file = relative(ROOT, resolve(process.cwd(), d.filename ?? ""));

  if (!lines.has(file)) {
    lines.set(file, existsSync(join(ROOT, file)) ? readFileSync(join(ROOT, file), "utf8").split("\n") : []);
  }

  const line = d.labels?.[0]?.span.line;
  return {
    file,
    rule: d.code ?? "",
    code: fingerprint(line === undefined ? "" : (lines.get(file)?.[line - 1] ?? "")),
  };
};

// The hint oxlint keeps apart from the message, such as the JSON.parse rule's Schema hint.
const text = (d: Diagnostic) => (d.help === undefined ? d.message : `${d.message} ${d.help}`);

/** The whole run: it prints every finding and answers the exit code. */
const main = Effect.gen(function* () {
  if (whole && (yield* reads) !== 0) {
    return 1;
  }

  // A `.gitignore` hides a file from oxlint and oxfmt, and neither can be told to stop without also
  // walking into `node_modules`. Git keeps a tracked file tracked under a new `.gitignore`, so one line
  // in one could take a whole folder out of the checks. Only `.gitignore` files count here, not this
  // machine's own ignore list.
  const hidden = checkTracked();

  if (!hidden.ok) {
    yield* Console.error(
      `Git failed or a .gitignore hides tracked files from the lint and format checks: ${hidden.files.map((file: string) => JSON.stringify(file)).join(", ")}`,
    );
    return 2;
  }

  // The one config at the top of the repo, on purpose. On its own, oxlint obeys a config in any folder
  // and a `.eslintignore` where it runs, and either could take a folder out of the checks. The config's
  // own `ignorePatterns` still apply, and those are read in review.
  const ran = spawnSync(
    join(ROOT, "node_modules", ".bin", "oxlint"),
    [
      `--config=${join(ROOT, ".oxlintrc.json")}`,
      "--disable-nested-config",
      "--no-ignore",
      "--format=json",
      ...process.argv.slice(2),
    ],
    { cwd: process.cwd(), encoding: "utf8", maxBuffer: 2 ** 30 },
  );

  const diagnostics = yield* read(ran);

  if (diagnostics === null) {
    yield* Console.error(`oxlint did not finish: status ${ran.status}\n${ran.stdout}\n${ran.stderr}`);
    return 2;
  }

  // What a folder broke the day a rule joined it, which only shrinks (ledger.ts).
  const ledgers = LEDGERS.map((ledger) => {
    const path = join(ROOT, ledger.file);
    const read: { readonly entries: readonly Finding[] } = existsSync(path)
      ? JSON.parse(readFileSync(path, "utf8"))
      : { entries: [] };
    return { ...ledger, path, entries: read.entries, refused: outside(read.entries, ledger.root) };
  });

  for (const { file, root, refused } of ledgers) {
    for (const entry of refused) {
      yield* Console.error(`${file}: ${entry.file} is outside ${root}, the one folder this ledger holds`);
    }
  }

  const found = diagnostics.filter((d) => !advises(d));
  const findings = found.map(finding);

  // Each ledger settles what the one before left blocking. A file sits in at most one ledger's folder,
  // so the order changes nothing.
  let open: readonly Finding[] = findings;

  const settled = ledgers.map((ledger) => {
    const result = settle(ledger.entries, open, ledger.root);
    open = result.blocks;
    return { ...ledger, ...result };
  });

  const waived = new Set(settled.flatMap((ledger) => ledger.waived));

  const blocks = found.filter((_, i) => {
    const at = findings[i];
    return at === undefined || !waived.has(at);
  });

  const advised = diagnostics.filter((d) => advises(d));

  for (const d of advised) {
    yield* Console.log(`${where(d)} ${d.code ?? ""} advice, this folder is not at zero yet: ${text(d)}`);
  }

  for (const d of blocks) {
    yield* Console.log(`${where(d)} ${d.code ?? ""} ${text(d)}`);
  }

  // Only a whole run sees every fire, so only it says which warn lines have no fire left (0523). The
  // lines come from oxlint's own reading of the config, comments and overrides resolved.
  const printed = whole
    ? spawnSync(
        join(ROOT, "node_modules", ".bin", "oxlint"),
        [`--config=${join(ROOT, ".oxlintrc.json")}`, "--print-config"],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          maxBuffer: 2 ** 28,
        },
      )
    : undefined;

  if (printed !== undefined && printed.status !== 0) {
    yield* Console.error(`oxlint --print-config failed: status ${printed.status}\n${printed.stderr}`);
    return 2;
  }

  const stuck =
    printed === undefined
      ? []
      : stale(
          warnLines(JSON.parse(printed.stdout)),
          advised.map((d) => ({ ...d, filename: relative(ROOT, resolve(process.cwd(), d.filename ?? "")) })),
        );

  for (const { _tag, line } of stuck) {
    yield* Console.error(
      _tag === "zero"
        ? `.oxlintrc.json: ${line.rule} has no fire left in ${line.glob}: delete it from the rule's warn override, so it blocks there (0523)`
        : `.oxlintrc.json: ${line.rule}'s warn line ${line.glob} names a file; a warn line names a folder (0523)`,
    );
  }

  // The anti-slop plugin, taken as it ships (0563). Only a whole run says whether vendor/anti-slop/ is
  // still the pinned commit's code, and only it sees every folder, so only it runs the zero lock: a
  // folder with no hit of a taken rule goes on that rule's list (anti-slop.ts).
  const vendored = printed === undefined ? [] : audit(ROOT, printed.stdout);

  for (const line of vendored) {
    yield* Console.error(line);
  }

  // Only a whole run prunes. A run on a folder or a file leaves each ledger as it is.
  for (const { file, path, entries, kept } of settled) {
    const pruned = entries.length - kept.length;

    if (whole && pruned > 0) {
      writeFileSync(path, `${JSON.stringify({ entries: kept }, null, "\t")}\n`);
      yield* Console.log(`${file}: pruned ${pruned} fixed entries; commit the file`);
    }
  }

  yield* Console.log(
    `oxlint: ${blocks.length} blocking, ${advised.length} advice, ${settled
      .map(({ file, waived }) => `${waived.length} in ${file}`)
      .join(", ")}`,
  );

  const clean =
    blocks.length === 0 &&
    stuck.length === 0 &&
    vendored.length === 0 &&
    ledgers.every(({ refused }) => refused.length === 0);

  return clean ? 0 : 1;
});

process.exitCode = Effect.runSync(main);
