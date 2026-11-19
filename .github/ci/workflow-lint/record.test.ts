import {
  env,
  place,
  type Plant,
  rejects,
  step,
  stepsOf,
  type Timed,
  timings,
  token,
  type Workflow,
} from "./wiring.test-support.ts";

// Today's CI, serving both versions. Covers record.ts: the record a ready pull request run leaves
// for the merge queue (Q1). Each plant is given to every generated valid workflow alone
// (wiring.test-support.ts), so an unrelated error cannot mask it.

/** changes' record step's env, for a plant that changes one value. */
// SAFETY: the record step in `valid` carries an `env` map of strings, read untyped through `step`.
const recordEnv = (w: Workflow) => step(w, "changes", "record")["env"] as Record<string, string>;

/** changes' upload of the record, for a plant that changes one input. */
// SAFETY: `valid` writes the upload step's `with` block as a map of inputs.
const uploadWith = (w: Workflow) => step(w, "changes", "upload the record")["with"] as Record<string, unknown>;

const plants: Plant[] = [
  // Q1: a ready pull request run records the tree it tests and what changes printed, and uploads it
  // under the name it printed, and neither step fails the run. Each plant here would let the record
  // say more than the run tested, or let a broken record fail a pull request. Each of Q1's checks in
  // workflow-lint.ts was also planted out once and turned these red; dropping the record env's key
  // set survived until the "one more value" plant.
  ["Q1: the record step is gone", (w) => w.jobs.changes.steps.splice(place(w, "changes", "record"), 1)],
  [
    "Q1: the record step runs on drafts too",
    (w) => (step(w, "changes", "record")["if"] = "github.event_name == 'pull_request'"),
  ],
  ["Q1: the record step runs on every event", (w) => Reflect.deleteProperty(step(w, "changes", "record"), "if")],
  [
    "Q1: a failed record fails the run",
    (w) => Reflect.deleteProperty(step(w, "changes", "record"), "continue-on-error"),
  ],
  [
    "Q1: the record step runs before the size step",
    (w) => {
      const [moved] = w.jobs.changes.steps.splice(place(w, "changes", "record"), 1);
      w.jobs.changes.steps.splice(place(w, "changes", "size"), 0, moved!);
    },
  ],
  ["Q1: the record names the branch's head, not the merge commit", (w) => (recordEnv(w)["TESTED"] = env.HEAD)],
  [
    "Q1: the record reads next from the first pass, not the size step",
    (w) => (recordEnv(w)["NEXT"] = `\${{ steps.diff.outputs.next }}`),
  ],
  [
    "Q1: the record reads filter from the first pass, not the parser's",
    (w) => (recordEnv(w)["FILTER"] = `\${{ steps.diff.outputs.filter }}`),
  ],
  ["Q1: the record says check ran", (w) => (recordEnv(w)["CHECK"] = "true")],
  ["Q1: the record loses its build flag", (w) => Reflect.deleteProperty(recordEnv(w), "BUILD")],
  ["Q1: the record step gets the token", (w) => (recordEnv(w)["GITHUB_TOKEN"] = token)],
  [
    "Q1: the record step reads one more value than changes exposes",
    (w) => (recordEnv(w)["RUNNER_TEMP"] = `\${{ github.workspace }}`),
  ],
  ["Q1: the record's upload is gone", (w) => w.jobs.changes.steps.splice(place(w, "changes", "upload the record"), 1)],
  [
    "Q1: the upload comes before the record",
    (w) => {
      const [moved] = w.jobs.changes.steps.splice(place(w, "changes", "upload the record"), 1);
      w.jobs.changes.steps.splice(place(w, "changes", "record"), 0, moved!);
    },
  ],
  ["Q1: the upload runs with no name", (w) => Reflect.deleteProperty(step(w, "changes", "upload the record"), "if")],
  [
    "Q1: a failed upload fails the run",
    (w) => Reflect.deleteProperty(step(w, "changes", "upload the record"), "continue-on-error"),
  ],
  ["Q1: the upload takes a fixed name", (w) => (uploadWith(w)["name"] = "tested")],
  ["Q1: the upload keeps the record forever", (w) => Reflect.deleteProperty(uploadWith(w), "retention-days")],
  ["Q1: a rerun's upload fails on the name its first attempt left", (w) => (uploadWith(w)["overwrite"] = false)],
  [
    "Q1: a second upload of the record",
    (w) => {
      const upload = structuredClone(step(w, "changes", "upload the record"));
      w.jobs.changes.steps.splice(place(w, "changes", "upload the record") + 1, 0, upload);
    },
  ],
  // Q1: every job tests the tree the record names, `github.sha`'s, so no checkout is told another
  // commit or repository; and the record's upload is the only upload, since `matched` trusts any
  // artifact of the record's name.
  ...(
    [
      ["changes", "ref", `\${{ github.event.pull_request.head.sha }}`],
      ["check", "ref", `\${{ github.event.pull_request.head.ref }}`],
      ["check", "repository", `\${{ github.event.pull_request.head.repo.full_name }}`],
      ["ci-required", "ref", "main"],
    ] as const
  ).map(([job, key, value]): [string, (w: Workflow) => void] => [
    `Q1: ${job}'s checkout is told its ${key}`,
    (w) => {
      const checkout = stepsOf(w, job).find((s) => String(s["uses"]).startsWith("actions/checkout@"))!;
      // SAFETY: the `find` above is the job's actions/checkout step, and each checkout in `valid` has a `with` map.
      (checkout["with"] as Record<string, unknown>)[key] = value;
    },
  ]),
  ...(["typecheck", "next"] as const).map((job): [string, (w: Workflow) => void] => [
    `Q1: ${job} checks out the branch's head`,
    (w) => {
      stepsOf(w, job).unshift({
        name: "checkout",
        uses: "actions/checkout@v7",
        with: { ref: `\${{ github.event.pull_request.head.sha }}`, "persist-credentials": false },
      });
    },
  ]),
  [
    "Q1: next uploads an artifact too",
    (w) => {
      const upload = { name: "results", uses: "actions/upload-artifact@v7", with: { name: "next", path: "next.json" } };
      stepsOf(w, "next").splice(place(w, "next", "shard times"), 0, upload);
    },
  ],
  [
    "Q1: check uploads an artifact with another owner's action",
    (w) => {
      const upload = { name: "upload", uses: "someone/upload-artifact@v1", with: { name: "tested-a-b", path: "x" } };
      stepsOf(w, "check").splice(place(w, "check", "field rows"), 0, upload);
    },
  ],
  // Q1 beside TT2: the one other upload is a test leg's timings file, exactly TT2's, in a test job.
  // Anything else is still refused, and no allowed upload can carry a record's `tested-` name.
  [
    "Q1: typecheck uploads an artifact, before its stop step",
    (w) => {
      const upload = { name: "upload", uses: "actions/upload-artifact@v7", with: { name: "typecheck", path: "x" } };
      stepsOf(w, "typecheck").splice(-1, 0, upload);
    },
  ],
  [
    "Q1: typecheck uploads a timings file, outside the test jobs",
    (w) => stepsOf(w, "typecheck").splice(-1, 0, timings()),
  ],
  ...(["next"] as const).flatMap((job): [string, (w: Workflow) => void][] => {
    // SAFETY: every step of next in `valid` is a `NextStep`, which has the fields of `Timed`.
    const upload = (w: Workflow) => (stepsOf(w, job) as Timed[]).find((s) => s["name"] === "timings")!;

    return [
      [
        `Q1: ${job}'s timings upload is named as a tested-tree record`,
        (w) => (upload(w).with!["name"] = `tested-\${{ github.sha }}-\${{ github.event.pull_request.base.sha }}`),
      ],
      [`Q1: ${job}'s timings upload overwrites an artifact of its name`, (w) => (upload(w).with!["overwrite"] = true)],
      [
        `Q1: ${job}'s timings upload takes another file`,
        (w) => (upload(w).with!["path"] = `\${{ runner.temp }}/x.json`),
      ],
    ];
  }),
];

rejects(plants);
