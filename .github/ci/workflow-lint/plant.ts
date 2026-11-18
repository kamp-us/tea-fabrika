// Today's lead tooling. The manual exercise has no variable command or runner policy.
import { parse } from "yaml";
import { isMap, map } from "./shared.ts";

const checkout = { "persist-credentials": false, submodules: false, lfs: false };

const expected = {
  on: {
    workflow_dispatch: {
      inputs: {
        case: {
          description: "Fixed temporary break",
          required: true,
          type: "choice",
          options: [
            "watcher-r1",
            "host-pin",
            "host-discovery-timeout",
            "host-requested-pin",
            "host-pnpm-path",
            "host-env-order",
          ],
        },
        sha: { description: "Exact source commit, forty lowercase hex characters", required: true, type: "string" },
      },
    },
  },
  permissions: { contents: "read" },
  jobs: {
    exercise: {
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 20,
      steps: [
        { name: "trusted main", run: 'test "$GITHUB_REF" = refs/heads/main' },
        { uses: "actions/checkout@v7", with: { ref: `\${{ github.workflow_sha }}`, ...checkout } },
        { uses: "actions/checkout@v7", with: { ref: `\${{ inputs.sha }}`, path: "source", ...checkout } },
        { uses: "./.github/actions/pnpm" },
        {
          name: "install trusted tooling",
          shell: "bash",
          run: "if ! pnpm install --frozen-lockfile > \"$RUNNER_TEMP/plant-install.out\" 2>&1; then\n  echo 'plant-exercise: trusted install failed'\n  exit 1\nfi\n",
        },
        {
          name: "exercise",
          "timeout-minutes": 17,
          run: "nice -n 19 node .github/ci/plant.ts",
        },
        {
          name: "sanitized observations",
          if: "always()",
          uses: "actions/upload-artifact@v7",
          with: {
            name: "plant-exercise",
            path: `\${{ runner.temp }}/plant-exercise/result.json`,
            "if-no-files-found": "error",
          },
        },
      ],
    },
  },
};

// Object key order and YAML spelling do not change the workflow. Array order does.
const same = (left: unknown, right: unknown): boolean => {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((v, i) => same(v, right[i]));
  }

  if (isMap(left) && isMap(right)) {
    return (
      Object.keys(left).length === Object.keys(right).length &&
      Object.entries(right).every(([key, value]) => Object.hasOwn(left, key) && same(left[key], value))
    );
  }

  return left === right;
};

export const lintPlant = (text: string): string[] => {
  try {
    const workflow = map(parse(text));
    const { name, ...body } = workflow;

    return name === "plant-exercise" && same(body, expected)
      ? []
      : [
          "plant.yaml: keep the fixed manual case/SHA workflow, trusted-main checkouts, read-only permissions, caps and sanitized-only upload",
        ];
  } catch {
    return ["plant.yaml: invalid YAML"];
  }
};
