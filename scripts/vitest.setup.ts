// Today's tooling. Every test file gets fresh homes without reading inherited paths.
import { tmpdir } from "node:os";
import { Arbitrary } from "effect";
import * as fc from "fast-check";
import { testHomes } from "./testhome.ts";

testHomes(process.env, tmpdir());

const seed = 119120;
fc.configureGlobal({ seed });
Arbitrary.configureGlobal({ check: { seed } });
