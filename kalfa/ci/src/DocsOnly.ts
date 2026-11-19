/**
 * The docs-only classifier: what kind of change a repo-relative path is. CI's changes job and the
 * lead's tools share it (decisions 0183, 0180 and 0090), so both answer alike for the same paths.
 *
 * - `code`: a program or a test reads the file. A path no rule below names is code too.
 * - `instructions`: an agent reads the file as its instructions, and no program runs it: skill prose,
 *   `AGENTS.md`, `CLAUDE.md` and an agent's definition (0180).
 * - `docs`: a field row, or Markdown that no program or skill reads (0183, 0090).
 *
 * This file imports nothing, so CI can run it before any install.
 */

/**
 * The trees whose Markdown a program or a test reads. kalfa/ is here too: a reader test reads the
 * parser adapter's location as text, and the package's README ships in its archive.
 */
const READ_TREES = ["programs/", "fixtures/", "packages/", "next/", "kalfa/"];

// Folders whose Markdown is an input, wherever they sit: an agent's brief or prompt, read by a program.
const INPUT_FOLDERS = new Set(["brief", "briefs", "prompt", "prompts"]);

// The skill trees. A skill's Markdown is prose or a script's input, never docs.
const SKILL_TREES = [".agents/skills/", ".claude/skills/"];

/** A skill's script, which a lead script or a test runs, whatever its extension. */
const isScript = (path: string): boolean => /^\.agents\/skills\/[^/]+\/scripts\//.test(path);

/** Skill prose: a Markdown file of `.agents/skills/` that is no script, or a `.claude/skills/<name>` entry. */
const isSkillProse = (path: string): boolean =>
  (path.startsWith(".agents/skills/") && path.endsWith(".md") && !isScript(path)) ||
  /^\.claude\/skills\/[^/]+$/.test(path);

/** An agent's definition, `.claude/agents/<name>.md`. */
const isAgentDefinition = (path: string): boolean => /^\.claude\/agents\/[^/]+\.md$/.test(path);

/** A file in a brief or prompt folder, at any depth below the root. */
const inInputFolder = (path: string): boolean =>
  path
    .split("/")
    .slice(0, -1)
    .some((dir) => INPUT_FOLDERS.has(dir));

/**
 * An `AGENTS.md` or `CLAUDE.md` that an agent reads. Not under `fixtures/`, not under a skill's own
 * folder and not in a brief or prompt folder, since a test or a program reads those (0180).
 */
const isInstructionMap = (path: string): boolean => {
  const name = path.slice(path.lastIndexOf("/") + 1);

  return (
    (name === "AGENTS.md" || name === "CLAUDE.md") &&
    !path.startsWith("fixtures/") &&
    !/^\.claude\/skills\/[^/]+\//.test(path) &&
    !inInputFolder(path)
  );
};

/** Instruction text: skill prose, an agent's definition, or an `AGENTS.md` or `CLAUDE.md` an agent reads. */
const isInstruction = (path: string): boolean =>
  isSkillProse(path) || isAgentDefinition(path) || isInstructionMap(path);

/**
 * A field row (decision 0090): a direct `.jsonl` file of `field/`, or any file in its `notes`, `runs`
 * or `findings` folder. Each new row is its own file.
 *
 * @category predicates
 */
export const isRow = (path: string): boolean =>
  /^field\/[^/]+\.jsonl$/.test(path) || /^field\/(?:notes|runs|findings)\//.test(path);

/**
 * Markdown that a program or a test reads, so a change to it is code. Briefs, prompts and fixtures are
 * inputs, skill prose in a brief or prompt folder included. An `AGENTS.md` or `CLAUDE.md` an agent reads
 * is never read this way: no program runs it, so `next/AGENTS.md` is not one.
 *
 * @category predicates
 */
export const reads = (path: string): boolean =>
  path.endsWith(".md") &&
  (READ_TREES.some((tree) => path.startsWith(tree)) || inInputFolder(path)) &&
  !isInstructionMap(path);

/**
 * What kind of change a path is: `code`, `instructions` or `docs`, as the top of this file says. Markdown
 * outside the skill trees that nothing reads is docs, like a field row (0183, 0090).
 *
 * @category getters
 */
export const kind = (path: string): "code" | "instructions" | "docs" => {
  if (reads(path)) {
    return "code";
  }

  if (isInstruction(path)) {
    return "instructions";
  }

  if (isRow(path) || (path.endsWith(".md") && !SKILL_TREES.some((tree) => path.startsWith(tree)))) {
    return "docs";
  }

  return "code";
};

/**
 * Whether a change is docs only (decisions 0183 and 0180): at least one path, and no path is code.
 * Instruction text counts as no code, since no program runs it. CI skips its heavy jobs on such a
 * change, and the lead's arm accepts one. The admin merge is stricter and takes only the `docs` kind.
 *
 * @category predicates
 */
export const docsOnly = (paths: readonly string[]): boolean =>
  paths.length > 0 && paths.every((path) => kind(path) !== "code");
