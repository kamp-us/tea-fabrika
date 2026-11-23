// V1 and R1: what the package reads from `@octokit/openapi-types` 29.0.1 about itself. V1 holds `GitHub.apiVersion` to the
// REST API date the types describe, and R1 holds the list of routes whose answer is checked at run time only. They are
// checked by the compiler (`tsc`, and the root `typecheck`), not by a test run. The package records no date, so V1 reads
// the date from three changes GitHub's version 2026-03-10 made (the dispatch's 204 and `return_run_details`, and the
// pull request's `merge_commit_sha`), and these laws build `paths` shapes with each change made or not.
import { expectTypeOf, it } from "@effect/vitest";
import type { paths } from "@octokit/openapi-types";
import * as GitHub from "./GitHub.ts";
import type * as Check from "./internal/Check.ts";
import type { RUN_TIME_ONLY } from "./Octokit.test-support.ts";

type DispatchPath = "/repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches";

type PullPath = "/repos/{owner}/{repo}/pulls/{pull_number}";

type RealDispatch = paths[DispatchPath]["post"];

type RealPull = paths[PullPath]["get"];

type DispatchBody = RealDispatch["requestBody"]["content"]["application/json"];

type PullAnswer = RealPull["responses"][200]["content"]["application/json"];

/** The dispatch route with `return_run_details` and its 204 kept (`true`) or removed (`false`). */
type Dispatch<Details extends boolean, Empty extends boolean> = {
  readonly parameters: RealDispatch["parameters"];
  readonly requestBody: {
    readonly content: {
      readonly "application/json": Details extends true ? DispatchBody : Omit<DispatchBody, "return_run_details">;
    };
  };
  readonly responses: Empty extends true ? RealDispatch["responses"] : Omit<RealDispatch["responses"], 204>;
};

/** The pull request route with `merge_commit_sha` kept (`true`) or removed (`false`). */
type Pull<Merge extends boolean> = {
  readonly parameters: RealPull["parameters"];
  readonly responses: {
    readonly 200: {
      readonly content: {
        readonly "application/json": Merge extends true ? PullAnswer : Omit<PullAnswer, "merge_commit_sha">;
      };
    };
  };
};

/** A small `paths` shape holding the three changes, each made (`false`) or not (`true`). */
type Shape<Details extends boolean, Empty extends boolean, Merge extends boolean> = {
  readonly [P in DispatchPath]: { readonly post: Dispatch<Details, Empty> };
} & { readonly [P in PullPath]: { readonly get: Pull<Merge> } };

// V1. Plant: write `ApiVersion = "2022-11-28"` instead of reading it, and the `2026-03-10` line fails; type `apiVersion`
// as `string`, and its `toEqualTypeOf` line fails.
const apiDate = () => {
  expectTypeOf(GitHub.apiVersion).toEqualTypeOf<Check.ApiVersion>();
  expectTypeOf<Check.ApiVersion>().toEqualTypeOf<"2022-11-28">();
  expectTypeOf<Check.DescribedVersion<paths>>().toEqualTypeOf<"2022-11-28">();

  // The shape with none of the three changes made is 2022-11-28, with all three made it is 2026-03-10.
  expectTypeOf<Check.DescribedVersion<Shape<true, true, true>>>().toEqualTypeOf<"2022-11-28">();
  expectTypeOf<Check.DescribedVersion<Shape<false, false, false>>>().toEqualTypeOf<"2026-03-10">();

  // A shape that moved only part of the way is neither date.
  expectTypeOf<Check.DescribedVersion<Shape<false, true, true>>>().toEqualTypeOf<never>();
  expectTypeOf<Check.DescribedVersion<Shape<true, false, true>>>().toEqualTypeOf<never>();
  expectTypeOf<Check.DescribedVersion<Shape<true, true, false>>>().toEqualTypeOf<never>();
  expectTypeOf<Check.DescribedVersion<Shape<false, false, true>>>().toEqualTypeOf<never>();
  expectTypeOf<Check.DescribedVersion<Shape<false, true, false>>>().toEqualTypeOf<never>();
  expectTypeOf<Check.DescribedVersion<Shape<true, false, false>>>().toEqualTypeOf<never>();

  // A `paths` that lacks one of the two routes cannot say which date it describes, whatever the other holds. Plant: read
  // a route that is not there as a change that was kept, and `{}` reads as 2022-11-28.
  expectTypeOf<Check.DescribedVersion<Record<never, never>>>().toEqualTypeOf<never>();
  expectTypeOf<Check.DescribedVersion<Pick<Shape<true, true, true>, PullPath>>>().toEqualTypeOf<never>();
  expectTypeOf<Check.DescribedVersion<Pick<Shape<false, false, false>, PullPath>>>().toEqualTypeOf<never>();
  expectTypeOf<Check.DescribedVersion<Pick<Shape<true, true, true>, DispatchPath>>>().toEqualTypeOf<never>();
  expectTypeOf<Check.DescribedVersion<Pick<Shape<false, false, false>, DispatchPath>>>().toEqualTypeOf<never>();

  // The date is the types' alone: the compiler refuses another value for it.
  // @ts-expect-error the types describe 2022-11-28
  const moved: Check.ApiVersion = "2026-03-10";

  expectTypeOf(moved).toBeString();
};

// R1. Plant: count a `Record<string, never>` answer as open, and the union gains `DELETE /orgs/{org}`; leave out routes
// with no 2xx, and the `logs` routes are missing.
const runTimeOnly = () => {
  expectTypeOf<Check.RunTimeOnly>().toEqualTypeOf<(typeof RUN_TIME_ONLY)[number]>();
};

it("V1 type: apiVersion is the date the pinned types describe, read from three changes in them", () => {
  // These compile-time laws need tsc, which the lead runs after the build.
  expectTypeOf(apiDate).toBeFunction();
});

it("R1 type: the routes checked only at run time are the 17 the types give", () => {
  // These compile-time laws need tsc, which the lead runs after the build.
  expectTypeOf(runTimeOnly).toBeFunction();
});
