/**
 * The Effect lint rules, as one oxlint plugin named `@kalfa/quality`, so a rule reads `@kalfa/quality/<rule>` in a config
 * and a disable comment, and its code prints as `@kalfa/quality(<rule>)`. A repo loads it with
 * `"jsPlugins": ["@kalfa/quality/oxlint"]`.
 */
import type { Plugin } from "@oxlint/plugins";
import { effectFunctions } from "./effect-functions.ts";
import { noCauseSquash } from "./no-cause-squash.ts";
import { noContextTag } from "./no-context-tag.ts";
import { noDataTaggederror } from "./no-data-taggederror.ts";
import { noEffectPromise } from "./no-effect-promise.ts";
import { noEffectRunOutsideEdge } from "./no-effect-run-outside-edge.ts";
import { noHandTag } from "./no-hand-tag.ts";
import { noPromises } from "./no-promises.ts";
import { noRawTryCatch } from "./no-raw-try-catch.ts";
import { noThrowInEffectGen } from "./no-throw-in-effect-gen.ts";
import { noTypeAssertions } from "./no-type-assertions.ts";

/**
 * The plugin an oxlint config loads: eleven rules that keep Effect code Effect all the way.
 *
 * @category plugin
 */
const plugin: Plugin = {
  meta: { name: "@kalfa/quality" },
  rules: {
    "effect-functions": effectFunctions,
    "no-cause-squash": noCauseSquash,
    "no-context-tag": noContextTag,
    "no-data-taggederror": noDataTaggederror,
    "no-effect-promise": noEffectPromise,
    "no-effect-run-outside-edge": noEffectRunOutsideEdge,
    "no-hand-tag": noHandTag,
    "no-promises": noPromises,
    "no-raw-try-catch": noRawTryCatch,
    "no-throw-in-effect-gen": noThrowInEffectGen,
    "no-type-assertions": noTypeAssertions,
  },
};

export default plugin;
