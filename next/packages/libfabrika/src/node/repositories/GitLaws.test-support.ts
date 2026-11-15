// The git layers a git-backed law runs on (0535). A law is written once as a function of these
// services: memory git at every depth, and real git too at depth `full`, on the 3-hour schedule, so
// the memory layer is held to real git by the same laws. A law that only real git can prove reads
// `realOnly` and runs on the schedule alone.
import { NodeServices } from "@effect/platform-node";
import { Layer } from "effect";
import { Digest } from "effect/crypto";
import { depth } from "../../Testing.test-support.ts";
import * as Git from "./Git.ts";

const platform = Layer.mergeAll(NodeServices.layer, Digest.layerWebCrypto);
// The memory spawner sits over the platform's, which still runs every command that is not git.
const memory = Layer.merge(platform, Git.layerMemory.pipe(Layer.provide(platform)));

/** The platform's services with git in memory, and with real git only at depth `full`. */
export const gits = [
  { name: "memory", services: memory },
  ...(depth === "full" ? [{ name: "real", services: platform }] : []),
];

/** True at depth `full` only: a law that needs real git itself runs then, on the schedule. */
export const realOnly = depth === "full";
