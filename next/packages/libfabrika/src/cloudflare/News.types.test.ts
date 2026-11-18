// Ticket 1053 slice 1, next/: L4 of the plan (docs/plan/quests/t1053-PLAN.md), written before the
// build. In the cloud files every hop that carries what a socket is told takes `News`, and every hop
// that carries a view update on its way to a client takes `Published`. None names it `unknown`. The
// type checker reads the law; Vitest does not typecheck, so the lead and CI run it with
// `pnpm typecheck`.
// Plant: put `unknown` back on any one of them.
import { expectTypeOf, it } from "@effect/vitest";
import type { News, Published } from "../runtime/News.ts";
import type { ConnectionBinding, ProjectBinding } from "./bindings.ts";
import type { ConnectionService } from "./connection.ts";
import type { ConnectionShape } from "./objects.ts";
import type { GatewayClient } from "./platform.ts";
import type * as Publish from "./Publish.ts";
import type { ProjectDoorOptions, ProjectService } from "./runtime.ts";

/** The send function `Publish.make` is given, and the two fronts it gives back. */
type Send = Parameters<typeof Publish.make>[1];

type Fronts = ReturnType<typeof Publish.make>;

it("type: L4 every cloud hop's news parameter is News and every hop's update parameter is Published", () => {
  // The Connection object: its contract, its binding, its service and its client.
  expectTypeOf<Parameters<ConnectionShape["notify"]>>().toEqualTypeOf<[client: string, news: News]>();
  expectTypeOf<Parameters<ConnectionBinding["notify"]>>().toEqualTypeOf<[client: string, news: News]>();
  expectTypeOf<Parameters<ConnectionService["Service"]["notify"]>>().toEqualTypeOf<[client: string, news: News]>();
  expectTypeOf<Parameters<GatewayClient["Service"]["notify"]>>().toEqualTypeOf<[client: string, news: News]>();

  // The Project: what its door is given, the route lookup, its binding and its service.
  expectTypeOf<Parameters<ProjectDoorOptions["notify"]>>().toEqualTypeOf<[client: string, news: News]>();
  expectTypeOf<Parameters<Send>>().toEqualTypeOf<[connection: string, client: string, news: News]>();
  expectTypeOf<Parameters<Fronts["notify"]>>().toEqualTypeOf<[client: string, news: News]>();
  expectTypeOf<Parameters<Fronts["publish"]>>().toEqualTypeOf<[client: string, update: Published]>();
  expectTypeOf<Parameters<ProjectBinding["publish"]>>().toEqualTypeOf<[client: string, update: Published]>();
  expectTypeOf<Parameters<ProjectService["Service"]["publish"]>>().toEqualTypeOf<[client: string, update: Published]>();
});
