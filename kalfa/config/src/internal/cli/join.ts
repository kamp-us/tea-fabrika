/**
 * The settings of every group of one app, read as one group by the `config` command, so a file shared by many packages is checked against all of them.
 */
import type * as Setting from "../../Declaration.ts";
import type { Group } from "../check.ts";
import { clashes, refusedApp } from "../names.ts";
import { watched } from "../window.ts";

/** Why the groups cannot be read together, or undefined when they can. */
const refusal = (app: string, groups: ReadonlyArray<Group>, settings: ReadonlyArray<Setting.Any>) => {
  const unnamed = refusedApp(app);

  if (unnamed !== undefined) {
    return unnamed;
  }

  const other = groups.find((group) => group.app !== app);

  if (other !== undefined) {
    return `a group of ${other.app} cannot be read with the settings of ${app}`;
  }

  for (const [n, setting] of settings.entries()) {
    for (const next of settings.slice(n + 1)) {
      // A field that two groups share is fine: each group yields its own, so only a name, a table and a variable clash.
      const clash = clashes(app, setting, next, false);

      if (clash !== undefined) {
        return `${setting.name} and ${next.name} ${clash}`;
      }
    }
  }

  return undefined;
};

/**
 * Joins the groups of `app` into one group with the quiet window added once. A setting two groups share is kept once, by the object. Throws an `Error` for a name that is not an app's, a group of another app, and two settings that are one name, a value and its table, or one variable.
 */
export const join = (app: string, groups: ReadonlyArray<Group>): Group => {
  const settings = watched([...new Set(groups.flatMap((group) => group.settings))]);
  const refused = refusal(app, groups, settings);

  if (refused !== undefined) {
    throw new Error(`Settings cannot be declared: ${refused}.`);
  }

  return { app, settings };
};
