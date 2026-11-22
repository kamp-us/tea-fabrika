// T1: the brands. Compile the exact bad expressions, never execute them.
import { expectTypeOf, it } from "@effect/vitest";
import type * as CommitId from "./CommitId.ts";
import type * as Ref from "./Ref.ts";

// Plant: drop the brand on `BranchName`, so the `@ts-expect-error` lines below go unused.
const brands = (text: string, id: CommitId.CommitId, ref: Ref.RefName, branch: Ref.BranchName) => {
  // @ts-expect-error A plain string is not a commit id.
  const fromText: CommitId.CommitId = text;
  // @ts-expect-error A plain string is not a ref name.
  const refFromText: Ref.RefName = text;
  // @ts-expect-error A plain string is not a branch name.
  const branchFromText: Ref.BranchName = text;
  // @ts-expect-error A branch name is not a ref name: one lacks refs/heads/.
  const refFromBranch: Ref.RefName = branch;
  // @ts-expect-error A ref name is not a branch name.
  const branchFromRef: Ref.BranchName = ref;
  // @ts-expect-error A commit id names no ref.
  const refFromId: Ref.RefName = id;
  expectTypeOf<CommitId.CommitId>().toExtend<string>();
  expectTypeOf<Ref.RefName>().toExtend<string>();
  expectTypeOf<Ref.BranchName>().toExtend<string>();
  expectTypeOf<CommitId.CommitId>().not.toEqualTypeOf<string>();
  expectTypeOf<Ref.RefName>().not.toEqualTypeOf<Ref.BranchName>();

  return [fromText, refFromText, branchFromText, refFromBranch, branchFromRef, refFromId];
};

it("type: a plain string is not a CommitId, a RefName or a BranchName, and a BranchName is not a RefName", () => {
  // These compile-time laws need tsc, which the lead runs after build.
  expectTypeOf(brands).toBeFunction();
});
