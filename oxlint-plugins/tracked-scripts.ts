// `pnpm lint`'s hold on 0113: no tracked shell or Python file, except one 0113 ordered ported that
// has not been yet, or a marked edge. A file is one by its `.sh` or `.py` name, or, with no
// extension, by a `#!` line naming a shell or Python (the lead's ruling on S1's review, recorded in
// the plan's S1 row). It is a lint step, not an oxlint rule, since oxlint reads only
// JavaScript and TypeScript and never sees a `.sh` file; it reads git's tracked files, so a person's
// untracked scratch script is left alone (docs/plan/quests/port-scripts-0113-PLAN.md, "The lint
// hold").
//
//   node oxlint-plugins/tracked-scripts.ts            # this repo
//   node oxlint-plugins/tracked-scripts.ts <folder>   # another git tree
//
// Exit 0 when clean, 1 on a finding, 2 when git listed nothing, which must never read as clean.
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The scripts 0113 orders ported that are still here. It only shrinks: a port deletes its line in
 * the commit that deletes its file, and a line whose file is gone fails lint. No line is added
 * (0113, 0524). When it is empty, this list and the code that reads it go.
 */
export const NOT_YET_PORTED: ReadonlyArray<string> = [
  ".agents/skills/lead/scripts/box.sh",
  ".agents/skills/lead/scripts/env.sh",
  ".agents/skills/lead/scripts/leakgrep.sh",
  ".agents/skills/lead/scripts/loosening.sh",
  ".agents/skills/lead/scripts/mutbox-entry.sh",
  ".agents/skills/lead/scripts/redact.sh",
  ".agents/skills/lead/scripts/runplan.sh",
  ".agents/skills/lead/scripts/skillscheck.sh",
  ".agents/skills/mutation/scripts/run.sh",
  ".agents/skills/plan/scripts/plancheck.sh",
  ".agents/skills/step-commit/scripts/exam.py",
  ".agents/skills/step-commit/scripts/stepcommit.sh",
  "scripts/typecheck.sh",
  // today's version, deleted with it (0525)
  "bin/tsh",
  "packages/fabrika/bin/tsh-small",
  "packages/pipeline/bin/tsh",
];

/** A file that runs as shell or Python, by its name. */
const SCRIPT = /\.(?:sh|py)$/;

/** A file name with no extension, whose `#!` line says what runs it. */
const BARE = /(?:^|\/)\.?[^./]+$/;

/** The `#!` line's interpreter and the words after it. */
const BANG = /^#!\s*(\S+)(.*)/;

/** An interpreter that makes a file shell or Python: `sh`, `bash`, `zsh`, `python3.12` and kin. */
const RUNS_AS_SCRIPT = /^(?:(?:a|ba|da|k|mk|z|c|tc|y|fi)?sh|python[\d.]*|pypy[\d.]*)$/;

/**
 * An `env` option whose value is the next word: GNU coreutils env's `-u`/`--unset NAME`,
 * `-C`/`--chdir DIR` and `-a`/`--argv0 ARG` (https://www.gnu.org/software/coreutils/manual/html_node/env-invocation.html),
 * and BSD env's `-u name`, `-C altwd`, `-P altpath` and `-L`/`-U user[/class]`
 * (https://man.freebsd.org/cgi/man.cgi?query=env&sektion=1). A short one may end a cluster of
 * flags that take none, as in `-iu NAME`. The `--unset=NAME` form is one word, a flag like any
 * other. `-S` takes the rest of the line, which env splits and reads again, so it is a flag here.
 */
const TAKES_VALUE = /^(?:-[0iv]*[uCaPLU]|--(?:unset|chdir|argv0))$/;

/** The interpreter `env` runs: the first word that is not a flag, an option's value or a `NAME=value`. */
const envTarget = ([word, ...rest]: ReadonlyArray<string>): string => {
  if (word === undefined) {
    return "";
  }

  if (TAKES_VALUE.test(word)) {
    return envTarget(rest.slice(1));
  }

  return word.startsWith("-") || word.includes("=") ? envTarget(rest) : word;
};

/**
 * Whether a file with no extension is shell or Python by its first line. Through `env`, the
 * interpreter is the first word that is not a flag, an option's value or a `NAME=value`, so
 * `#!/usr/bin/env -S -u FOO bash -e` reads as bash.
 */
const runsAsScript = (text: string): boolean => {
  const bang = BANG.exec(text.split("\n", 1)[0] ?? "");

  if (bang === null) {
    return false;
  }

  const first = bang[1]?.split("/").at(-1) ?? "";
  const name = first === "env" ? envTarget((bang[2] ?? "").split(/\s+/).filter((word) => word !== "")) : first;

  return RUNS_AS_SCRIPT.test(name.split("/").at(-1) ?? "");
};

