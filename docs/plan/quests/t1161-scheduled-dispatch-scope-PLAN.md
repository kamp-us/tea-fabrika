
Plancheck-Version: 3

```yaml
# A sketch: the whole idea, today's CI. scheduled.yaml's hand start gets two inputs.
on:
  workflow_dispatch:
    inputs:
      scope: { type: choice, required: true, default: changed, options: [changed, full] }
      law: { type: string, required: false, default: "" } # the test file a `full` run is for
jobs:
  select: # still only a hand start on a branch other than main (SC17), so main never reads scope
    steps:
      - id: set
        env: { SCOPE: "${{ inputs.scope }}", LAW: "${{ inputs.law }}" } # proof.ts reads them
# proof.ts: full set when a rerun trigger changed (0590, as today) or when scope is full;
# otherwise the changed set, as today. A full ask must name a law Vitest lists, and the record keeps it.
```

# Ticket 1161: a `scope` input on scheduled.yaml's hand start

Today's version: CI tooling only (`.github/`), serving both versions, plus three glossary rows.
Ticket 1161, branch `fabrikalfa/scheduled-dispatch-scope` from origin/main 605a0e513. It follows
[0590](../../../.decisions/0590-a-branch-proof-run-runs-only-what-its-change-reaches.md) (amended
by [0591](../../../.decisions/0591-exam-shape-checks-become-lint-rules-and-text-reads-are-declared.md)),
[0598](../../../.decisions/0598-merge-line-leaves-scheduled-groups.md),
[0595](../../../.decisions/0595-scheduled-runs-share-slots.md),
[0581](../../../.decisions/0581-main-full-run-starts-on-push-and-hourly.md),
[0069](../../../.decisions/0069-choices-are-settings.md) and
[0408](../../../.decisions/0408-skills-keep-only-judgment.md). It walks back no decision, and it
builds no new design call: the one call it raises is under Open questions, and nothing is built for
it.

**Said plainly first:** with the default answer to the open question (no), this ticket does not
change the run that motivated it. [Run 44210757768](https://github.com/kamp-us/tea-fabrika/actions/runs/44210757768)
on pull request 1525 touched `.oxlintrc.json`, a rerun trigger, so it runs the full set under
`scope: changed` too, as 0590 point 3 says. What the ticket adds is the other direction (a full set
on request, with its reason recorded) and an explicit default. The harm that run did, 7 of 9 shared
slots held while other pull requests' tests waited 11 minutes or more, came from before 0598: since
0598 landed, check.yaml holds no `scheduled-` group (`grep -c scheduled- .github/workflows/check.yaml`
prints 0), so a full-set proof now waits only on the four proof groups, never on a pull request's
legs.

## Doubt first: the record of a `full` ask is the run's own record, not a new field row (75%)

The ticket asks that "the run's field row names the law whenever full is chosen". No field row
records a proof run today. `field/README.md` has three logs (`notes/`, `runs/`, `findings/`), and
none has a row for a CI run; `field-schema.ts` and `field-check.ts` check only those three. A proof
run's record is its `proof-set` artifact and its step summary, which `proof.ts` writes (0590's
build, `scheduled.yaml` lines 338 to 345).

**Lean: the law goes in that record, and code holds it.** `proof.ts` refuses a `full` ask with no
law, or with a law Vitest does not list in the four projects a proof runs, so the select step fails
and the run is red before any test starts. The `proof-set` record and the summary then name the
law on every `full` run, with no person in the loop. This is 0408's rule: a rule code can check
becomes a check. A new field row the lead must remember to write for each `full` dispatch would be
a rule no code can check (field-check.ts cannot see GitHub's dispatches), so it would stay prose in
the lead skill and be forgotten.

**The doubt:** the `proof-set` artifact lives 90 days (`retention-days: 90`), and a field row lives
in git for good. If the owner wants each `full` ask kept past 90 days, the follow-up is a small
lead-tooling change that copies the record into a `field/notes/` row when `land.ts arm` reads the
run. That is not built here: it needs a row shape and a reader, and nobody reads these records yet.
What would settle it: the owner's word, or the first time someone looks for a `full` ask older than
90 days and cannot find it.

## Calls taken

- **`proof.ts`, the `select` job's `set` step, reads `scope`, not `gate.mjs`. 95%.** `proof.ts` is
  the script that chooses the set (its header table, and SC17 pins it as the select step's one
  command). `gate.mjs` decides only whether a run starts, from main's run history (`decide`'s
  table: a hand start always starts), runs on the runner's own Node with no install, and runs on
  main too. Putting the set's choice there would split one choice over two scripts and put a
  branch-only input in front of main's run.
- **A `full` ask names its law: `law`, a test file path that `vitest list` gives back exactly over
  the four projects a proof runs (`next`, `next-integration`, `next-visual`, `tooling`). A
  `changed` ask refuses a non-empty `law`. 80%.** Vitest's own list is the existing tool (0040): it
  checks the path exists, matches a project's include globs and is not excluded, and that the
  project is one a proof run runs (a `today` test would not run, so naming it would be false). A
  law that starts with `-` or holds whitespace is refused before Vitest sees it, so it can never
  read as a flag. The doubt: one reason for a full run may be "everything", with no single law;
  then the person names the law they distrust most. A list of laws can come later without losing
  data, since the record keeps the text as given.
