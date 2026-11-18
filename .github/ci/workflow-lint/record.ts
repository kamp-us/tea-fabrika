// Today's CI, serving both versions. check.yaml's Q1: the record a ready pull request run leaves
// for the merge queue, its one upload, and every job testing the tree the record names.
import { deliveryUpload } from "./related.ts";
import { allSteps, classifier, compact, FLAGS, map, type Rule, sameEntries, steps, uses } from "./shared.ts";
import { isTimings, TIMED_LEGS } from "./time-tables.ts";

// Q1. The record a ready pull request run leaves for the merge queue: its pass of changes.mjs, on a
// ready pull request alone, the merge commit the run checks out, and the upload of what it wrote
// under the name it printed. `retention-days` is a setting (0069), so only its being there is held.

const RECORD = "node .github/ci/changes.mjs --record";

const RECORD_IF = "github.event_name=='pull_request'&&!github.event.pull_request.draft";

const TESTED = `\${{ github.sha }}`;

const RECORD_UPLOAD = {
  name: `\${{ steps.record.outputs.name }}`,
  path: `\${{ runner.temp }}/tested.json`,
  overwrite: true,
  "if-no-files-found": "error",
};

export const record: Rule = ({ workflow, jobs }, require) => {
  const changes = map(jobs["changes"]),
    outputs = map(changes["outputs"]);

  const changeSteps = steps(changes);

  const sizing = changeSteps.find((s) => s["id"] === "size");

  // Q1. A merge queue group a ready pull request run already tested skips its tests (changes.mjs's
  // `matched`), found by the record that run's changes job leaves. The record step runs on a ready
  // pull request alone, after the size step, and reads the merge commit the run tests and what
  // changes printed through the very expressions of changes' outputs, so the selection it records
  // is the one the jobs ran. It and its upload may fail without failing the run: then no record, and
  // the group runs its tests.

  const recordStep = changeSteps.filter((s) => s["run"] === RECORD);

  const recorder = recordStep[0];

  const recordEnv = map(recorder?.["env"]);

  const selected = Object.fromEntries([...FLAGS, "next", "filter"].map((name) => [name.toUpperCase(), outputs[name]]));
  require(recordStep.length === 1 &&
    recorder?.["id"] === "record" &&
    compact(recorder["if"]) === RECORD_IF &&
    recorder["continue-on-error"] === true &&
    sizing !== undefined &&
    changeSteps.indexOf(sizing) <
      changeSteps.indexOf(
        recorder,
      ), "Q1: changes records the tested tree once, after the size step, on a ready pull request alone, and its failure fails nothing");
  require(JSON.stringify(Object.keys(recordEnv).toSorted()) ===
    JSON.stringify([...Object.keys(classifier), "TESTED", ...Object.keys(selected)].toSorted()) &&
    Object.entries(classifier).every(([key, expected]) => recordEnv[key] === expected) &&
    recordEnv["TESTED"] === TESTED &&
    Object.entries(selected).every(
      ([key, expected]) => compact(recordEnv[key]) === compact(expected),
    ), "Q1: the record step reads the run's event, the merge commit it tests, and changes' outputs as changes exposes them");

  const uploads = changeSteps.filter((s) => uses(s, "actions/upload-artifact"));

  const upload = uploads[0];

  const kept = map(upload?.["with"])["retention-days"];
  require(uploads.length === 1 &&
    recorder !== undefined &&
    upload !== undefined &&
    changeSteps.indexOf(recorder) < changeSteps.indexOf(upload) &&
    compact(upload["if"]) === "steps.record.outputs.name!=''" &&
    upload["continue-on-error"] === true &&
    sameEntries(
      Object.entries(map(upload["with"])).filter(([key]) => key !== "retention-days"),
      Object.entries(RECORD_UPLOAD),
    ) &&
    typeof kept === "number" &&
    kept >=
      1, "Q1: changes uploads the record once, after the record step, under the name it printed, and its failure fails nothing");

  // Q1. The record names the tree of `github.sha`, so every job must test that tree: a checkout
  // told another `ref` or `repository` (say the branch's head) would test one tree while the record
  // names another, and a group of the named tree would skip tests nobody ran. `matched` trusts any
  // artifact of the record's name from a green run, so the record's upload is the one step in the
  // workflow that uploads one, whatever action does it, beside the test legs' timings uploads: each
  // in a job of TIMED_LEGS (next alone since 0539), with exactly TT2's `with:`, so its name is
  // `timings-...` and never a record's.

  for (const [name, job] of Object.entries(jobs)) {
    for (const step of allSteps(map(job)).filter((s) => uses(s, "actions/checkout"))) {
      const given = map(step["with"]);
      require(!("ref" in given) &&
        !("repository" in given), `Q1: ${name}'s checkout takes the run's own commit: no ref or repository`);
    }
  }

  const uploaders = Object.values(jobs).flatMap((job) =>
    allSteps(map(job)).filter((s) => typeof s["uses"] === "string" && /(?:^|\/)upload-artifact@/.test(s["uses"])),
  );

  const reports = [
    [
      "select",
      "selected files",
      {
        name: "related-set",
        path: `\${{ runner.temp }}/related-set.json`,
        "if-no-files-found": "ignore",
        "retention-days": 90,
      },
    ],
    [
      "related",
      "results",
      {
        name: `results-related-\${{ matrix.shard }}`,
        path: `\${{ runner.temp }}/related.json`,
        "if-no-files-found": "error",
        "retention-days": 7,
      },
    ],
  ] as const;

  const reportUploads = reports.flatMap(([job, name, expected]) => {
    const found = allSteps(map(jobs[job])).filter(
      (step) =>
        uses(step, "actions/upload-artifact") &&
        step["name"] === name &&
        compact(step["if"]) === "!cancelled()" &&
        Object.keys(step).length === 4 &&
        sameEntries(Object.entries(map(step["with"])), Object.entries(expected)),
    );

    require(found.length === 1, `Q1: ${job} uploads only its exact related report once`);

    return found;
  });

  const related = map(jobs["related"]);

  const deliveries = allSteps(related).filter((step) => deliveryUpload(workflow, "related", related, step));
  require(deliveries.length === 1, "Q1: exactly one archive upload uses the bounded two-file contract");

  const timingsUploads = TIMED_LEGS.flatMap(([name]) => allSteps(map(jobs[name])).filter(isTimings));
  require(upload !== undefined &&
    uploaders.filter((s) => s === upload).length === 1 &&
    uploaders.every(
      (s) => s === upload || timingsUploads.includes(s) || reportUploads.includes(s) || deliveries.includes(s),
    ), "Q1: the record's upload is the one step in check.yaml that uploads an artifact, beside the test legs' timings");
};
