// Today's tooling. Every test file gets fresh homes without reading inherited paths.
import { tmpdir } from "node:os";
import { Arbitrary } from "effect";
import fc from "fast-check";
import { testHomes } from "./testhome.ts";

testHomes(process.env, tmpdir());

// One reproducible seed for both property engines (0579), never set inside a law.
fc.configureGlobal({ seed: 119120 });
Arbitrary.configureGlobal({ check: { seed: 119120 }, sample: { seed: 119120 } });
