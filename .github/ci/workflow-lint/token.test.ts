import * as Arr from "effect/Array";
import * as Option from "effect/Option";
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
    (w) => delete (step(w, "changes", "classify").env as Record<string, string>)["GITHUB_TOKEN"],
  ],
  [
    "M1: classify takes the token from secrets",
    (w) =>
      ((step(w, "changes", "classify").env as Record<string, string>)["GITHUB_TOKEN"] = `\${{ secrets.GITHUB_TOKEN }}`),
  ],
  [
    "M1: the parser's pass gets the token too",
    (w) => ((step(w, "changes", "parser pass").env as Record<string, string>)["GITHUB_TOKEN"] = token),
  ],
  [
    "M1: the row check gets the token too",
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
    (w) =>
      ((Option.getOrUndefined(Arr.findFirst(stepsOf(w, "next"), (s) => s["name"] === "time table")) as Timed).env![
        "NODE_OPTIONS"
      ] = loader),
  ],
];

rejects(plants);
