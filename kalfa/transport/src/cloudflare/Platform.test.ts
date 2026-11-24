// M1 to M5: the platform's rules the gateway is built on, run on the stand-in (`@kalfa/transport/cloudflare/memory`), which every
// pull request runs. The same suite runs on real workerd in `PlatformLaws.integration.test.ts`, so the stand-in keeps what the platform
// does. Each law runs on a world of its own, a fresh stand-in holding the raw gateway of `PlatformLaws.test-support.ts`. A law that waits
// for a reply runs on the real clock (`it.live`), so a reply that never comes fails after a short wait instead of never ending.
import { it } from "@effect/vitest";
import { memoryWorld, platformLaws } from "./PlatformLaws.test-support.ts";

platformLaws(it.live, memoryWorld, { runs: 300, draws: 1, concurrency: 1 });
