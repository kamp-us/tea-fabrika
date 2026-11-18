// Today's lead tooling. Vitest's JSON failureMessages omit Error.cause; metadata keeps the closed witness.
import { Option, Schema } from "effect";
import { JsonReporter, type TestModule } from "vitest/node";
import { cases, Request } from "./plant-cases.ts";
import { failure, issue } from "./plant-errors.ts";

export default class PlantReporter extends JsonReporter {
  private readonly selected: Option.Option<Request["case"]>;

  constructor(options: { readonly case?: unknown } = {}) {
    super({});
    this.selected = Schema.decodeUnknownOption(Request.fields.case)(
      Object.hasOwn(options, "case") ? options.case : process.env.PLANT_CASE,
    );
  }

  failure(file: string, title: string, errors: readonly unknown[]) {
    if (Option.isNone(this.selected)) {
      return null;
    }

    const key = this.selected.value;
    const selected = cases[key];

    return file.endsWith(`/${selected.test}`) && title === selected.title ? failure(key, errors) : null;
  }

  override onTestRunEnd(modules: readonly TestModule[], unhandled: readonly unknown[] = []) {
    for (const module of modules) {
      for (const test of module.children.allTests()) {
        const names = [test.name];
        let parent = test.parent;

        while (parent.type !== "module") {
          names.unshift(parent.name);
          parent = parent.parent;
        }

        const errors = test.result().errors ?? [];
        const key = Option.getOrNull(this.selected);
        const selected = key === null ? null : cases[key];

        const target =
          selected !== null && module.moduleId.endsWith(`/${selected.test}`) && names.join(" ") === selected.title;

        Object.assign(test.meta(), {
          plant: this.failure(module.moduleId, names.join(" "), errors),
          ...(target && key !== null
            ? {
                plantErrors: errors.map((error) => issue(key, error)),
                plantUnhandled: unhandled.map((error) => issue(key, error)),
              }
            : {}),
        });
      }
    }

    return super.onTestRunEnd(modules);
  }
}
