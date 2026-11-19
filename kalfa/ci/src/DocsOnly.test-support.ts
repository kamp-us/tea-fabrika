// The one table every tool's law reads (decisions 0183, 0180 and 0090): CI's changes job, the lead's
// arm and the lead's admin merge. Each row is one change, as its paths are listed. `docsOnly` is what
// CI skips its heavy jobs on and what arm accepts. `adminDocs` is the admin merge's answer: `isAdminDocs`
// holds for every path (0183), so instruction text, and a README outside the admin merge's folders, is not.
//
// The rows 1657, 1650 and 1641 are the file lists of those pull requests on 2026-11-18, as GitHub
// listed them. The other rows are one path each, pinned: each names a kind of path a rule must not get wrong.

interface Row {
  readonly pr: string;
  readonly paths: readonly string[];
  readonly docsOnly: boolean;
  readonly adminDocs: boolean;
}

export const TABLE: readonly Row[] = [
  {
    pr: "1657",
    paths: [
      ".agents/skills/lead/SKILL.md",
      ".agents/skills/plan/SKILL.md",
      ".agents/skills/sev/SKILL.md",
      ".decisions/0615-mechanical-tickets-take-a-fix-command-branch.md",
      "AGENTS.md",
      "docs/direction/next-is-a-pipeline-pre-run.md",
      "docs/plan/README.md",
      "oxlint-plugins/README.md",
    ],
    docsOnly: true,
    adminDocs: false,
  },
  {
    pr: "1650",
    paths: [
      ".decisions/0601-program-make-with-optional-pipes.md",
      ".decisions/0613-kalfa-package-imports-are-a-guideline.md",
      "kalfa/AGENTS.md",
    ],
    docsOnly: true,
    adminDocs: false,
  },
  {
    pr: "1641",
    paths: [
      "field/findings/2026-11-18-merge-queue-settings-drift-from-0162.json",
      "field/findings/2026-11-18-sev0-freeze-cancels-mains-own-runs.json",
      "field/notes/2026-11-18-ci-sev0-integration-and-visual-laws-left-the-merge-line.json",
    ],
    docsOnly: true,
    adminDocs: true,
  },
  // A root README is docs for CI, but the admin merge takes docs only in its own folders (0183), so it refuses this.
  { pr: "README.md", paths: ["README.md"], docsOnly: true, adminDocs: false },
  {
    pr: ".claude/agents/step-build.md",
    paths: [".claude/agents/step-build.md"],
    docsOnly: true,
    adminDocs: false,
  },
  { pr: "next/AGENTS.md", paths: ["next/AGENTS.md"], docsOnly: true, adminDocs: false },
  {
    pr: ".agents/skills/lead/scripts/land.ts",
    paths: [".agents/skills/lead/scripts/land.ts"],
    docsOnly: false,
    adminDocs: false,
  },
  { pr: ".agents/skills/lead/gc.plist", paths: [".agents/skills/lead/gc.plist"], docsOnly: false, adminDocs: false },
  {
    pr: "next/packages/libfabrika/README.md",
    paths: ["next/packages/libfabrika/README.md"],
    docsOnly: false,
    adminDocs: false,
  },
  { pr: "kalfa/config/README.md", paths: ["kalfa/config/README.md"], docsOnly: false, adminDocs: false },
  { pr: "docs/plan/briefs/x.md", paths: ["docs/plan/briefs/x.md"], docsOnly: false, adminDocs: false },
  // Skill prose in a brief folder is an input, as changes.mjs read it before 810.
  {
    pr: ".agents/skills/lead/briefs/x.md",
    paths: [".agents/skills/lead/briefs/x.md"],
    docsOnly: false,
    adminDocs: false,
  },
  { pr: "fixtures/repo/AGENTS.md", paths: ["fixtures/repo/AGENTS.md"], docsOnly: false, adminDocs: false },
  { pr: "field/other.txt", paths: ["field/other.txt"], docsOnly: false, adminDocs: false },
  {
    pr: "docs/tutorials/one/package.json",
    paths: ["docs/tutorials/one/package.json"],
    docsOnly: false,
    adminDocs: false,
  },
  // Vendored Markdown is read: `pnpm lint` hashes vendor/anti-slop/src against its pin.
  {
    pr: "vendor/anti-slop/src/vendor/eslint-stylistic/UPSTREAM.md",
    paths: ["vendor/anti-slop/src/vendor/eslint-stylistic/UPSTREAM.md"],
    docsOnly: false,
    adminDocs: false,
  },
  // An agent's command under .claude/ is instruction text: quiet in CI, and never admin docs.
  { pr: ".claude/commands/x.md", paths: [".claude/commands/x.md"], docsOnly: true, adminDocs: false },
  // A pull request template under .github/ is read by GitHub and our tools: instruction text.
  {
    pr: ".github/pull_request_template.md",
    paths: [".github/pull_request_template.md"],
    docsOnly: true,
    adminDocs: false,
  },
  // Markdown outside the admin merge's folders is docs for CI, and no admin docs.
  { pr: ".patterns/x.md", paths: [".patterns/x.md"], docsOnly: true, adminDocs: false },
  // Pull request 1671, an experiment's write-up alone, on 2026-11-19. It is docs only, so it is armed, but
  // not admin docs: records.ts reads its frontmatter, and the lead ruled it lands through the queue.
  {
    pr: "1671",
    paths: ["experiments/300-carry-approvals-across-merges.md"],
    docsOnly: true,
    adminDocs: false,
  },
  // A package's, a program's or a fixture's AGENTS.md is read by a test or a program: code.
  { pr: "packages/a/AGENTS.md", paths: ["packages/a/AGENTS.md"], docsOnly: false, adminDocs: false },
  // pnpm lint hashes vendor/anti-slop/src against its pin, so an AGENTS.md there is read too.
  {
    pr: "vendor/anti-slop/src/AGENTS.md",
    paths: ["vendor/anti-slop/src/AGENTS.md"],
    docsOnly: false,
    adminDocs: false,
  },
  { pr: "programs/a/AGENTS.md", paths: ["programs/a/AGENTS.md"], docsOnly: false, adminDocs: false },
  { pr: "next/fixtures/AGENTS.md", paths: ["next/fixtures/AGENTS.md"], docsOnly: false, adminDocs: false },
  {
    pr: "next/packages/x/fixtures/r/AGENTS.md",
    paths: ["next/packages/x/fixtures/r/AGENTS.md"],
    docsOnly: false,
    adminDocs: false,
  },
  // A skill's scripts folder is code, its AGENTS.md included.
  {
    pr: ".agents/skills/lead/scripts/AGENTS.md",
    paths: [".agents/skills/lead/scripts/AGENTS.md"],
    docsOnly: false,
    adminDocs: false,
  },
  // The docs/ AGENTS.md is instruction text: quiet in CI, and not admin docs.
  { pr: "docs/AGENTS.md", paths: ["docs/AGENTS.md"], docsOnly: true, adminDocs: false },
];
