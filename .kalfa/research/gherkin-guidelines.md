---
summary: Whether a guideline page should hold its rules as Given/When/Then scenarios that run as tests, so one file is the rule and the test; what makes executable specifications work or rot, which tools fit Vitest 5, Effect 4 and an Electron app (each checked on npm and GitHub), whether scenarios can live inside a Markdown page, how a step vocabulary stays small, and how scenarios feed an agent that writes tests; every claim cited
---

# Should guideline pages hold their rules as Gherkin scenarios that run as tests?

Question: should each rule on a product guideline page be written as Gherkin-style scenarios (Given/When/Then) that run
as tests, so that one file is both the readable rule and its test?

Read on 2026-11-19, from the pages linked on each line and listed at the end. A line marked "my reading" is mine, not a
source's claim. Where a number is quoted, it is the source's own. Every version, date, license and star count was read
from npm or GitHub on the same day. I also ran three small tests in a scratch folder outside the repo (sections 2 and 3);
they say what one tool did on one machine, and nothing more.

Words used here. **Gherkin** is the plain-text format with Given, When and Then lines. A **step** is one such line. The
**glue** (Cucumber calls it a step definition) is the code that makes one kind of step line do something real. A
**feature file** is a Gherkin file, `.feature`. Given describes "the state of the world before you begin the behavior
you're specifying", When "is that behavior", and Then "the changes you expect"
([Given When Then](https://martinfowler.com/bliki/GivenWhenThen.html)).

## The short answer

**Not as the page itself, not now.** Scenarios fit a rule as worked examples under it. They do not fit as the whole
rule, and the gain from making the page run does not clearly pay for what it adds. Six findings carry that.

1. **This repo already tried the idea once and wrote down that it did not pay.** A decided note from 2026-10-18 says a
   plan's criteria already have the Given/When/Then shape "without Gherkin", that 27 of 27 scenarios went red before a
   fix and green after, but "the Gherkin tooling did not pay: no glue was reused across tickets, and plain tests read
   better" ([a project is a parent plan](../../docs/direction/a-project-is-a-parent-plan.md)). That was about per-ticket
   criteria, not long-lived guideline rules, so it is strong evidence and not a ruling on this question (section 0).
2. **The makers say scenarios are examples of a rule, not the rule.** Gherkin's `Rule` is "one business rule" and
   an `Example` "illustrates" it ([Gherkin reference](https://cucumber.io/docs/gherkin/reference/)). The older
   Specification by Example note says examples "only highlight a few points", so the method "can't be the only
   requirements technique you use", though it can "take a leading role"
   ([Specification By Example](https://martinfowler.com/bliki/SpecificationByExample.html)). Our test rule
   says every law uses generated inputs, and a fixed example needs a reason label (section 0). A scenario is a fixed
   example.
3. **The cost of the glue is justified only by the conversation around it.** Cucumber's creator wrote: "There is both
   Gherkin and Step Definitions to maintain. This can be justified if it improves collaboration and reduces
   misunderstandings, but if the tool is used in a vacuum those benefits will obviously never happen"
   ([2014 post](https://web.archive.org/web/20160809111146id_/https://cucumber.io/blog/2014/03/03/the-worlds-most-misunderstood-collaboration-tool)).
   Our one conversation is the owner reading a page in a walk, which is real, but it is one reader.
4. **A Markdown page can run.** `.feature.md` is Cucumber's own "Markdown with Gherkin" (MDG), and I ran one under
   Vitest 5.0.5 with QuickPickle 1.11.2 and Effect 4.1.3 steps. But the page becomes a program: a stray bullet that
   starts with "Given" silently becomes a step, and QuickPickle crashed until a `# Feature:` heading was line one, which
   collides with our "line one is the status alone" page shape (section 3).
5. **The tools are thin where we need them.** Only QuickPickle (Vitest-native) and Cucumber's own runner read Markdown.
   Only `@effect-cucumber/vitest` has Effect-native steps, and it is under three months old, pre-1.0, reads `.feature`
   only and has 2 contributors (section 2).
6. **What agents seem to use scenarios for is input, not the executable page.** GitHub's Spec Kit puts Given/When/Then
   "Acceptance Scenarios" in a Markdown spec an agent reads; AWS's Kiro turns requirement sentences into property-based
   tests; Playwright-BDD ships an agent skill that drafts scenarios, waits for approval, then builds (section 5). None
   of them needs the spec file itself to run.

My recommendations are in section 6. In short: keep one sentence per rule and its `Held by` test (confidence 75%); for
`law` rules, add one to three worked examples in Given/When/Then words that the test writer reads but no runner executes
(65%); and run an executable page only as a time-boxed pilot on one area that has several `law` rules (50%).

## 0. What a rule page is today, and what the repo already decided

This is the context the answer has to fit. Each line is a file read in this checkout of `main`.

- **A rule is a short block with a `Held by` line.** Each rule is `## X1: <name>` with Kind (law, lint or taste), Means
  (one or two plain sentences), Why, Example, Held by, and Breaks today. A `law` names its test "by its exact title"; a
  `lint` names its rule; a `taste` names the shot a person judges it by. Line one is the status alone
  ([the guideline page](../../.agents/skills/guidelines/references/guideline-page.md)).
- **Only a `law` has a test.** In the one approved page in `.kalfa/guidelines/`, the 8 rules are 4 `taste` and 4 `lint`
  and none is a `law`
  ([rules and records](../guidelines/rules-and-records.md)). The older design notes in `docs/direction/` have a
  different shape and no Kind field, so I cannot count their laws. Scenarios could only ever attach to the `law` rules.
- **A fixed example needs a reason label.** "Every law uses generated inputs unless it has a reason labeled `vector:`,
  `format:`, `pinned:` or `scenario:`", and `scenario:` means "one scripted run against the outside world", such as a
  real Electron window opening
  ([five steps for every check](../../docs/direction/five-steps-for-every-check.md)). The test writer's skill says the
  same ([the tests skill](../../.agents/skills/tests/SKILL.md)).
- **The lint rule that holds this reads only TypeScript calls rooted at `it` or `test`**
  ([`oxlint-plugins/law-shape.ts`](../../oxlint-plugins/law-shape.ts), header). My reading: a test that a Gherkin runner
  creates from a page is not such a call, so that rule would not see it.
- **Tests are sorted by file name.** Plain tests, `*.integration.test.ts` and `*.visual.test.ts` each belong to a
  Vitest project, and the include globs end in `.test.ts` or `.test.tsx`
  ([`vitest.config.ts`](../../vitest.config.ts)). A `.feature.md` file matches none of them.
- **The formatter already skips Markdown.** `**/*.md` is in the `ignorePatterns` of
  [`.oxfmtrc.json`](../../.oxfmtrc.json), so no formatter would rewrite a `.feature.md` page.
- **Nobody writes their own exam.** An agent that writes code never changes what it is checked against; changing the
  exam is the owner's call, in its own change
  ([nobody writes their own exam](../../docs/direction/nobody-writes-their-own-exam.md)).
- **There is no glossary to tie a vocabulary to yet.** The glossary map says "None exists yet" for each context's
  `GLOSSARY.md` ([glossary map](../glossary/GLOSSARY-MAP.md)).
- **Windows are driven from Vitest with the `playwright` library, never the Playwright Test runner.** The repo has
  `playwright` and `electron` in its catalog and no `@playwright/test` anywhere
  ([`pnpm-workspace.yaml`](../../pnpm-workspace.yaml)). Today's version starts its Electron window with Playwright's
  `_electron` in one helper ([`apps/fabrika/test-window.ts`](../../apps/fabrika/test-window.ts)); `next/`'s window tests
  drive the page in headless Chromium for now
  ([`instance.visual.test.ts`](../../next/apps/fabrika/e2e/instance.visual.test.ts)).

The stack the tools must fit, from the catalog: `vitest` 5.0.5, `effect` 4.1.3, `@effect/vitest` 4.1.3, `playwright`
1.64.1, `electron` 45.2.1, `react` 19.3.1, Node 26.13.0. The latest Vitest on npm today is 5.1.1 (2026-11-18).

## 1. What makes executable specifications work, and what makes them rot

### What the practitioners say works

- **Examples illustrate a rule, and a few are enough.** A `Rule` is "one business rule" and groups the scenarios that
  belong to it. An example is a "concrete example that illustrates a business rule", and the reference recommends "3-5
  steps per example" because too many steps make it "lose its expressive power as a specification"
  ([Gherkin reference](https://cucumber.io/docs/gherkin/reference/)).
- **A scenario's title says only what differs.** "You should be able to line up the scenarios side by side, and describe
  how they differ using only the title"; and once a team adopts the given/when/then vocabulary, "they discover that a
  world of ambiguity falls away" ([What's in a Story?](https://dannorth.net/blog/whats-in-a-story/)).
- **Say what, not how.** "Your scenarios should describe the intended behaviour of the system, not the implementation."
  The test to apply: "Will this wording need to change if the implementation does?"
  ([Writing better Gherkin](https://cucumber.io/docs/bdd/better-gherkin/)). The reference adds: "Imagine it's 1922",
  before computers, to find examples with no user-interface assumptions.
- **One small change in the business, one small change in the specs.** The "principle of symmetric change" asks that
  each specification focus "on a single concept of the business domain model", use the domain's names, keep "the
  (automated) validation procedure ... clearly separated from the specification of key examples", and be organized by
  how the domain's concepts relate
  ([symmetric change](https://gojko.net/2010/12/02/the-principle-of-symmetric-change/)).
- **The conversation comes first, the tool last.** Cucumber's own BDD page names three practices in order, Discovery,
  Formulation and Automation, and quotes: "having conversations is more important than capturing conversations is more
  important than automating conversations"
  ([BDD](https://cucumber.io/docs/bdd/), [myths](https://cucumber.io/docs/bdd/myths/)). The original BDD article says the
  words of a scenario come from "a ubiquitous language" shared with the business, and that "acceptance criteria should
  be executable" ([Introducing BDD](https://dannorth.net/blog/introducing-bdd/)).
- **Tests are a by-product.** "Tests fall out of BDD ... Testing isn't the activity itself"
  ([2014 post](https://web.archive.org/web/20160809111146id_/https://cucumber.io/blog/2014/03/03/the-worlds-most-misunderstood-collaboration-tool)).
- **Keep the setup short and say a thing one way.** Keep a `Background` under about four lines; "Don't say the same thing
  in different ways", and "say it the same way every time"
  ([Gherkin reference](https://cucumber.io/docs/gherkin/reference/#tips-for-using-background),
  [Who does what](https://cucumber.io/docs/bdd/who-does-what/)).
- **Treat the automation as real code.** The practices InfoQ lists from the book include "don't treat as second-grade
  code" and "don't replicate business logic"
  ([InfoQ, 2011](https://www.infoq.com/articles/specification-by-example-book)).

### How they rot

- **Click-level scenarios.** Scenarios that talk "about going to a specific url, click a specific link, find an element
  using a specific css selector" are tied to the screen, and "user interfaces changes a lot more frequently than the
  underlying domain logic"; they also "make it impossible to test anything below the user interface"
  ([anti-patterns, a transcript of a Cucumber team podcast](http://www.thinkcode.se/blog/2016/06/22/cucumber-antipatterns)).
  The symmetric-change post calls low-level UI wording "everything but aligned with a business model". Cucumber's own
  guide gives the fix: write "When "Bob" logs in", not the four clicks
  ([Writing better Gherkin](https://cucumber.io/docs/bdd/better-gherkin/)). A tool's own maintainer shows the drift: his
  approved example scenario for an agent workflow ends with "When I click the next page button"
  ([a maintainer's post](https://vitalets.github.io/posts/bdd-agentic-workflow/)).
- **Glue that cannot be reused.** Cucumber names two anti-patterns. One is "feature-coupled step definitions", steps that
  "can't be reused across features", which "may lead to an explosion of step definitions, code duplication, and high
  maintenance costs". The fix is to "organise your steps by domain concept". The other is "conjunction steps", one step
  that does several things ([Anti-patterns](https://cucumber.io/docs/guides/anti-patterns/)). The docs add: "Don't write
  step definitions for steps that are not present in one of your scenarios"
  ([Step organization](https://cucumber.io/docs/gherkin/step-organization/)).
- **Cost that grows with size.** A survey of 75 practitioners in 26 countries reports that "when the number of examples
  grows, BDD specifications can become costly to maintain and extend", and that "some teams find that parts of the
  system are effectively frozen due to the challenges of finding and modifying the examples associated with them"
  ([SANER 2018](https://lepebina.github.io/maintaining.pdf)). A 2026 preprint counted steps in 347 public repositories
  and reports a "step-weighted exact-duplicate rate" of 80.2%, meaning that share of steps has an exact twin elsewhere
  ([arXiv 2604.20462](https://arxiv.org/abs/2604.20462)). Treat that figure with care: it is not peer reviewed, and
  repeating a step line is also what healthy reuse looks like, so the count alone does not show waste.
- **Written after the code, or only as tests.** "Many people use Cucumber to do test automation, to check for bugs
  after the code has already been implemented. That's a perfectly reasonable way to do test automation, but it's not
  BDD" ([myths](https://cucumber.io/docs/bdd/myths/)). The 2014 post quotes an early adopter: "Your cucumber features
  should drive your implementation, not reflect it". Adopted "solely as a tool to write automated tests without any
  input from business analysts", scenarios "tend to become imperative and lose their documentation value", which "also
  makes them slow and brittle"
  ([2014 post](https://web.archive.org/web/20160809111146id_/https://cucumber.io/blog/2014/03/03/the-worlds-most-misunderstood-collaboration-tool)).
- **The wrong person writes them alone.** Cucumber's docs say the whole team should write Gherkin while the style is
  settling; later "a developer ... and a tester" can do it "as long as their output is actively reviewed by the product
  owner (or business representative)"
  ([Who does what](https://cucumber.io/docs/bdd/who-does-what/)). The podcast transcript lists both failures: business
  people alone write scenarios that "tend to be un-testable"; developers alone write "unrealistic", "really dry"
  examples ([transcript](http://www.thinkcode.se/blog/2016/06/22/cucumber-antipatterns)).
- **Tool first, specification second.** Asked for common mistakes, the Specification by Example author listed "focusing
  on a tool", a "purely testing perspective, where the artifacts become oversaturated with data and combinatorial
  explosion of cases", and "using technical language and scripts to describe how something is tested instead of what the
  system is supposed to do. This leads to maintenance headaches later"
  ([InfoQ interview, 2011](https://www.infoq.com/articles/specification-by-example-book)).
- **An empty intro section.** The transcript says the intro of a feature file should hold the business rules ("Describe
  the business rules; the abstract rules that we will describe examples for") and "questions or uncertainties", not a
  filled-in "As a user" template. My reading: that is the job a guideline page's prose already does.

### What this means for our case (my reading)

- The strongest thing the sources ask for, a conversation with the person who owns the meaning before the tests exist,
  is already how a page works: the owner reads it in a walk and says yes, then the test writer writes tests. That fits
  the docs' "reviewed by the product owner" pattern.
- What they warn against would be easy to fall into here: UI-level scenarios (our laws are about a window), and glue that
  is written per page, since the earlier criteria experiment already saw "no glue was reused across tickets".
- Our laws are about a program's behavior, which is the level Cucumber says scenarios belong to. The same sources say not
  to use them for "unit testing": QuickPickle's own README says "Gherkin is meant for testing the behavior of an
  application, not the code, and in most cases it is not a good tool for unit testing"
  ([QuickPickle README](https://github.com/dnotes/quickpickle/blob/36e8810bf/.github/README.md)).

## 2. The tools that fit our stack

All seven were read from npm and GitHub on 2026-11-19. "Last push" is the repo's most recent push to the default branch.

| Tool | Latest on npm (date) | License | Last push | Reads |
|---|---|---|---|---|
| `@cucumber/cucumber` | 13.3.0 (2026-10-05) | MIT | 2026-11-19 | `.feature` and `.feature.md` |
| `@amiceli/vitest-cucumber` | 8.0.1 (2026-11-16) | ISC, from `package.json` | 2026-11-16 | `.feature` |
| `quickpickle` | 1.11.2 (2026-05-06) | MIT | 2026-07-12 | `.feature` and `.feature.md` |
| `@effect-cucumber/vitest` | 0.10.3 (2026-10-02) | MIT | 2026-10-04 | `.feature` |
| `playwright-bdd` | 9.2.1 (2026-09-06) | MIT | 2026-11-16 | `.feature` |
| `@cucumber/gherkin` (the parser) | 43.0.0 (2026-11-13) | MIT | 2026-11-19 | `.feature`, and Markdown by media type |
| `jest-cucumber` | 4.5.0 (2024-07-25) | Apache-2.0 | 2026-03-27 | `.feature`, for Jest |

Each one, with the facts that decide fit:

- **`@amiceli/vitest-cucumber` 8.0.1.** The most active of the Vitest-native ones: 8.0.0 on 2026-09-05, 8.0.1 on
  2026-11-16, 9 contributors, 103 stars ([repo](https://github.com/amiceli/vitest-cucumber)). Peer dependency is
  `vitest ^5.0.0`.
  - *Reads:* `.feature` only, through its own line-by-line parser, not the official one
    ([`parser.ts`](https://github.com/amiceli/vitest-cucumber/blob/v8.0.1/src/parser/parser.ts); its `package.json` has no
    `@cucumber/*` dependency). I ran `loadFeature` on a `.feature.md` page and it threw
    `TypeError: Cannot read properties of undefined (reading 'rules')`. It has `loadFeatureFromText(string)`
    ([docs](https://github.com/amiceli/vitest-cucumber-docs/blob/main/src/content/docs/features/load-feature-from-text.mdx)),
    so a page could be cut into plain Gherkin first, by code we write.
  - *Steps:* written in the test file, inside the scenario they belong to, so there is no global step list. It throws if
    a scenario or step in the feature has no test ("was not called"). It also offers `defineSteps` for steps shared
    across scenarios. "Steps can be asynchronous because they are executed sequentially"
    ([async docs](https://github.com/amiceli/vitest-cucumber-docs/blob/main/src/content/docs/features/sequentially-and-async.mdx)).
    Effect would go through `Effect.runPromise`.
  - *License:* `ISC` in `package.json`; the repo has no `LICENSE` file and GitHub shows no license.
- **`quickpickle` 1.11.2.** A Vitest plugin. Releases every one to three months (1.11.0 on 2026-01-11, 1.11.1 on
  2026-02-13, 1.11.2 on 2026-05-06); last commit 2026-07-12; 2 contributors, 53 stars
  ([repo](https://github.com/dnotes/quickpickle)). Peer dependency `vitest ^1.0.0 || >=2.0.0`, so Vitest 5 is allowed.
  It depends on `@cucumber/gherkin ^32.1.0`, while the latest is 43.0.0.
  - *Reads:* `.feature` and `.feature.md`. The plugin matches `/\.feature(?:\.md)?$/` and, for `.md`, builds the parser
    with `GherkinInMarkdownTokenMatcher`
    ([`index.ts`](https://github.com/dnotes/quickpickle/blob/36e8810bf/packages/main/src/index.ts),
    [`render.ts`](https://github.com/dnotes/quickpickle/blob/36e8810bf/packages/main/src/render.ts)). Its README never
    mentions Markdown. The `include` glob in the Vitest config must list `**/*.feature.md`.
  - *Steps:* a global list, registered in a `setupFiles` module, in the style of Cucumber's own step definitions. Each
    step is run with `await`, so an async step works
    ([`index.ts`](https://github.com/dnotes/quickpickle/blob/36e8810bf/packages/main/src/index.ts), `gherkinStep`).
  - *What I ran:* see "What I ran" below. It works on Vitest 5.0.5 with Effect 4.1.3 steps, with a caveat.
- **`@effect-cucumber/vitest` 0.10.3.** The only Effect-native one: "every step is an `Effect` rather than a promise";
  `describeFeature` takes a `Layer`; a step that needs a service the `Layer` does not give is "a compile error at the
  step definition"; each scenario is one `it.effect` with its own `TestClock`
  ([README](https://github.com/leaderiop/effect-cucumber/blob/bffb2f1e4/README.md)). Peer dependencies: `effect ^4.0.0`,
  `vitest >=5.0.0 <6.0.0`, `@effect/vitest ^4.0.0`, `@effect/platform-node ^4.0.0`. That matches our catalog.
  - *Young:* the repo was created 2026-08-27, the first npm version is dated 2026-09-02, 14 versions since, 1 star, 2
    contributors, no open issues, last push 2026-10-04. The README text still says "published on npm as `0.1.0`" while
    npm shows 0.10.3, so its docs lag its releases.
  - *Reads:* `.feature` only. Its parser header says "`GherkinClassicTokenMatcher` only" and "Markdown feature files are
    out of scope" ([`Parser.ts`](https://github.com/leaderiop/effect-cucumber/blob/bffb2f1e4/packages/gherkin/src/Parser.ts)).
  - I did not run it.
- **`playwright-bdd` 9.2.1.** The most used (835 stars, 19 contributors). It turns `.feature` files into Playwright
  Test files, so it needs the Playwright Test runner (`@playwright/test >=1.44`), which this repo does not use
  ([package](https://www.npmjs.com/package/playwright-bdd)). Version 10 is in prerelease (`10.0.0-next.7`, 2026-11-10).
  - *Reads:* `.feature` only; the loader passes the fixed media type `TEXT_X_CUCUMBER_GHERKIN_PLAIN`
    ([`featuresLoader.ts`](https://github.com/vitalets/playwright-bdd/blob/v9.2.1/src/gherkin/featuresLoader.ts)).
  - *Steps:* Playwright fixtures, `async ({ page }) => ...`; Effect through `runPromise`.
  - *Electron:* its docs do not mention Electron. Playwright's own page says it "has experimental support for Electron
    automation" and lists Electron v21+ ([Playwright Electron](https://playwright.dev/docs/api/class-electron)).
  - *Agents:* it ships an agent skill, covered in section 5.
- **`@cucumber/cucumber` 13.3.0.** The reference implementation. Its default feature glob is
  `features/**/*.{feature,feature.md}` ([`paths.ts`](https://github.com/cucumber/cucumber-js/blob/v13.3.0/src/paths/paths.ts),
  [configuration](https://github.com/cucumber/cucumber-js/blob/v13.3.0/docs/configuration.md)). The parser picks Markdown
  from the `.md` ending: `gherkin-streams` calls `makeSourceEnvelope`, which gives `.md` files the Markdown media type
  ([`makeSourceEnvelope.ts`](https://github.com/cucumber/gherkin/blob/v43.0.0/javascript/src/makeSourceEnvelope.ts)). I
  read this in source and docs; I did not run cucumber-js.
  - *Runner:* its own CLI, not Vitest. TypeScript through `tsx`
    ([transpiling](https://github.com/cucumber/cucumber-js/blob/v13.3.0/docs/transpiling.md)). Node `22 || 24 || >=26`,
    so our Node 26.13.0 is fine. A page run this way would sit outside `pnpm test`, the Vitest projects and CI's shards.
  - *Steps:* may return a promise or take a callback
    ([step definitions](https://github.com/cucumber/cucumber-js/blob/v13.3.0/docs/support_files/step_definitions.md)).
    `setDefinitionFunctionWrapper` can wrap each step function, which is where a wrapper that runs an Effect would go
    (my reading; I did not run it).
- **`@cucumber/gherkin` 43.0.0.** Not a runner. It is the official parser, and it knows Markdown:
  `generateMessages` picks `GherkinInMarkdownTokenMatcher` for the Markdown media type
  ([`generateMessages.ts`](https://github.com/cucumber/gherkin/blob/v43.0.0/javascript/src/generateMessages.ts)). My
  reading: a runner of about a hundred lines on top of it, with Effect steps, is the option that carries no
  third-party runner risk. I did not build it.
- **`jest-cucumber` 4.5.0.** No release since 2024-07-25, so I treat it as not maintained in practice. Listed because its
  `peerDependencies` name `vitest >=1.4.0` ([npm](https://www.npmjs.com/package/jest-cucumber)).

**What I ran.** In a scratch folder outside the repo (Node 22.22.3, not the repo's pinned Node 26.13.0; not run through
the repo's Vitest config): `vitest` 5.0.5, `quickpickle` 1.11.2, `effect` 4.1.3. A page of 44 lines shaped like a guideline page (a status line,
prose, a rule with bullets, two `Example`s under one `Rule`, a second prose rule with a table), and a 33-line step file
in which each step is `await Effect.runPromise(...)` over an Effect `Ref`. The excerpt below is the part of the page that
runs.

```markdown
# Feature: Lost links

### Rule: a lost link dims the tile and takes it out of the tab order

#### Example: link drops while the tile is open

- Given a desk with one checklist tile
- And the tile's link is up
- When the link is lost
- Then the tile is dimmed
- And the tile cannot be focused
```

- With `# Feature: Lost links` on line one, `vitest run --reporter=verbose` printed two passing tests named
  `... > Feature: Lost links > Rule: a lost link dims the tile ... > Example: link drops while the tile is open`.
- I inverted one assertion in the step file and the matching example failed with "Error: the tile is dimmed". I put it
  back and both passed.
- With the first line being prose (the status line) in place of `# Feature:`, the run died in the plugin:
  `TypeError: Cannot read properties of undefined (reading 'replace')` at `render.ts:38`. My reading: the `Feature` has
  no keyword when Markdown takes line one as its name (section 3), and the plugin escapes that keyword. I did not run
  QuickPickle on a page with the status line first and `# Feature:` on line three; the parser result in section 3
  predicts the same crash.

**Where each tool leaves us on three needs.**

- *Async and Effect.* Every tool but `@effect-cucumber/vitest` takes promises, so an Effect step is one
  `Effect.runPromise` call. In this repo that is a Promise edge, and the lint rule `fabrika/no-promises` asks for a
  marked reason on each ([`next/AGENTS.md`](../../next/AGENTS.md)). Our own glue would pay that once, in one place.
  `@effect-cucumber/vitest` avoids the edge, but see its age above.
- *React in Electron.* None of them changes how the window is driven. The repo's own window tests use Vitest and the
  `playwright` library (section 0); a scenario's steps would call the same helpers. Playwright-BDD would instead put a
  second runner, Playwright Test, beside Vitest. QuickPickle also publishes a Playwright "world"
  with ready-made steps like "I navigate to {string}", and its README itself says such click-level step libraries "do
  NOT align with Cucumber best practices" ([README](https://github.com/dnotes/quickpickle/blob/36e8810bf/.github/README.md)).
- *Which test project.* The repo sorts tests by file name into plain, `integration` and `visual` projects. A page that
  mixes laws that need a real Electron window with laws that do not would have to be split by tag, which the tools
  support (QuickPickle tags, vitest-cucumber `includedTags`) but our config does not use.

## 3. Gherkin inside a Markdown page

**Yes, with Cucumber's own dialect.** "Markdown with Gherkin (MDG) is a dialect of Markdown that is supported by the
Gherkin parser", and it "is a strict superset of GitHub Flavored Markdown"
([MDG spec](https://github.com/cucumber/gherkin/blob/v43.0.0/MARKDOWN_WITH_GHERKIN.md)). The parsing rules:

- The file must end in `.feature.md`, "to prevent regular `.md` files from being parsed by Gherkin".
- `Feature`, `Background`, `Rule`, `Scenario`, `Scenario Outline` and `Examples` are Markdown headings, any level. In my
  runs each also needed its colon, as in classic Gherkin (`## Background` alone was not a `Background`).
- Steps (`Given`, `When`, `Then`, `And`, `But`) are list items starting with `-` or `*`.
- Tables must be "indented 2-5 spaces" to count as data tables; an unindented table is ignored. Doc strings are fenced
  code blocks. Tags are inline code, like `` `@hello` ``, on the line above the keyword.
- "The `GherkinInMarkdownTokenMatcher` will consider *all* lines that aren't recognised as a special token as *Empty*",
  because "Markdown documents will typically have lines that have nothing to do with Gherkin - they are just prose".
- A note says MDG is, for now, in the JavaScript parser only, version 19.0.0 and later. A React component, `<MDG>`,
  "renders a Markdown document with results", which is how a page shows pass and fail beside the rule.

Two more facts, from the parser at 43.0.0 and cucumber-js 13.3.0: `.feature.md` is in cucumber-js's default glob, and the
parser picks Markdown from the file name (`.md`). Cucumber's reference also says that descriptions under a `Rule` or an
`Example` "can be in the form of Markdown".

**What I ran on the parser, on pages shaped like ours** (official `@cucumber/gherkin` 43.0.0, a 23-line script; the
pages and script are not in the repo):

- A page whose line one is `**Approved 2026-11-18.**`, then `# Feature: Lost links`, then a `Rule` and two `Example`s
  parsed into one feature whose **name is line one**, `**Approved 2026-11-18.**`. The explicit `# Feature:` line was
  swallowed. This matches the spec: "If the document doesn't start with it, the first line of the document will be used as
  the name of the feature".
- Prose sections of a rule page (`## R2: ...`, bold `- **Kind:** ...` bullets, a `Held by` line, a small table indented two spaces)
  were ignored with no error, so a page can carry them.
- **Silent hazard 1.** A bullet in a prose section after the last example, `- Given that a reader skims this bullet ...`,
  was **added as a step of the last example**, with no error from the parser. Under QuickPickle the run then failed that
  example with "Undefined. Implement with the following snippet".
- **Silent hazard 2.** A prose heading `## Example: ...` or `## Rule: ...` becomes a scenario or rule. `## Examples of the
  problem` (no colon) did not.
- **Silent hazard 3.** A bare `## Background` (no colon) was not a `Background`, and the step under it fell into the
  feature description.

My reading: all three are loud enough in a pass-or-fail run, but their messages point at a test and the cause is a
sentence somewhere above it. The repo's page shape would change: the first line (the status) would have to move below a
`# Feature:` heading, and a writer would have to avoid a few words at the start of a bullet or heading. A small lint on
`.kalfa/guidelines/*.feature.md` could hold both.

**Anything similar.**

- **Gauge** specs are written in "a syntax similar to Markdown", in `.spec` or `.md` files, with `*` steps, and run by
  Gauge's own runner, which has JavaScript and TypeScript support
  ([Gauge](https://docs.gauge.org/writing-specifications.html)). Gauge 1.6.43 (2026-11-09, Apache-2.0) and `gauge-ts`
  0.5.1 (2026-06-23, MIT) are maintained ([Gauge repo](https://github.com/getgauge/gauge)). It has no Given/When/Then and
  does not run under Vitest, so it is a different tool, not a different way into this one.
- **Concordion** instruments a Markdown page with links like `[value](- "command")`
  ([Concordion](https://concordion.org/instrumenting/java/markdown/)). It is Java, and its latest release is 4.0.1
  (2023-07-16), so it does not fit.
- **Spec Kit** writes scenarios in a Markdown template as numbered lines: "**Given** [initial state], **When** [action],
  **Then** [expected outcome]" ([template](https://github.com/github/spec-kit/blob/61d3abb13/templates/spec-template.md)).
  Nothing parses them. They are for an agent to read.
- **Our own extraction.** Cut each fenced `gherkin` block out of an ordinary `.md` page and hand it to a runner's
  text loader (`loadFeatureFromText` in vitest-cucumber takes a string). My reading; I did not build it. The page then
  stays an ordinary page, line one stays the status, and the prose can say anything. The cost is a small extractor, and
  the rule and its examples sit in separate fences.

## 4. How the step vocabulary stays small and shared

What the makers say:

- **Group steps by the domain thing, not by the feature.** "We recommend creating a separate ... file for each domain
  concept", with the example of one file per major domain object, and this "also avoid[s] the Feature-coupled step
  definitions anti-pattern" ([Step organization](https://cucumber.io/docs/gherkin/step-organization/)).
- **One phrase per thing.** "pick one and use the same line in every Scenario"
  ([Who does what](https://cucumber.io/docs/bdd/who-does-what/)). Merge near-twins into one step with a parameter:
  `Given I go to the {} page` in place of three page-specific steps
  ([Step organization](https://cucumber.io/docs/gherkin/step-organization/)).
- **Name domain nouns as typed parameters.** In cucumber-js, `defineParameterType({ name, regexp, transformer })` makes a
  new `{name}` that a step can use ([API reference](https://github.com/cucumber/cucumber-js/blob/v13.3.0/docs/support_files/api_reference.md)).
  My reading: that is the hook where a glossary term (a tile, a program, a window) becomes a checked word: a step that
  says `{tile}` only matches a known tile.
- **Find the dead ones.** cucumber-js's `usage` formatter "tells you about usages in your scenarios ... and any unused
  steps" ([formatters](https://github.com/cucumber/cucumber-js/blob/v13.3.0/docs/formatters.md)).
  `@effect-cucumber/vitest` fails a step that matches no pattern or more than one, and warns on a pattern no step uses
  ([README](https://github.com/leaderiop/effect-cucumber/blob/bffb2f1e4/packages/vitest/README.md)).
  `vitest-cucumber` fails a feature step that has no test, but does not complain about a predefined step nobody uses
  ([predefined steps](https://github.com/amiceli/vitest-cucumber-docs/blob/main/src/content/docs/features/predefine-steps.mdx)).
- **Tie the words to the domain's language.** The BDD page says writing the specification together "establish[es] a
  shared language", so "problem-domain terminology" runs "all the way down into the code"
  ([BDD](https://cucumber.io/docs/bdd/)); the BDD history credits Domain-Driven Design's ubiquitous language for the
  Given/When/Then template ([history](https://cucumber.io/docs/bdd/history/)). The Specification by Example book's
  practice list says "define and use an ubiquitous language" and "document building blocks"
  ([InfoQ](https://www.infoq.com/articles/specification-by-example-book)). Domain-Driven Design's own term needs the
  language to be "rigorous, since software doesn't cope well with ambiguity", and to "evolve" as understanding grows
  ([ubiquitous language](https://martinfowler.com/bliki/UbiquitousLanguage.html)).
- **One vendor makes the vocabulary a managed list.** Cucumber Studio's "action words" are "a sequence of steps that can
  be reused across multiple scenarios" that "defines the Domain Specific Language of the project", each with a name
  "unique within a given project", a description, parameters and a "used by" list
  ([action words](https://support.smartbear.com/cucumberstudio/docs/tests/action-words.html)). That is a product page.

**What I did not find:** a first-party instruction that says "keep a glossary file and check every step against it". The
ties above are an idea (ubiquitous language), a hook (parameter types) and a report (unused steps). Joining them is work
a team does itself. Here there is also nothing to join to yet, since the glossary has no context files
([glossary map](../glossary/GLOSSARY-MAP.md)).

## 5. Scenarios as input for an agent that writes tests

There is no controlled study that I found showing that agents write better tests from Gherkin than from a plain
sentence. What exists is practice from tool makers, plus one cautionary article.

- **Give the agent a check that comes back pass or fail.** Claude Code's guide says that with something that "comes back
  pass or fail, Claude can close that loop itself", and asks of an unattended run: "Does it know what done looks like? A
  goal condition, a spec file, or a failing test it has to turn green" ([best practices](https://code.claude.com/docs/en/best-practices)).
  This is the part of our pipeline the test writer already does.
- **A Markdown spec with Given/When/Then scenarios, read by an agent.** GitHub's Spec Kit template asks each user story
  for "Acceptance Scenarios" in Given/When/Then and an "Independent Test" line that says how that story "can be tested
  independently" ([template](https://github.com/github/spec-kit/blob/61d3abb13/templates/spec-template.md)). An article on
  martinfowler.com reports Kiro writing requirements with "acceptance criteria (in 'GIVEN… WHEN… THEN…' format)"
  ([Understanding spec-driven development](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html)).
- **A requirement sentence turned into a property test.** Kiro's current docs say it "extracts properties from your
  EARS-formatted requirements" (for example "THE System SHALL allow authenticated users to view active car listings"),
  decides which "can be logically tested", and generates "hundreds or thousands of random test cases". They add a limit:
  requirements that depend on external services or non-determinism "may need mocking, or may be better covered by
  example-based tests" ([Kiro correctness](https://kiro.dev/docs/specs/correctness/)). My reading: this is the closest
  match to our rule that every law is a property. The rule's sentence is the input, and the agent writes the generator.
- **Draft, approve, then build.** The Playwright-BDD skill makes the agent draft scenarios, show them "for approval",
  "iterate until the user explicitly approves", only then write the feature and the steps, then run them. Its rules for
  scenarios: "Keep the number of scenarios minimal", "Reuse existing steps ... before inventing new phrasing" (it lists the
  existing steps with a command), prefer "business-aware step names over technical, heavily parameterized ones"
  ([skill](https://github.com/vitalets/playwright-bdd/blob/v9.2.1/skills/playwright-bdd/SKILL.md),
  [agent skill docs](https://github.com/vitalets/playwright-bdd/blob/v9.2.1/docs/getting-started/agent-skill.md)). The same
  maintainer argues scenarios beat Markdown specs because a Gherkin diff "keeps the discussion focused on the user flow"
  ([a maintainer's post](https://vitalets.github.io/posts/bdd-agentic-workflow/)). The post's author maintains the tool and
  says "I'm biased here". QuickPickle's README lists, as a planned and unbuilt experiment, bots that "write Gherkin scenarios based
  on issue reports" and "write code based on Gherkin scenarios".
- **A caution.** A write-up of spec-driven tools notes that dropping a parseable spec language also drops the tool
  support "to write valid, complete and consistent specs", and wonders whether spec-anchored approaches end up "with the
  downsides of both MDD and LLMs: Inflexibility and non-determinism". It also describes Kiro turning "this small bug"
  into "4 'user stories' with a total of 16 acceptance criteria"
  ([Understanding spec-driven development](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html)).
- **Gherkin made by models is studied; Gherkin read by models is not, so far.** The papers I found ask models to
  *write* Gherkin, page objects and UI test scripts from tickets and code changes. One industrial case study (13 issues
  in one mobile app) reports "93.3% of Gherkin scenarios were syntactically correct upon generation" and "78.8% of
  PageObjects ran without manual edits" ([ASE 2025, arXiv 2510.18861](https://arxiv.org/abs/2510.18861)). That is the
  reverse of our case, where a person approves the scenario and an agent writes the test.

My reading for our test writer: it already takes an approved plan and writes laws, with a plant run once for each. A
worked example under a rule is useful input to it for the same reason a worked example is useful to a person, and the
property it writes should be derived from the rule's sentence, as Kiro's docs describe. Nothing in these sources needs
the example to run as its own test.

## 6. What this suggests

Three options, in the order I would take them. For each: why, what it costs, how sure I am.

1. **Keep a rule as one sentence plus its `Held by`. Do not make a page run.** (75%)
   - Why: the repo's own earlier finding (glue not reused, plain tests read better); only `law` rules could carry a
     scenario and none of the 8 approved rules is one; fixed examples cut against "every law is a property"; a Markdown
     page parsed as Gherkin has silent hazards and needs a page-shape change; the Markdown-capable Vitest tool is one
     with 2 contributors and undocumented Markdown support.
   - Cost: no single file that is both the rule and its test, and the owner reads a test title, not a story.
   - Doubt: guideline rules live longer than ticket criteria, so glue might be reused here where it was not there. That
     is the one thing the earlier finding does not cover.
2. **For each `law` rule, add one to three worked examples in Given/When/Then words, in a fenced `gherkin` block, that no
   runner executes.** (65%)
   - Why: it keeps what the sources praise (concrete examples, one rule per `Rule`, plain domain words, owner approval
     before tests) and what agents use scenarios for (input), with none of the glue layer. The test writer reads the
     examples, writes the property from the rule's sentence, and writes the example as a `scenario:` or `pinned:` test
     where it fits.
   - Cost: a small check that every example title appears in a test title, as `Held by` already names tests by exact
     title (one lint file); and examples can drift from the tests if the check is not built.
   - Doubt: examples add reading to every `law` rule. The sources say 3 to 5 steps and few examples; I would ask whether
     the owner finds them clearer in a walk than the sentence.
3. **If the owner wants one executable page, pilot it once.** (50%)
   - Do it on one visual area with at least three `law` rules, for a fixed time. Use QuickPickle 1.11.2 (2026-05-06),
     the only maintained Vitest-native runner I could run on a Markdown page, or a thin runner of our own on
     `@cucumber/gherkin` 43.0.0. `@effect-cucumber/vitest` 0.10.3 (2026-10-02) is the one to watch for Effect-typed steps
     and has no Markdown yet.
   - Set up first: `# Feature:` on line one with the status on line two, a `.feature.md` include glob in a new Vitest
     project, tags that route a scenario to the plain, integration or visual project, a lint for the three hazards in
     section 3, and steps grouped by domain noun (section 4).
   - Measure: how many steps are reused across the area's rules, how many page edits break the parse, and agent hours
     against plain tests. Reuse across rules is the number the earlier finding says did not materialize.
   - Doubt: it rests on a plugin with 2 contributors. What would settle it is the pilot's reuse count.

## 7. What this cannot tell us

- **No evidence on our exact case.** I found no source about guideline or design-rule pages as executable specs. The
  makers write about user stories and acceptance criteria for features. Applying them to a page of design rules, and to a
  window, is my reading.
- **I did not read the earlier experiment.** The repo's note cites an experiment in the notes (87) for the 27 of 27 result.
  I used the note's summary and did not read the experiment.
- **My three runs are small.** One tool run on a page (QuickPickle), one 44-line page, one machine, Node 22.22.3 and not the repo's
  Node, outside the repo's own Vitest config. I did not run `@cucumber/cucumber`, `@effect-cucumber/vitest` or
  `playwright-bdd`; for those I read source and docs. I did not drive Electron.
- **Single-source tool facts.** The Markdown support in QuickPickle comes from its source and my run, not its README. The
  "Effect-native" claims for `@effect-cucumber/vitest` come from its own README.
- **The age of a source.** The practice sources (BDD article 2006, the story article 2007, the symmetric-change post
  2010, the interview 2011, the 2014 post) are old. They match what Cucumber's docs say today, but none tested a
  TypeScript or Effect codebase.
- **The survey and the preprint are weak legs.** The 2018 survey has 75 respondents, recruited by snowball in part. The
  2026 duplicate-step study is a preprint submitted to a journal. Both are context, not proof.
- **Tool vendors sell what they describe.** Playwright-BDD's post and skill, Spec Kit's template, Kiro's docs and
  Cucumber Studio's page are each written by the party that makes the thing. The podcast transcript is a third party's
  write-up of a first-party podcast; I could not reach the podcast page itself.
- **Not covered.** Scenario Outlines and data tables beyond a mention; Cucumber's reports; other Gherkin runners for
  Vitest that may exist and did not surface in npm search; how a screen reader sees a `.feature.md` page; and whether
  `pnpm lint`'s records check would accept a new page extension.

## Sources

Cucumber, first-party

- [Gherkin reference](https://cucumber.io/docs/gherkin/reference/) (Rule, Example, Given/When/Then, Background tips,
  descriptions in Markdown)
- [Writing better Gherkin](https://cucumber.io/docs/bdd/better-gherkin/)
- [Behaviour-Driven Development](https://cucumber.io/docs/bdd/), [Myths](https://cucumber.io/docs/bdd/myths/),
  [Who does what](https://cucumber.io/docs/bdd/who-does-what/), [History](https://cucumber.io/docs/bdd/history/)
- [Anti-patterns](https://cucumber.io/docs/guides/anti-patterns/) and
  [Step organization](https://cucumber.io/docs/gherkin/step-organization/)
  (source: [cucumber/docs](https://github.com/cucumber/docs/tree/3c93e6cee/content/docs), read from the repo)
- [Markdown with Gherkin](https://github.com/cucumber/gherkin/blob/v43.0.0/MARKDOWN_WITH_GHERKIN.md) and the parser
  [`makeSourceEnvelope.ts`](https://github.com/cucumber/gherkin/blob/v43.0.0/javascript/src/makeSourceEnvelope.ts),
  [`generateMessages.ts`](https://github.com/cucumber/gherkin/blob/v43.0.0/javascript/src/generateMessages.ts)
- cucumber-js v13.3.0: [`paths.ts`](https://github.com/cucumber/cucumber-js/blob/v13.3.0/src/paths/paths.ts),
  [configuration](https://github.com/cucumber/cucumber-js/blob/v13.3.0/docs/configuration.md),
  [step definitions](https://github.com/cucumber/cucumber-js/blob/v13.3.0/docs/support_files/step_definitions.md),
  [API reference](https://github.com/cucumber/cucumber-js/blob/v13.3.0/docs/support_files/api_reference.md),
  [formatters](https://github.com/cucumber/cucumber-js/blob/v13.3.0/docs/formatters.md),
  [transpiling](https://github.com/cucumber/cucumber-js/blob/v13.3.0/docs/transpiling.md)
- [Cucumber Studio: action words](https://support.smartbear.com/cucumberstudio/docs/tests/action-words.html)
  (a product page)

Practitioners

- Introducing BDD, Dan North, 20 Sep 2006: [dannorth.net/blog/introducing-bdd](https://dannorth.net/blog/introducing-bdd/)
- What's in a Story?, Dan North, 11 Feb 2007: [dannorth.net/blog/whats-in-a-story](https://dannorth.net/blog/whats-in-a-story/)
  (read for the scenario title rule and the given/when/then vocabulary)
- The world's most misunderstood collaboration tool, Aslak Hellesøy, 3 Mar 2014, read from an
  [archived copy](https://web.archive.org/web/20160809111146id_/https://cucumber.io/blog/2014/03/03/the-worlds-most-misunderstood-collaboration-tool)
  of the Cucumber blog
- The principle of symmetric change, Gojko Adzic, 2 Dec 2010:
  [gojko.net](https://gojko.net/2010/12/02/the-principle-of-symmetric-change/)
- Interview and Book Review: Specification by Example, InfoQ, 24 Oct 2011 (the author's answers, and InfoQ's list of the
  book's practices): [infoq.com](https://www.infoq.com/articles/specification-by-example-book)
- Cucumber Anti-Patterns, Thomas Sundberg, 22 Jun 2016, a transcript and interpretation of a Cucumber team podcast:
  [thinkcode.se](http://www.thinkcode.se/blog/2016/06/22/cucumber-antipatterns)
- Given When Then (2013), Specification By Example (2004) and Ubiquitous Language (2006), Martin Fowler's bliki:
  [GivenWhenThen](https://martinfowler.com/bliki/GivenWhenThen.html),
  [SpecificationByExample](https://martinfowler.com/bliki/SpecificationByExample.html),
  [UbiquitousLanguage](https://martinfowler.com/bliki/UbiquitousLanguage.html)

Research

- Binamungu, Embury and Konstantinou, Maintaining Behaviour Driven Development Specifications: Challenges and
  Opportunities, SANER 2018: [PDF](https://lepebina.github.io/maintaining.pdf)
- Mughal, Fatima and Bilal, Deja Vu at Scale: Paraphrase-Robust Detection of Duplicate Gherkin Steps ..., arXiv
  2604.20462, v3 June 2026, a preprint: [arXiv](https://arxiv.org/abs/2604.20462)
- Fonseca, Lima and Faria, Streamlining Acceptance Test Generation for Mobile Applications Through Large Language Models:
  An Industrial Case Study, ASE 2025 (arXiv 2510.18861): [arXiv](https://arxiv.org/abs/2510.18861) (I read the abstract
  only)

Tools (versions and dates from npm and the GitHub API on 2026-11-19)

- [`@amiceli/vitest-cucumber`](https://www.npmjs.com/package/@amiceli/vitest-cucumber),
  [repo](https://github.com/amiceli/vitest-cucumber) at v8.0.1, and its
  [docs repo](https://github.com/amiceli/vitest-cucumber-docs)
- [`quickpickle`](https://www.npmjs.com/package/quickpickle), [repo](https://github.com/dnotes/quickpickle) at 36e8810bf
- [`@effect-cucumber/vitest`](https://www.npmjs.com/package/@effect-cucumber/vitest) and
  [`@effect-cucumber/gherkin`](https://www.npmjs.com/package/@effect-cucumber/gherkin),
  [repo](https://github.com/leaderiop/effect-cucumber) at bffb2f1e4
- [`playwright-bdd`](https://www.npmjs.com/package/playwright-bdd), [repo](https://github.com/vitalets/playwright-bdd) at
  v9.2.1, and its maintainer's post
  [Why I Prefer BDD over SDD for Agentic Development](https://vitalets.github.io/posts/bdd-agentic-workflow/) (10 Jul 2026)
- [`@cucumber/cucumber`](https://www.npmjs.com/package/@cucumber/cucumber),
  [`@cucumber/gherkin`](https://www.npmjs.com/package/@cucumber/gherkin),
  [`jest-cucumber`](https://www.npmjs.com/package/jest-cucumber)
- [Playwright: Electron](https://playwright.dev/docs/api/class-electron)
- [Gauge](https://docs.gauge.org/writing-specifications.html), [Gauge repo](https://github.com/getgauge/gauge),
  [Concordion Markdown](https://concordion.org/instrumenting/java/markdown/)

Agents and specs

- [Claude Code best practices](https://code.claude.com/docs/en/best-practices) (give Claude a check to run; let Claude run
  without you)
- [GitHub Spec Kit template](https://github.com/github/spec-kit/blob/61d3abb13/templates/spec-template.md)
- [Kiro: correctness with property-based tests](https://kiro.dev/docs/specs/correctness/), page updated 2026-08-04
- Understanding Spec-Driven-Development: Kiro, spec-kit, and Tessl, Birgitta Böckeler, on Martin Fowler's site:
  [martinfowler.com](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html)

This repo (read on `main`, 2026-11-19)

- [a project is a parent plan](../../docs/direction/a-project-is-a-parent-plan.md),
  [five steps for every check](../../docs/direction/five-steps-for-every-check.md),
  [nobody writes their own exam](../../docs/direction/nobody-writes-their-own-exam.md)
- [the guideline page](../../.agents/skills/guidelines/references/guideline-page.md),
  [rules and records](../guidelines/rules-and-records.md), [the tests skill](../../.agents/skills/tests/SKILL.md)
- [`oxlint-plugins/law-shape.ts`](../../oxlint-plugins/law-shape.ts), [`vitest.config.ts`](../../vitest.config.ts),
  [`.oxfmtrc.json`](../../.oxfmtrc.json), [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml),
  [glossary map](../glossary/GLOSSARY-MAP.md), [`next/AGENTS.md`](../../next/AGENTS.md)