- **The ask goes into `Seen`, the facts the select step read, not a fifth parameter of `choose`.
  80%.** It is one of those facts, and the tests change one helper (`seen()` in `proof.test.ts`)
  instead of every `choose` call. The cost: one line of `proof.ts`'s main block (line 277, the
  `Seen` literal) is also edited by pull request 1562 (`at:` there becomes `DateTime`). See "Clash
  with pull request 1562".
- **The `full` record also keeps git's changed files (`changed`), which today only the `changed`
  record keeps. 80%.** It is the input of the choice, and it is lost once a squash merge deletes
  the branch's commits; the base and head shas alone cannot rebuild it then. It is already in
  `Seen`, so it costs one key.
- **A `full` ask does not also list the changed set Vitest would have chosen. 80%.** That list
  costs one more `vitest list` (tens of seconds) to record a number nobody reads yet. It can be
  rebuilt from the recorded base, head and `changed` while those commits exist.
- **SC21 is a new rule for the two inputs and who reads them; SC17 changes in place to admit and pin
  `SCOPE` and `LAW`. 90%.** The input rule follows host.ts's H1 (a `choice` input, `required`, its
  default, its exact options) and l11.ts's input rule; the read rule follows SC5's "only these steps
  get the token".
- **On main, `scope` and `law` do nothing, silently. 85%.** A hand start on main is main's full run
  (0581), and `select` never runs there (SC17). The input descriptions say so. No gate changes, so
  no new path can narrow main.
- **`preflight.ts` keeps printing the plain start command. 85%.** With no `-f`, GitHub uses the
  default, `changed`, which is today's behavior, so the printed command stays right. A `full` start
  is `gh workflow run scheduled.yaml -R kamp-us/tea-fabrika --ref <branch> -f scope=full -f law=<test file>`,
  which the workflow's input descriptions and `askOf`'s refusal messages spell out.
- **`scheduled.mjs`, `gate.mjs` and `Arm.ts` need no change. 90%.** `scheduled.mjs`'s `skippable`
  reads select's `scope` output, which stays `full` or `changed`. `gate.mjs` reads main's runs only.
  `Arm.ts`'s `kind` reads job names: a `full` ask runs `tests (<leg>)` legs, so it reads as a full
  run, which is what it is.

## How others do it

- **GitHub Actions** (read from the docs' source in `github/docs` on raw.githubusercontent.com,
  2026-11-18: `workflow-syntax.md`, `contexts.md`, and the reusables `workflow-dispatch-inputs` and
  `inputs-vs-github-event-inputs`). A manual run's parameters are `on.workflow_dispatch.inputs`.
  `type: choice` takes `options`, "a sequence of strings that sets the options of the dropdown
  list", and "the default must be one of the values listed in options". `default` is "the default
  value used when the input is not specified when the workflow is triggered manually". The `inputs`
  context "is only available in a reusable workflow or in a workflow triggered by the
  workflow_dispatch event", and the same values arrive in `github.event.inputs`. This repo already
  does it twice: host.yaml's `suite` (a `choice`, default `l13`) and l11-exercise.yaml's `case`,
  each held by a lint rule (host.ts H1, l11.ts).
- **Vitest** is the makers' answer for the set itself (0590 point 1): `--changed` and
  `forceRerunTriggers`. A full run on request is simply no `--changed`, which is what the `tests`
  legs already run. Vitest 5.0.5, the installed version (`node_modules/vitest/package.json`).
- **Test impact analysis in the industry** keeps a "run everything" switch beside the selection, for
  when the selection is distrusted: Bazel's `bazel test //...` beside its affected targets, and
  Launchable and Develocity's predictive test selection, which each let a build opt out of the
  subset. Cited from memory, not fetched here. The shared shape: selection by default, the full set
  by an explicit ask, never the reverse.
- **Elm and Erlang/OTP** have no answer for a CI input; the nearest rule they give is the one used
  here: the input is data the edge decodes once (`askOf`), and the core (`choose`) takes a typed
  value, never a raw string.

## The shape

### scheduled.yaml, after (a sketch: exact keys, comments shortened)

```yaml
on:
  # By hand, on main or on a branch. On main it is main's full run whatever the inputs say: select
  # never runs there (SC17). On a branch it is a proof run (0590): `changed` runs what the change
  # reaches, and a rerun trigger still runs the full set; `full` runs the full set, for `law`.
  workflow_dispatch:
    inputs:
      scope:
        description: On a branch, the changed set (0590) or the full set; main always runs every test
        type: choice
        required: true
        default: changed
        options: [changed, full]
      law:
        description: With scope full, the test file that needs the full set, as vitest lists it
        type: string
        required: false
        default: ""

jobs:
  select:
    steps:
      - id: set
        name: set
        timeout-minutes: 5
        env:
          MOST: *proof-slots
          LIMIT: *next-limit
          RECORD: ${{ runner.temp }}/proof-set.json
          RUN_NUMBER: ${{ github.run_number }}
          SCOPE: ${{ inputs.scope }}
          LAW: ${{ inputs.law }}
        run: node .github/ci/proof.ts
```

Also in the file: the header's proof-run paragraph (lines 49 to 57) and the `select` comment (lines
296 to 304) say a `full` ask runs the full set too, and the `workflow_dispatch` comment (lines 85 to
86, which still says a branch start runs "every test on it", wrong since 0590) is replaced by the
one above.

