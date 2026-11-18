// The runner for shared.fixture.ts's suite, as a libfabrika `*.integration.test.ts` runs a `*Test.ts`
// suite: it declares no law of its own. plant.integration.test.ts gives this file to plant.ts.
import * as Shared from "./shared.fixture.ts";

Shared.suite();
