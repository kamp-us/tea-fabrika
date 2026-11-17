// Today's tooling. This manual exercise supplies no branch proof.
import { parse } from "yaml";
import { bootstrap, cached, cases, uncached } from "../l11-cases.ts";
import { allSteps, compact, map, sameEntries } from "./shared.ts";

const expression = (value: string) => `$` + `{{ ${value} }}`;

const install = 'pnpm install --frozen-lockfile > "$RUNNER_TEMP/l11-trusted-install.log" 2>&1';

const command = "nice -n 19 node .github/ci/l11-exercise.ts";

const trust = [
  'test "$GITHUB_REF" = refs/heads/main',
  'test "$GITHUB_WORKFLOW_REF" = "$GITHUB_REPOSITORY/.github/workflows/l11-exercise.yaml@refs/heads/main"',
  'test "$(git rev-parse HEAD)" = "$GITHUB_WORKFLOW_SHA"',
].join("\n");

const slots = Array.from({ length: 10 }, (_, index) => `slot-${index + 1}`);

const jobs = ["manifest", "compare", "inputs", "output", ...slots, "collect"];

const keys = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : typeof value === "string" ? [value] : []);

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

const plain = (value: unknown) => value === undefined || (typeof value === "string" && !value.includes("$" + "{{"));

export const lintL11 = (text: string): string[] => {
  const errors: string[] = [];

  const require = (holds: boolean, reason: string) => {
    if (!holds) {
      errors.push(`l11-exercise.yaml: ${reason}`);
    }
  };

  let workflow: Record<string, unknown>;

  try {
    workflow = map(parse(text));
  } catch {
    return ["l11-exercise.yaml: invalid YAML"];
  }

  const on = map(workflow["on"]);
  const dispatch = map(on["workflow_dispatch"]);
  const inputs = map(dispatch["inputs"]);
  const selected = map(inputs["case"]);
  const sha = map(inputs["sha"]);
  require(keys(workflow, ["name", "on", "permissions", "jobs"]) &&
    Object.keys(on).join() === "workflow_dispatch" &&
    Object.keys(dispatch).join() === "inputs" &&
    same(Object.keys(inputs).toSorted(), ["case", "sha"]) &&
    selected["type"] === "choice" &&
    selected["required"] === true &&
    same(list(selected["options"]).toSorted(), [...cases].toSorted()) &&
    keys(selected, ["description", "type", "required", "options"]) &&
    sha["type"] === "string" &&
    sha["required"] === true &&
    sha["default"] === cached &&
    keys(sha, [
      "description",
      "type",
      "required",
      "default",
    ]), "L1: dispatch has only the closed case and exact-source request");
  require(plain(workflow["name"]) &&
    sameEntries(Object.entries(map(workflow["permissions"])), [
      ["contents", "read"],
    ]), "L2: only contents:read is granted");
  const configured = map(workflow["jobs"]);
  require(same(
    Object.keys(configured).toSorted(),
    jobs.toSorted(),
  ), "L3: comparison, diagnostic, output, manifest, ten slots and collector are fixed jobs");

  for (const name of jobs) {
    const job = map(configured[name]);
    const steps = allSteps(job);
    const checkout = steps[0];
    const gate = steps[1];
    const execution = steps.find((step) => step["id"] === "l11");
    const index = slots.indexOf(name);
    const mode = index >= 0 ? "batch" : name;

    const expectedEnv: Record<string, string> = {
      L11_CASE: expression("inputs.case"),
      L11_SHA: expression("inputs.sha"),
      L11_MODE: mode,
    };

    if (index >= 0) {
      expectedEnv["L11_SLOT"] = String(index + 1);
    }

    if (name === "compare") {
      expectedEnv["L11_VARIANT"] = expression("matrix.variant");
    }

    require(job["name"] === `l11-${name}${name === "compare" ? `-${expression("matrix.variant")}` : ""}` &&
      steps.every((step) => plain(step["name"])) &&
      keys(job, ["name", "runs-on", "timeout-minutes", "needs", "if", "strategy", "steps"]) &&
      job["runs-on"] === "ubuntu-latest" &&
      job["timeout-minutes"] === 20 &&
      steps.length >= 4 &&
      execution !== undefined &&
      execution["run"] === command &&
      execution["timeout-minutes"] === 17 &&
      keys(execution, ["id", "name", "run", "env", "timeout-minutes"]) &&
      sameEntries(
        Object.entries(map(execution["env"])),
        Object.entries(expectedEnv),
      ), `L4 ${name}: fixed runner, limits and trusted execution with literal internal slot data`);
    require(checkout?.["uses"] === "actions/checkout@v7" &&
      keys(checkout, ["name", "uses", "with"]) &&
      sameEntries(
        Object.entries(map(checkout["with"])),
        Object.entries({
          ref: expression("github.workflow_sha"),
          "persist-credentials": false,
          "fetch-depth": 1,
          submodules: false,
          lfs: false,
        }),
      ) &&
      gate?.["run"] === trust &&
      keys(gate, ["name", "run"]), `L5 ${name}: trusted workflow checkout fails a wrong ref before setup`);

    for (const step of steps.slice(2)) {
      const uses = step["uses"];

      if (step === execution) {
        continue;
      }

      if (uses === "actions/checkout@v7") {
        const with_ = map(step["with"]);
        require(keys(step, ["name", "uses", "with"]) &&
          keys(with_, ["ref", "path", "persist-credentials", "fetch-depth", "submodules", "lfs"]) &&
          [cached, uncached].includes(String(with_["ref"])) &&
          ["source-cached", "source-uncached"].includes(String(with_["path"])) &&
          with_["persist-credentials"] === false &&
          with_["fetch-depth"] === 1 &&
          with_["submodules"] === false &&
          with_["lfs"] === false, `L6 ${name}: source checkouts are fixed and credential-free`);
      } else if (uses === "./.github/actions/pnpm") {
        require(keys(step, ["name", "uses"]), `L6 ${name}: the trusted pnpm action stays unchanged`);
      } else if (step["run"] === install || step["run"] === bootstrap) {
        require(keys(step, ["name", "run"]), `L6 ${name}: installation has no caller configuration`);
      } else if (uses === "actions/upload-artifact@v7") {
        const with_ = map(step["with"]);
        const artifact = `l11-exercise-${name}${name === "compare" ? `-${expression("matrix.variant")}` : ""}`;
        require(keys(step, ["name", "uses", "if", "with"]) &&
          compact(step["if"]) === "always()" &&
          keys(with_, ["name", "path", "if-no-files-found"]) &&
          with_["name"] === artifact &&
          with_["path"] === `${expression("runner.temp")}/l11-exercise/public/*.json` &&
          with_["if-no-files-found"] === "error", `L7 ${name}: only sanitized structured reports may be uploaded`);
      } else if (uses === "actions/download-artifact@v8" && name === "collect") {
        require(keys(step, ["name", "uses", "with"]) &&
          sameEntries(
            Object.entries(map(step["with"])),
            Object.entries({ pattern: "l11-exercise-*", path: `${expression("runner.temp")}/l11-exercise/collected` }),
          ), "L7 collect: collect only sanitized reports from this exercise");
      } else {
        require(false, `L6 ${name}: no other action, shell, key or environment is accepted`);
      }
    }

    const setup = steps.slice(2, 7);
    require(setup.length === 5 &&
      setup[0]?.["uses"] === "actions/checkout@v7" &&
      setup[1]?.["uses"] === "actions/checkout@v7" &&
      map(setup[0]?.["with"])["ref"] === cached &&
      map(setup[0]?.["with"])["path"] === "source-cached" &&
      map(setup[1]?.["with"])["ref"] === uncached &&
      map(setup[1]?.["with"])["path"] === "source-uncached" &&
      setup[2]?.["run"] === bootstrap &&
      setup[3]?.["uses"] === "./.github/actions/pnpm" &&
      setup[4]?.["run"] === install &&
      steps.length === (name === "collect" ? 10 : 9) &&
      steps[name === "collect" ? 8 : 7] === execution &&
      (name !== "collect" || steps[7]?.["uses"] === "actions/download-artifact@v8") &&
      steps.at(-1)?.["uses"] ===
        "actions/upload-artifact@v7", `L7 ${name}: exact hashes precede installation and only sanitized reports survive execution`);

    if (index >= 0) {
      require(same(list(job["needs"]), [index === 0 ? "manifest" : slots[index - 1]]) &&
        compact(job["if"]) === "inputs.case=='l11-batch'" &&
        job["strategy"] ===
          undefined, `L8 ${name}: each batch slot follows only its predecessor and never replaces it`);
    } else if (name === "collect") {
      require(compact(job["if"]) === "always()" &&
        same(list(job["needs"]).toSorted(), jobs.filter((job) => job !== "collect").toSorted()) &&
        job["strategy"] === undefined, "L9: collector always retains every declared job, including unstarted slots");
    } else {
      const when =
        name === "output"
          ? "inputs.case!='l11-compare'&&inputs.case!='l11-inputs'&&inputs.case!='l11-batch'"
          : `inputs.case=='l11-${name === "manifest" ? "batch" : name}'`;

      require(compact(job["if"]) === when &&
        job["needs"] === undefined, `L10 ${name}: case routing does not hide a wrong ref`);
      const strategy = map(job["strategy"]);
      const matrix = map(strategy["matrix"]);
      require(name === "compare"
        ? Object.keys(strategy).length === 3 &&
            keys(strategy, ["max-parallel", "fail-fast", "matrix"]) &&
            strategy["max-parallel"] === 1 &&
            strategy["fail-fast"] === false &&
            Object.keys(matrix).join() === "variant" &&
            same(list(matrix["variant"]).toSorted(), ["cached", "uncached"])
        : job["strategy"] === undefined, `L10 ${name}: only the two comparison variants use a serial matrix`);
    }
  }

  return errors;
};