### proof.ts, after (a sketch)

```ts
/** What the hand start asked for: `scope`, as scheduled.yaml's input gives it (0590). */
export const Scope = Schema.Literals(["changed", "full"]);

/** The ask, decoded: a `full` ask carries the law that needs the full set. */
export const Ask = Schema.TaggedUnion({ changed: {}, full: { law: Schema.String } });
export type Ask = typeof Ask.Type; // { _tag: "changed" } | { _tag: "full", law: string }

export type Seen = {
  readonly base: string;
  readonly head: string;
  readonly at: string;
  readonly vitest: string;
  readonly changed: readonly string[];
  readonly asked: Ask; // new
};

export type Proof =
  | {
      readonly _tag: "full";
      readonly base: string; readonly head: string; readonly at: string; readonly vitest: string;
      readonly asked: Ask;                 // new: a trigger under `changed`, or a `full` ask, or both
      readonly changed: readonly string[]; // new: git's changed files, as the `changed` record keeps
      readonly triggers: readonly string[];
    }
  | {
      readonly _tag: "changed";
      readonly base: string; readonly head: string; readonly at: string; readonly vitest: string;
      readonly asked: { readonly _tag: "changed" }; // a `full` ask can never be a changed set
      readonly changed: readonly string[];
      readonly legs: Readonly<Record<string, readonly string[]>>;
      readonly seconds: Readonly<Record<string, number>>;
    };

/**
 * The step's SCOPE and LAW, decoded, or a throw, so the step fails and prints nothing. No default:
 * scheduled.yaml's input holds the one default, so a missing SCOPE is an error, not `changed`.
 */
export const askOf = (scope: string | undefined, law: string | undefined, isLaw: (path: string) => boolean): Ask => {
  const decoded = Schema.decodeUnknownResult(Scope)(scope);
  if (Result.isFailure(decoded)) throw new Error(`proof: SCOPE must be changed or full, not ${JSON.stringify(scope)}`);
  const given = law ?? "";
  if (decoded.success === "changed") {
    if (given !== "") throw new Error("proof: LAW is only for scope full");
    return Ask.cases.changed.make({});
  }
  if (!/^[^\s-]\S*$/.test(given) || !isLaw(given)) {
    throw new Error(`proof: scope full needs LAW, a test file vitest lists, not ${JSON.stringify(given)}`);
  }
  return Ask.cases.full.make({ law: given });
};

/** Whether `vitest list` over the proof's projects gives back exactly `path`, by `lister`. */
export const inProjects =
  (lister: (args: readonly string[]) => readonly string[]) =>
  (path: string): boolean =>
    lister([...PROJECTS.flatMap((project) => ["--project", project]), path]).includes(path);

/** `choose`, as today, with the ask: a trigger or a `full` ask is the full set. */
export const choose = (seen: Seen, triggers: readonly string[], files: readonly string[], sizing: Sizing): Proof => {
  if (triggers.length > 0 || seen.asked._tag === "full") {
    const { base, head, at, vitest, changed, asked } = seen;
    return { _tag: "full", base, head, at, vitest, asked, changed, triggers };
  }
  // ... today's changed branch, with `asked: seen.asked` (narrowed to `changed` above) in the record
};
```

`summary` gains one case: a `full` ask with no trigger says "The full set, asked for by hand
(`scope: full`) for the law `<law>`: it runs every test, as main's full run does." A `full` ask
that also touched a trigger lists both. The trigger case under `changed` keeps today's line.

The main block changes in three places, none of them in pull request 1562's hunks but the third:

```ts
// after `const projects = ...` (line 258): the ask, read before any listing
const asked = askOf(process.env["SCOPE"], process.env["LAW"], inProjects((args) => list(root, args)));
// line 260: a `full` ask lists nothing, as a trigger does
const files = triggers.length > 0 || asked._tag === "full" ? [] : withReaders(/* as today */);
// line 277, the Seen literal: `asked` joins it
{ base, head, at: new Date().toISOString(), vitest: vitestPackage.version, changed, asked },
```

`proof.ts` needs no new import: `Schema` and `Result` are imported, and `list` comes from
`legs.ts` already.

### workflow-lint/scheduled.ts, after (a sketch)

```ts
// SC21. The hand start's two inputs (0590): `scope`, `changed` by default, and `law`. The default
// is 0590's ruling, not a free setting: a default of `full` would make every hand start the full set.
const SCOPE_INPUT = { type: "choice", required: true, default: "changed", options: ["changed", "full"] };
const LAW_INPUT = { type: "string", required: false, default: "" };
const SCOPE_READS = { SCOPE: "${{ inputs.scope }}", LAW: "${{ inputs.law }}" };

const dispatchInputs = (workflow: Record<string, unknown>, require: Require): void => {
  const inputs = map(map(map(workflow["on"])["workflow_dispatch"])["inputs"]);
  // keys exactly scope and law; each one's type, required, default and options as above; each has a
  // description of some text, whatever it says
  require(/* ... */, "SC21: a hand start takes scope, changed or full and changed by default, and law, text that is empty by default, and no other input");
  // the whole workflow but `on`, with select's set step's SCOPE and LAW taken out, reads no
  // `inputs` (so no `inputs.x`, `inputs['x']` or `github.event.inputs.x`) and no `toJSON(github.event)`
  require(/* ... */, "SC21: only select's set step reads the hand start's inputs, so main's runs never read scope");
};

// SC17: `selectKeys` becomes ["MOST", "LIMIT", "RECORD", "RUN_NUMBER", "SCOPE", "LAW"], and SCOPE and
// LAW must equal SCOPE_READS's values, compared with `compact`. `dispatchInputs(workflow, require)`
// is called beside `jobSlots(workflow, require)` (line 741). The header says SC1 to SC21.
```

