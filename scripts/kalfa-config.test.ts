// T1076 P1. Plant: break the public App export or retain a fabrika-only env prefix.
import { expect, it } from "@effect/vitest";
import * as App from "@kalfa/config/App";
import * as Load from "@kalfa/config/Load";
import * as TomlParser from "@kalfa/config/TomlParser";
import { runsFor } from "@kampus/vitest";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import { Digest } from "effect/crypto";

const Port = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }));

const ConsumerCase = Schema.Struct({
  name: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9]{3,7}$/u)),
  value: Port,
  default: Port,
});

it.effect.prop(
  "P1 root tooling resolves declared values and own-app origins through public package imports",
  { input: ConsumerCase },
  ({ input }) =>
    Effect.gen(function* () {
      const app = App.make({ name: input.name, list: `${input.name} config get` });

      const port = app.Setting.make("service.port", {
        schema: Port,
        default: input.default,
        scope: ["repo", "person"],
        reload: "restart",
        since: "0.0.0",
        doc: "The service port.",
      });

      const group = app.Setting.group({ port });

      const foreign = input.name === "fabrika" ? "KALFA_SERVICE_PORT" : "FABRIKA_SERVICE_PORT";

      const layers = Layer.mergeAll(
        FileSystem.layerNoop({ readFileString: () => Effect.succeed("") }),
        Path.layer,
        TomlParser.layer,
        Digest.layerWebCrypto,
      );

      const reached = new Set<string>();

      for (const own of [false, true]) {
        const loaded = yield* Load.load(group, {
          repo: "/work",
          home: "/people/one",
          flags: {},
          env: { [foreign]: "65535", ...(own ? { [port.env]: String(input.value) } : {}) },
          version: "1.2.3",
        }).pipe(Effect.provide(layers));

        reached.add(own ? "env" : "default");

        expect(loaded.values.port).toBe(own ? input.value : input.default);

        expect(loaded.snapshot.values[port.path]).toBe(own ? input.value : input.default);

        expect(loaded.snapshot.origins[port.path]).toEqual(
          own ? { _tag: "env", name: `${input.name.toUpperCase()}_SERVICE_PORT` } : { _tag: "default" },
        );
      }

      expect([...reached].sort()).toEqual(["default", "env"]);
    }),
  { arbitrary: { runs: runsFor({ fast: 25, full: 100 }), size: 100 } },
);
