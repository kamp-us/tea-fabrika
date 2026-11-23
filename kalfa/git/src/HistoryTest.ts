// The history a law runs on, exported as `/test/History`: what a runner of `RepositoryTest.suite` needs to seed its own
// kind of store. The generators and the model the laws compare with are this package's own, in History.test-support.ts.
export type { History, Node } from "./History.test-support.ts";

export { shapes, textureArb } from "./History.test-support.ts";