`dispatchInputs` sits after `jobSlots` (it ends at line 370), away from every hunk of pull request
1562. It uses `map`, `compact` and `Predicate`, all imported already.

### What `scope` does on main, and the law that holds it

Nothing. Main's push, catch-up and hand start run `tests` on main's five groups, every leg at full
depth, whatever the inputs say (0598: branch proof keeps its four groups and slot counts, main its
five). Three lint rules hold it together, and none of them can pass if a later edit lets `scope`
reach main:

- SC17 (unchanged): `select` runs only when `github.event_name == 'workflow_dispatch' && github.ref != 'refs/heads/main'`.
- SC15 (unchanged): `tests` runs when `select` was skipped or said `full`.
- SC21 (new): nothing but `select`'s `set` step reads the inputs, so no `if`, group, `max-parallel`
  or env of `gate`, `tests`, `changed` or `report` can.

## One value traced through

A hand start on branch `fabrikalfa/x`, whose change touches only `.github/ci/gate.mjs`, started
with `-f scope=full -f law=.github/ci/proof.test.ts`:

1. `gate`: the event is `workflow_dispatch`, so `start`, `by_hand` (gate.mjs, unchanged).
2. `select` runs (a hand start, not main). Its `set` step gets `SCOPE=full`,
   `LAW=.github/ci/proof.test.ts`.
3. `proof.ts` checks `RUN_NUMBER` and `MOST`, reads base and head, and git's changed files:
   `[".github/ci/gate.mjs"]`. `triggered` finds none.
4. `askOf("full", ".github/ci/proof.test.ts", isLaw)`: `Scope` decodes `full`; the law is one word
   with no leading dash; `isLaw` runs `vitest list --project next --project next-integration
   --project next-visual --project tooling .github/ci/proof.test.ts`, which gives back
   `[".github/ci/proof.test.ts"]`, so it holds. The ask is `{ _tag: "full", law: ".github/ci/proof.test.ts" }`.
5. `files` is `[]`: a `full` ask lists no changed set.
6. `choose` gives `{ _tag: "full", base, head, at, vitest, asked: { _tag: "full", law: ".github/ci/proof.test.ts" }, changed: [".github/ci/gate.mjs"], triggers: [] }`.
7. `outputs`: `scope=full`, `legs=[]`, `files={}`, and the run's `slots`, as today.
8. The `proof-set` record holds that object and `slots`; the summary says the full set was asked
   for by hand for `.github/ci/proof.test.ts`.
9. `tests` runs (select said `full`): nine legs on `scheduled-proof-1` to `4`, four at once.
   `changed` is skipped.
10. `report`: `skippable` lets `changed` pass skipped, judges the nine legs, writes no issue on a
    branch.
11. `land.ts arm`: the jobs are `tests (<leg>)`, so `kind` is `full`; green at the head, it arms.

The same start without `-f`: GitHub fills `scope=changed` and `law=""`; `askOf` gives
`{ _tag: "changed" }`; the run is today's changed-set run, legs on `changed`. With
`-f scope=changed -f law=x`: the select step throws "LAW is only for scope full" and the run is
red. With `-f scope=full` and no law: it throws "scope full needs LAW" and the run is red before
any leg starts. The same start on `main`: `select` is skipped, `tests` runs on main's five groups,
and nothing reads `scope`.

## Laws

