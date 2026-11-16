import {
  loader,
  type Plant,
  rejects,
  step,
  stepsOf,
  tableElsewhere,
  type Timed,
  token,
} from "./wiring.test-support.ts";

// Today's CI, serving both versions. Covers token.ts: the steps that get the token (M1). Each plant
// is given to every generated valid workflow alone (wiring.test-support.ts), so an unrelated error
// cannot mask it.

const plants: Plant[] = [
  // M1: a push the merge queue already tested asks GitHub from changes' classify step alone. The
  // token is the workflow's (F3's plants hold its map), since changes' stop step needs it whole.
  [
    "M1: classify has no token",
    // SAFETY: classify in wiring.test-support.ts is `diff` with an `env` map that adds GITHUB_TOKEN.
    (w) => delete (step(w, "changes", "classify").env as Record<string, string>)["GITHUB_TOKEN"],
  ],
  [
    "M1: classify takes the token from secrets",
    // SAFETY: this plant writes GITHUB_TOKEN into classify's `env`, which `valid` writes as a string map.
    (w) =>
      ((step(w, "changes", "classify").env as Record<string, string>)["GITHUB_TOKEN"] = `\${{ secrets.GITHUB_TOKEN }}`),
  ],
  [
    "M1: the parser's pass gets the token too",
    // SAFETY: the parser pass step spreads `diff`, so it has `diff`'s `env` map of strings.
    (w) => ((step(w, "changes", "parser pass").env as Record<string, string>)["GITHUB_TOKEN"] = token),
  ],
  [
    "M1: the row check gets the token too",
    // SAFETY: check's field rows step in `valid` takes the shared `env` map.
    (w) => ((step(w, "check", "field rows").env as Record<string, string>)["GITHUB_TOKEN"] = token),
  ],
  // M1: the time table's exact step, in a test job, is the one test step that gets the token. The
  // same command elsewhere, or with one more variable, does not. The typecheck plant passed the M1
  // that let any step whose command is the time table's have the token.
  ["M1: shard times gets the token too", (w) => (step(w, "next", "shard times").env = { GITHUB_TOKEN: token })],
  [
    "M1: typecheck runs the time table's command with the token and a loader beside it",
    (w) => stepsOf(w, "typecheck").splice(-1, 0, tableElsewhere()),
  ],
  [
    "M1: next's time table carries a loader beside the token",
    // SAFETY: `valid` puts a step named "time table" in next, written in the `Timed` shape with an `env` map.
    (w) => ((stepsOf(w, "next").find((s) => s["name"] === "time table") as Timed).env!["NODE_OPTIONS"] = loader),
  ],
];

rejects(plants);
