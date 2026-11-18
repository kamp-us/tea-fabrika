// next/ only. Electron and its temporary home belong to the caller's scope.
// oxlint-disable-next-line fabrika/no-node-imports -- edge: Electron publishes its executable through CommonJS, which Effect does not resolve
import { createRequire } from "node:module";
import { Effect, FileSystem, Path, Schema } from "effect";
// oxlint-disable-next-line no-restricted-imports -- edge: A3 gives next/ its own quiet Electron test launcher
import { _electron, type ElectronApplication, type Page } from "playwright";

class WindowFailed extends Schema.TaggedError<WindowFailed, { readonly brand: unique symbol }>()("WindowFailed", {
  cause: Schema.Defect(),
}) {}

export interface TestWindow {
  readonly app: ElectronApplication;
  readonly page: Page;
  readonly home: string;
}

// Loaded before the app creates a window, including any later windows.
const quiet = `
const {app, screen} = require("electron");
app.on("browser-window-created", (_event, window) => {
  window.setOpacity(0);
  window.setIgnoreMouseEvents(true);
  const place = () => {
    const area = screen.getPrimaryDisplay().workArea;
    const bounds = window.getBounds();
    window.setPosition(area.x + Math.max(0, area.width - bounds.width), area.y);
  };
  place();
  window.on("resize", place);
});
`;

export const launch = Effect.fn("testWindow.launch")(function* (options: {
  readonly instance: string;
  readonly label: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* fs.makeTempDirectoryScoped({ directory: "/tmp", prefix: "fh." });
  const guard = path.join(home, "quiet.cjs");
  yield* fs.writeFileString(guard, quiet);
  const entry = path.resolve(import.meta.dirname, "electron/main.ts");
  // Fail on P28's missing window before trying to launch Electron in a box.
  yield* fs.access(entry);

  const env = {
    PATH: process.env.PATH ?? "",
    TMPDIR: home,
    HOME: home,
    FABRIKA_HOME: home,
    FABRIKA_TEST_INSTANCE: options.instance,
    FABRIKA_TEST_PERSON_CHECK: "touch",
    FABRIKA_TEST_DEVICE_LABEL: options.label,
  };

  const executablePath: string = createRequire(import.meta.url)("electron");

  const options = { executablePath, args: ["-r", guard, entry], env };
  const fail = (cause: unknown) => new WindowFailed({ cause });

  const app = yield* Effect.acquireRelease(
    // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright launches Electron through a Promise API
    Effect.tryPromise({ try: () => _electron.launch(options), catch: fail }),
    (app) =>
      // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright closes the Electron process through a Promise API
      Effect.tryPromise({ try: () => app.close(), catch: fail }).pipe(Effect.orDie),
  );

  // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright returns its first renderer through a Promise API
  const page = yield* Effect.tryPromise({ try: () => app.firstWindow(), catch: fail });

  return { app, page, home } satisfies TestWindow;
});