| Law | Kind | Generator | Plant that must fail | Law lives in | Runs |
|---|---|---|---|---|---|
| P6: the run tests the full set exactly when the change touches a rerun trigger or the ask is `full`; a full record carries the ask, git's changed files and the triggers, exactly; its outputs are `scope=full`, `legs=[]`, `files={}` | test | fc.record: changed, a subarray of the test file's TRIGGERS and PLAIN lists; asked, `changed` or `full` with a law from fc.constantFrom of three real test paths; files and sizing from the existing `set` arbitrary; seed 119120, 100 runs | `choose` reads only `triggers`: a `full` ask with no trigger splits a list | `.github/ci/proof.test.ts` | the merge line's related job (proof.test.ts reads `.github/`), the full run |
| P7: with a `changed` ask, a change to any rerun trigger 0590 names still runs the full set, and a change to none runs the changed set Vitest listed: 0590's rules kept | test | pinned: 0590's trigger files, today's TRIGGERS and PLAIN lists, the existing case updated with `asked` | `choose` lets a `changed` ask skip the trigger check: `.oxlintrc.json` gives changed legs | `.github/ci/proof.test.ts` | the merge line's related job, the full run |
| P8: `askOf` accepts exactly `changed` with no law, and `full` with a law `isLaw` holds; it throws `SCOPE` for any other scope, a missing or empty one included, so there is no second default; it throws `LAW` for `full` with an empty or refused law, and for `changed` with any law | test | fc.record: scope from fc.oneof of `changed`, `full`, empty, missing, `FULL`, ` full`, `readers` and fc.string; law from fc.oneof of missing, empty, the real paths and fc.string; isLaw a fixed set; seed 119120, 100 runs | `askOf` reads a missing SCOPE as `changed`: the missing case decodes | `.github/ci/proof.test.ts` | the merge line's related job, the full run |
| P9: a law that starts with `-` or holds whitespace is refused before `isLaw` is called, so it never reaches `vitest list` as a flag | test | pinned: `--project=today`, `-t x`, `a b.test.ts` and a tab, each with an `isLaw` that records its calls | Drop the dash check: `--project=today` reaches `isLaw` | `.github/ci/proof.test.ts` | the merge line's related job, the full run |
| P10: `inProjects` asks the lister for exactly the four projects' flags and the path, and holds only when the list gives back the path itself | test | fc.record: path from fc.stringMatching of test-file shapes; listing, an fc.subarray of the path, longer paths that contain it and unrelated paths; seed 119120, 100 runs | `includes` becomes a substring match: `proof.test.ts` holds for `.github/ci/proof.test.ts` | `.github/ci/proof.test.ts` | the merge line's related job, the full run |
| P11: a full ask's summary names its law and says it was asked for by hand; a trigger's summary under `changed` keeps today's text | test | pinned: one full ask, one trigger under `changed`, one of each together | `summary` drops the law | `.github/ci/proof.test.ts` | the merge line's related job, the full run |
| P12: a changed record cannot carry a full ask: a `// @ts-expect-error` on a `changed` Proof literal with `asked: { _tag: "full", law }` | type | type | Type the changed variant's `asked` as `Ask`: the expect-error line is unused and typecheck fails | `.github/ci/proof.test.ts` | typecheck |
| P13: the records keep their keys: a full record is exactly `_tag, asked, at, base, changed, head, triggers, vitest`; a changed record today's keys and `asked` | test | pinned: the two existing record-key cases, updated | Drop `asked` from the full record | `.github/ci/proof.test.ts` | the merge line's related job, the full run |
| S8: each SC21 input plant on a generated valid schedule gives SC21's error: the default becomes `full`; the default is missing; the options gain `readers` or lose `full`; `scope` becomes a `string`; `scope` is not required; a third input; `law` is missing; `law` is required; `law` has a default of a path | lint rule, with its test | fc.tuple: today's `scheduled` generator, each plant applied alone; seed 119120, 20 runs per plant | Drop SC21's default check: a default of `full` passes | `.github/ci/workflow-lint/scheduled.test.ts` | lint on every pull request, the merge line's related job, the full run |
| S9: an `inputs` read anywhere but select's set step gives SC21's error, whatever the place and the form | lint rule, with its test | fc.record: place, each job's `if`, each step's `if` and env, each job's group, the workflow group and `tests`'s `max-parallel`; form, `inputs.scope`, `inputs.law`, `inputs['scope']`, `github.event.inputs.scope` or `toJSON(github.event)`; over today's `scheduled` generator; seed 119120, 100 runs | SC21 scans only `tests`'s `if`: the gate's env reading `inputs.scope` passes | `.github/ci/workflow-lint/scheduled.test.ts` | lint on every pull request, the merge line's related job, the full run |
| S10: each SC17 plant gives SC17's error: SCOPE or LAW missing; SCOPE set to the literal `full`; SCOPE read from `github.event.inputs.scope`; SCOPE and LAW swapped; a seventh env key | lint rule, with its test | fc.tuple: today's `scheduled` generator, each plant applied alone; seed 119120, 20 runs per plant | SC17's key list admits any extra key: the seventh key passes | `.github/ci/workflow-lint/scheduled.test.ts` | lint on every pull request, the merge line's related job, the full run |
| S11: a schedule varied only where its meaning holds passes, now also with the spacing inside `${{ inputs.scope }}` and `${{ inputs.law }}` varied and any description text on both inputs | lint rule, with its test | fc.tuple: today's `scheduled` generator plus a description from fc.string and the spacing it already draws; seed 119120, 100 runs | SC17 compares SCOPE without `compact`: `${{inputs.scope}}` fails | `.github/ci/workflow-lint/scheduled.test.ts` | lint on every pull request, the merge line's related job, the full run |
| S12: main never reads scope: on the real scheduled.yaml, the only reads of `inputs` are select's SCOPE and LAW, and adding `&& inputs.scope != 'changed'` to `tests`'s `if` gives both SC15's and SC21's errors | lint rule, with its test | pinned: the real scheduled.yaml and that one plant | Drop SC21's read check: the plant gives SC15's error alone | `.github/ci/workflow-lint/scheduled.test.ts` | lint on every pull request, the merge line's related job, the full run |
| D1: a hand start with no `-f` reaches `proof.ts` as `SCOPE=changed` and `LAW` empty, and the run is today's changed-set run | test | scenario: one dispatch of this branch at the default scope, `changed`, read from its `proof-set` record | Leave `SCOPE` out of the set step's env: the select step throws `SCOPE` and the run is red | the run's `proof-set` record and summary | one real dispatch, the lead's call, before the first review |

D1 is the one law that needs a real dispatch, and it runs at `scope=changed`. Nothing else can
prove it: lint proves the expression's text and the tests prove `proof.ts`, but only GitHub
evaluates `${{ inputs.scope }}` with its default. If it went wrong it would fail closed: every
branch proof would end red at `select`, loudly, and no test would be skipped. So D1 is the lead's
call. The cost is one changed-set run of this branch (the tooling tests that read `.github/`,
on free public runners). There is no `full` dispatch: the `full` path after `select` is today's
trigger path, and `LAW` reaches the step by the same expression form as `SCOPE`, which lint holds.