/** How many lines from the top an edge line may sit in, so it is seen beside the shebang. */
const HEAD = 5;

/** Any line that means to be an edge line, well formed or not. */
const EDGE_WORD = /^#\s*edge:/;

/** An edge line: `# edge: <reason> (0113)`, with a reason that says something. */
const EDGE = /^#\s*edge:(.*)\(0113\)\s*$/s;

/** What one tracked or listed path does wrong. */
type Finding =
  /** Tracked, not on the list, and with no edge line in its first lines. */
  | { readonly _tag: "new_script"; readonly path: string }
  /** On the list, and git does not track it: the port landed, so its line goes. */
  | { readonly _tag: "stale_entry"; readonly path: string }
  /** Tracked, with an `# edge:` line that gives no reason or no `(0113)`. */
  | { readonly _tag: "edge_unmarked"; readonly path: string };

/** The edge lines in a file's first lines: whether one is well formed, and whether one is not. */
const edges = (text: string): { readonly marked: boolean; readonly broken: boolean } => {
  const lines = text
    .split("\n")
    .slice(0, HEAD)
    .filter((line) => EDGE_WORD.test(line));

  const good = lines.filter((line) => /\S/.test(EDGE.exec(line)?.[1] ?? ""));

  return { marked: good.length > 0, broken: good.length < lines.length };
};

/**
 * Every finding for these tracked paths: `head` gives the text of a tracked `.sh` or `.py` file,
 * or of one with no extension, of which only the first lines are read. A file with no extension
 * is a script when its `#!` line names a shell or Python. Listed paths come first, in the list's
 * order, then the tracked ones.
 */
export const check = (tracked: ReadonlyArray<string>, head: (path: string) => string): ReadonlyArray<Finding> => {
  const present = new Set(tracked);
  const listed = new Set(NOT_YET_PORTED);

  const stale: ReadonlyArray<Finding> = NOT_YET_PORTED.filter((path) => !present.has(path)).map((path) => ({
    _tag: "stale_entry",
    path,
  }));

  const scripts = tracked
    .filter((path) => !listed.has(path) && (SCRIPT.test(path) || BARE.test(path)))
    .map((path) => ({ path, text: head(path) }))
    .filter(({ path, text }) => SCRIPT.test(path) || runsAsScript(text));

  const found = scripts.flatMap(({ path, text }): ReadonlyArray<Finding> => {
    const { marked, broken } = edges(text);

    if (broken) {
      return [{ _tag: "edge_unmarked", path }];
    }

    return marked ? [] : [{ _tag: "new_script", path }];
  });

  return [...stale, ...found];
};

const FIX = `Write it in TypeScript and Effect (0113); a script that must run before Node exists carries one "# edge: <why> (0113)" line in its first ${HEAD} lines, decided in its pull request.`;

/** The line lint prints for one finding, naming its path. */
export const line = (finding: Finding): string => {
  switch (finding._tag) {
    case "new_script":
      return `tracked-scripts: ${finding.path} is a shell or Python file. ${FIX}`;
    case "stale_entry":
      return `tracked-scripts: ${finding.path} is on NOT_YET_PORTED, and git does not track it: delete its line in oxlint-plugins/tracked-scripts.ts, since the list only shrinks.`;
    case "edge_unmarked":
      return `tracked-scripts: ${finding.path} has an "# edge:" line with no reason or no "(0113)". ${FIX}`;
  }
};

if (import.meta.main) {
  const root = process.argv[2] ?? join(import.meta.dirname, "..");
  const listed = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 2 ** 30 });
  const tracked = listed.stdout.split("\0").filter((path) => path !== "");

  if (listed.status !== 0 || tracked.length === 0) {
    console.error(`tracked-scripts: git listed no tracked files.\n${listed.stderr}`);
    process.exit(2);
  }

  // A symbolic link (`.claude/skills/<name>`, into `.agents/skills/`) has no text of its own: the
  // file it points at is tracked and read in its own right.
  const findings = check(tracked, (path) =>
    lstatSync(join(root, path)).isFile() ? readFileSync(join(root, path), "utf8") : "",
  );

  for (const finding of findings) {
    console.error(line(finding));
  }

  if (findings.length > 0) {
    process.exit(1);
  }

  console.log(`tracked-scripts: ${NOT_YET_PORTED.length} scripts not yet ported, every other script an edge`);
}
