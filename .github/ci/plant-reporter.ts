// Today's lead tooling. Vitest's JSON failureMessages omit Error.cause; metadata keeps the closed witness.
import { Record } from "effect";
import { JsonReporter, type TestModule } from "vitest/node";
import { cases } from "./plant-cases.ts";
import { failure } from "./plant-errors.ts";

export default class PlantReporter extends JsonReporter {
  constructor() {
    super({});
  }

  override onTestRunEnd(modules: readonly TestModule[]) {
    for (const module of modules) {
      for (const test of module.children.allTests()) {
        const names = [test.name];
        let parent = test.parent;

        while (parent.type !== "module") {
          names.unshift(parent.name);
          parent = parent.parent;
        }

        const key = Record.keys(cases).find(
          (key) => module.moduleId.endsWith(`/${cases[key].test}`) && names.join(" ") === cases[key].title,
        );

        test.meta().plant = key === undefined ? null : failure(key, test.result().errors ?? []);
      }
    }

    return super.onTestRunEnd(modules);
  }
}