No law here is host-only (0178): nothing runs launchd, Electron, a real OS process or a signal. No
law is an `.integration.` test and no test clones a repository: `proof.ts`'s main block, the only
code that runs git and Vitest, is untouched by every test (`import.meta.main` is false under
Vitest), and `scheduled.integration.test.ts` is not changed.

### Removed and Replacement (for loosening.sh)

Nothing is removed. These laws change in place, each stricter or wider, none looser:

| Removed | Replacement |
|---|---|
| `pinned: a change to any rerun trigger 0590 names runs the full set, whatever Vitest would list` (record without `asked` and `changed`) | the same title; its expected record gains `asked: { _tag: "changed" }` and `changed` (P7, P13) |
| `pinned: a changed set of zero files is a green run with no leg, and its record and summary say so` | the same title; `seen()` gives `asked`, so the expected record carries it |
| `pinned: the changed legs run every project proof.ts lists, and no other, and the record keeps what a run tested` (keys without `asked`) | the same title; the key list gains `asked` (P13) |
| SC17's key list `MOST, LIMIT, RECORD, RUN_NUMBER` (rule text) | `MOST, LIMIT, RECORD, RUN_NUMBER, SCOPE, LAW`, the two new ones pinned to their exact values (stricter) |

## Files

| File | Change | Product lines expected | Owner | Slice | How judged |
|---|---|---|---|---|---|
| `.github/workflows/scheduled.yaml` | The `workflow_dispatch` inputs `scope` and `law`; `SCOPE` and `LAW` in select's set step env, after `RUN_NUMBER`; the comments at lines 49 to 57, 85 to 86 and 296 to 304 | 25 | tests | 1 | SC17, SC21; D1 |
| `.github/ci/proof.ts` | `Scope`, `Ask`, `askOf`, `inProjects`; `Seen.asked`; both `Proof` variants gain `asked`, the full one `changed`; `choose` takes the ask; `summary`'s full-ask line; the header table gains the `full` row; the main block's three edits | 45 | tests | 1 | P6 to P13 |
| `.github/ci/proof.test.ts` | `seen()` gives `asked: { _tag: "changed" }`; P6, P8 to P12 new; P7 and P13 update the existing cases (mapping table) | tests | tests | 1 | laws |
| `.github/ci/workflow-lint/scheduled.ts` | `dispatchInputs` (SC21), new, after `jobSlots`, and its call beside `jobSlots`'s (line 741); SC17's `selectKeys` (line 595) and two value checks; line 1 says SC1 to SC21 | 45 | tests | 1 | 0590; SC17, SC21 |
| `.github/ci/workflow-lint/scheduled.test.ts` | S8, S10 as plants in the `plants` list; S9 and S12 new; S11 widens the `scheduled` generator | tests | tests | 1 | laws |
| `.glossary/TERMS.md` | The `proof run`, `full run` and `changed set` rows: a hand start on a branch runs the full set when its change touches a rerun trigger or when it asks `scope: full` for a named law; `changed` is the default | docs | build | 2 | 0590; this plan |
| `.github/ci/scheduled.mjs`, `.github/ci/gate.mjs`, `.github/ci/legs.ts`, `.github/ci/related.ts` | Not changed: `skippable` reads select's `scope` output, which keeps its two values; the gate reads main's runs only; `list` and `isTrigger` are used as they are; related.ts imports `isTrigger`, `legsOf` and `whole`, which keep their signatures | 0 | tests | none | read only |
| `.github/ci/workflow-lint/scheduled.integration.test.ts`, `.github/ci/field-check.ts`, `.github/ci/field-schema.ts`, `.github/workflows/check.yaml`, `.github/workflows/host.yaml` | Not changed: `--job-slots` checks only the groups; no field row is added; check.yaml and host.yaml were read for the shape | 0 | tests | none | read only |
| `.github/`, `.github/ci`, `.github/ci/`, `.github/ci/workflow-lint` | Named only: folders the prose names; every file changed in them is its own row | 0 | tests | none | not files |
| `.agents/skills/lead/scripts/pr/Arm.ts`, `.agents/skills/lead/scripts/ci/preflight.ts`, `.agents/skills/lead/scripts/loosening.sh` | Not changed: `kind` reads job names, which a `full` ask keeps; the printed start command stays right at the default; loosening.sh is the lead's, run on the mapping table above | 0 | tests | none | read only |
| `vitest.config.ts`, `.oxlintrc.json`, `package.json`, `pnpm-lock.yaml`, `tsconfig.base.json` | Not changed: the rerun triggers 0590 names, read for the selection rules | 0 | tests | none | read only |

### Commit order

One slice of code, in one commit, since no part of it lands whole alone: `proof.ts` without the
workflow's `SCOPE` would make every branch proof red at `select`, and the workflow without
`proof.ts` would pass an input nothing reads. Then the glossary rows, by the build step.

## Amendment 1, 2026-11-18: main merged in after the sev0 pause

The lead merged origin/main (1775071ca) into the branch before the tests step. What changed for this
plan, and what it now says:

- **Pull request 1562 is on main.** `proof.ts`'s main block reads its variables through `Config.all`
  (lines 232 to 241 at the merge), and line 277's `at:` is `DateTime`. So the first rule under
  "Clash with pull request 1562" applies: `SCOPE` and `LAW` are two more
  `Config.String(...).pipe(Config.withDefault(undefined))` entries in that `Config.all`, passed to
  `askOf` unchanged, and new code follows the lint 1562 brought. The line numbers in that section
  are from before the merge; the tests step reads the merged file.
- **Pull request 1567 lands before this one.** It changes the four test commands and the changed
  step's `LEG` in `scheduled.yaml`, and the SC rule that pins those commands in `scheduled.ts`. None
  of those lines is one this plan edits. When 1567 is on main, the branch merges main again before
  the build step, and any conflict is resolved by keeping both changes.
- **The merge line still runs the tooling tests on a pull request.** Since pull requests 1613 and
  1615, a pull request and a merge queue group pick the `tooling` project alone in the related job
  (`related.ts`'s `projectsOf`), so `proof.test.ts` and `scheduled.test.ts` still run there, as the
  Laws table says.
- **D1 waits for the sev0 to end** or for fabrikaa to allow one dispatch of this branch at
  `scope=changed`. If neither comes before the review, the review goes ahead without it, and the
  pull request says D1 is owed: its failure mode fails closed (every branch proof red at `select`),
  and the first branch proof after the merge runs it.

## Clash with pull request 1562

Pull request 1562 (ticket 1075, an Effect sweep, open) edits both of this ticket's shared files.
Its hunks, read from the GitHub API on 2026-11-18:

- `proof.ts`: the import block (lines 38 and 43), the main block's env reads (lines 231 to 232,
  272, 287, 293, 299, through a new `step-env.ts`), and line 277's `at:`.
- `workflow-lint/scheduled.ts`: `Object.keys`, `Object.values` and `Object.entries` become
  `Record.keys` and friends at lines 2 to 8, 412 to 430, 449 to 529, 669 to 675, 692 to 698 and
  806 to 812.

This plan's edits avoid all of those lines but one: `proof.ts` line 277, the `Seen` literal, gains
`asked`, beside 1562's `at:` change. That is a one-line conflict for whichever lands second. Two
more rules for that second lander:

- If 1562 is on main when the tests step starts, `SCOPE` and `LAW` are read the way 1562 reads the
  others: two `Config.String(...).pipe(Config.withDefault(undefined))` entries in its
  `Config.all`, passed to `askOf` unchanged. `askOf` takes `string | undefined` either way, so its
  laws do not change.
- New code in `scheduled.ts` and `proof.ts` uses whatever 1562's lint asks of those files on main
  then (`Record.keys` in place of `Object.keys`, if 1562's rule covers `.github/ci/`). The sketch
  above uses neither where it can, such as comparing a sorted key list from `map`.

Pull request 1567 handed `scheduled.yaml` to this ticket, so it has no other writer.

## Existing tools

- `.github/ci/proof.ts` `askOf`: new function in an existing file. Searched proof.ts (`whole`,
  which reads one number from the env), legs.ts (`budgetOf`), gate.mjs and changes.mjs for an
  input decoder, and `effect` for the decode: `Schema.Literals` and `Schema.decodeUnknownResult`,
  as `slots` decodes its count, are reused. None reads two related inputs together.
- `.github/ci/proof.ts` `inProjects`: new function in an existing file. Searched legs.ts (`list`,
  `isTrigger`), vitest.config.ts (`projects`, and its `isTest` helper) and
  Vitest's CLI. Vitest's own `vitest list <filter>` is the check, through legs.ts's `list`; the
  function only builds its arguments and compares the answer exactly. A picomatch match over
  `projects`' globs was the other way, and it would need a new import in a file 1562 also edits
  and its own existence check.
- `.github/ci/proof.ts` `Scope` and `Ask`: new schemas, Effect Schema as 0209 asks, `_tag` cases as
  0214 asks. Searched proof.ts's `Proof` and Arm.ts's `Kind` and `Verdict` (`Schema.Literals`,
  `Schema.TaggedUnion`), whose shape they copy.
- `.github/ci/workflow-lint/scheduled.ts` `dispatchInputs`: new function in an existing file.
  Searched workflow-lint's host.ts (H1, a `choice` input with its default), l11.ts (its inputs
  rule) and shared.ts (`map`, `compact`, `steps`, `allSteps`). It copies H1's shape and reuses
  `map` and `compact`; none of them checks who reads an input.
- GitHub's own `type: choice` refuses an option outside the list in the UI. `askOf` still decodes
  the value, because the API and `gh` are other ways in, and a check at the edge costs one line.

## Is this a setting?

- **The default `changed`: not a setting, 90%.** 0069's test is "a pick between paths the code
  already has and tests", and both paths exist, but the default is 0590's ruling, "a branch's proof
  run runs only the tests its change reaches". A default of `full` would undo that for every start
  that gives no `-f`, so changing it is a decision, not an edit, and SC21 holds it the way SC16
  holds the gap's floor of 60. It is declared once, in `scheduled.yaml`'s
  `on.workflow_dispatch.inputs.scope.default`; `proof.ts` has no default of its own (`askOf` throws
  on a missing SCOPE, law P8), so the code, the test and the person never see two defaults.
