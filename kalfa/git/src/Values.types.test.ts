// T1: the brands. Compile the exact bad expressions, never execute them.
import { expectTypeOf, it } from "@effect/vitest";
import type * as CommitId from "./CommitId.ts";
import type * as Diff from "./Diff.ts";
import type * as Ref from "./Ref.ts";
import type * as Tree from "./Tree.ts";

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

// Plant: give `BlobId` the brand `@kalfa/git/TreeId`, so the `@ts-expect-error` lines below go unused.
const treeBrands = (text: string, tree: Tree.TreeId, blob: Tree.BlobId, commit: CommitId.CommitId, path: Tree.Path) => {
  // @ts-expect-error A plain string is not a tree id.
  const treeFromText: Tree.TreeId = text;
  // @ts-expect-error A plain string is not a blob id.
  const blobFromText: Tree.BlobId = text;
  // @ts-expect-error A plain string is not a path.
  const pathFromText: Tree.Path = text;
  // @ts-expect-error A blob id is not a tree id.
  const treeFromBlob: Tree.TreeId = blob;
  // @ts-expect-error A tree id is not a blob id.
  const blobFromTree: Tree.BlobId = tree;
  // @ts-expect-error A commit id is not a tree id.
  const treeFromCommit: Tree.TreeId = commit;
  // @ts-expect-error A tree id is not a commit id.
  const commitFromTree: CommitId.CommitId = tree;
  // @ts-expect-error A blob id is not a commit id.
  const commitFromBlob: CommitId.CommitId = blob;
  // @ts-expect-error A path is not a tree id.
  const treeFromPath: Tree.TreeId = path;
  // @ts-expect-error A tree id is not a path.
  const pathFromTree: Tree.Path = tree;
  expectTypeOf<Tree.TreeId>().toExtend<string>();
  expectTypeOf<Tree.BlobId>().toExtend<string>();
  expectTypeOf<Tree.Path>().toExtend<string>();
  expectTypeOf<Tree.TreeId>().not.toEqualTypeOf<Tree.BlobId>();
  expectTypeOf<Tree.TreeId>().not.toEqualTypeOf<CommitId.CommitId>();

  return [
    treeFromText,
    blobFromText,
    pathFromText,
    treeFromBlob,
    blobFromTree,
    treeFromCommit,
    commitFromTree,
    commitFromBlob,
    treeFromPath,
    pathFromTree,
  ];
};

it("type: a plain string is no TreeId, BlobId or Path, and a TreeId, a BlobId and a CommitId are none of each other", () => {
  // These compile-time laws need tsc, which the lead runs after build.
  expectTypeOf(treeBrands).toBeFunction();
});

// Plant: drop the brand on `PatchId`, so the `@ts-expect-error` lines below go unused.
const patchBrands = (
  text: string,
  patch: Diff.PatchId,
  commit: CommitId.CommitId,
  tree: Tree.TreeId,
  blob: Tree.BlobId,
) => {
  // @ts-expect-error A plain string is not a patch id.
  const patchFromText: Diff.PatchId = text;
  // @ts-expect-error A commit id is not a patch id.
  const patchFromCommit: Diff.PatchId = commit;
  // @ts-expect-error A tree id is not a patch id.
  const patchFromTree: Diff.PatchId = tree;
  // @ts-expect-error A blob id is not a patch id.
  const patchFromBlob: Diff.PatchId = blob;
  // @ts-expect-error A patch id is not a commit id.
  const commitFromPatch: CommitId.CommitId = patch;
  // @ts-expect-error A patch id is not a tree id.
  const treeFromPatch: Tree.TreeId = patch;
  // @ts-expect-error A patch id is not a blob id.
  const blobFromPatch: Tree.BlobId = patch;
  expectTypeOf<Diff.PatchId>().toExtend<string>();
  expectTypeOf<Diff.PatchId>().not.toEqualTypeOf<string>();
  expectTypeOf<Diff.PatchId>().not.toEqualTypeOf<CommitId.CommitId>();

  return [patchFromText, patchFromCommit, patchFromTree, patchFromBlob, commitFromPatch, treeFromPatch, blobFromPatch];
};

it("type: a plain string, a CommitId, a TreeId and a BlobId are no PatchId, and a PatchId is none of them", () => {
  // These compile-time laws need tsc, which the lead runs after build.
  expectTypeOf(patchBrands).toBeFunction();
});