- **The per-run choice, `scope` itself: yes, and the input is its one declaration.** A person sets
  it the same way a test does: GitHub's UI, `gh workflow run -f scope=...` and the API are its
  providers, and the lint and unit tests read the same file.
- **The options `changed` and `full`: not a setting.** They are the two paths `proof.ts` has.
- **`law`: not a setting.** It is a fact of one run, with no default to choose.

## Records

- **What a fact lost would be:** why a branch spent the full set. A `full` ask with no trigger
  leaves nothing in today's record to say why. Now the `proof-set` record and the summary keep the
  ask and its law, written by the run itself.
- **Recorded now that was not:** git's changed files on a full record. They are the input of the
  choice, and a squash merge deletes the branch's commits, after which the base and head shas
  cannot rebuild them.
- **Not recorded:** who asked. GitHub keeps the run's `triggering_actor`, so nothing is lost by not
  copying it. Whether GitHub's run object keeps the inputs themselves was not checked here; the
  record does not rely on it.
- **How long:** the `proof-set` artifact keeps 90 days (`retention-days: 90`). See "Doubt first".

## Validation

The tests step, on its own files, in order: `pnpm format`; `pnpm lint` (which runs workflow-lint,
SC21 included, and `lint:dead`, which sees `askOf` and `inProjects` used by the tests); `nice -n 15
pnpm exec vitest run --maxWorkers=3 .github/ci/proof.test.ts .github/ci/workflow-lint/scheduled.test.ts`
while working. The lead runs the one pass over everything the branch changed and the one type
check (P12 is a type law). The build step runs `pnpm lint` for the glossary rows.

## Real-run proof

Before the merge:

1. **The pull request's own check run:** the lint job runs workflow-lint on the real
   `scheduled.yaml`, so SC17 and SC21 pass on it; the related job runs `proof.test.ts` and
   `scheduled.test.ts`, which read `.github/` and so are in its set.
2. **D1, the lead's call, before the first review:** one dispatch of this branch with no `-f`
   (`preflight.ts` passes it: `--job-slots` checks only the groups, which this change leaves alone).
   Its `proof-set` record shows `asked: { "_tag": "changed" }` and the changed set, and its summary
   reads as today's.

After the merge: the first branch proof anyone starts is the same check again, at no extra cost.
No `full` dispatch is needed or asked for: its nine legs on four groups cost about 26 to 28 minutes
of legs (0598), and they prove nothing the trigger path does not already prove daily.

## Size

Sized by the files table, in product lines; about 80% sure of each number, 70% for scheduled.ts.

1. **Slice 1, the scope input: 115 lines.** scheduled.yaml, proof.ts, the SC21 and SC17 lint, and
   their tests. What the owner sees first: a hand start's "Run workflow" form shows `scope` and
   `law`, and a `full` run's summary names its law.
2. **Slice 2, the glossary rows: 3 lines.**

Both land in one pull request. The tests step writes slice 1, since every file in it is under
`.github/` (an exam path); the build step writes slice 2 and checks the whole. Priced from the 0598
quest, CI work of the same kind: its plan $4.90 and its first tests step $4.20 at list price
(`field/runs/2026-11-18-merge-line-slots-0598-plan.json` and `-tests1.json`). This lint change is
about a third of 0598's, so about $3 a step. Steps: tests, build, review, one likely send-back of
the tests step, one recheck.

Estimate: 5 steps, $15

## What this cannot tell us

- Whether the record should outlive its 90-day artifact (Doubt first).
- How often a `full` ask will be used. Nothing measures it before the change; the records will.
- Whether one law per `full` ask is enough: a run asked for "everything" has to name one law.
- Whether GitHub's API refuses a `choice` value outside the options. Read only from the docs' UI
  wording; `askOf` refuses it either way.
- This change leaves the motivating run, a rerun-trigger change, as it was (said first, at the top).

## Open questions

1. **Should `scope: changed` override a rerun trigger, so that a branch touching a file in
   vitest.config.ts's `forceRerunTriggers` (such as `.oxlintrc.json`, as pull request 1525 did)
   runs only its import-graph set when started with the default? Yes or no. The lean: no, 80%.**
   Nothing is built for it. **Yes** walks back 0590 point 3 ("a change to a file in vitest's
   `forceRerunTriggers` runs the full set, as today") for hand starts. It costs a third selection
   path in `proof.ts`: Vitest's own `--changed` returns every test when a changed file matches a
   trigger (`filterTestsBySource`, Vitest 5.0.5, as `proof.ts`'s header says), so the run would
   have to list with the triggers taken out of Vitest's view. And it misses exactly the laws the
   triggers are for, the tests that read those files as text, such as the lint plugins' tests of
   `.oxlintrc.json`, until 0591's `reads:` declarations land (they have not: `changes.mjs` still
   keeps the `readers` list). A miss shows on main's next full run, within about an hour of the
   merge (0581), as a red main and a `ci-scheduled` issue. The gain: a run like 1525's would take a
   few changed legs instead of nine legs on four proof groups, about 26 to 28 minutes (0598).
   **No** keeps 0590 as it is: a trigger change keeps its full set. Since 0598 that set holds only
   the four proof groups, never a pull request's legs, so its remaining cost is that a second proof
   started at the same time waits behind it.

## Findings

None found. The one stale line met on the way, `scheduled.yaml`'s `workflow_dispatch` comment
saying a branch start runs every test, is in a file this plan changes, so the plan fixes it.
