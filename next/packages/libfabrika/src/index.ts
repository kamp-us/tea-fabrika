// The new fabrika's library, its app layer (Tier 1, P11): programs, their saved state, view
// patches and the runner that steps a process. Browser-safe: it reaches no platform.
export * as Id from "./Id.ts";
export { IdError, type IdSchema, type IdValue } from "./Id.ts";
/**
 * @stability unstable
 */
export * as Chaos from "./runtime/Chaos.ts";
/**
 * Saved bounded experiments and their command definitions.
 * @stability unstable
 */
export * as ChaosMachine from "./runtime/ChaosMachine.ts";
/**
 * @stability unstable
 */
export * as Nemesis from "./runtime/Nemesis.ts";
/**
 * @stability unstable
 */
export * as NemesisLedger from "./runtime/NemesisLedger.ts";
/**
 * @stability unstable
 */
export * as NemesisNone from "./runtime/NemesisNone.ts";
/**
 * @stability unstable
 */
export * as ProcessHistory from "./processes/ProcessHistory.ts";
/**
 * @stability unstable
 */
export * as ProcessHistoryLedger from "./processes/ProcessHistoryLedger.ts";
export {
  Alarm,
  CheckedWriter,
  type Handler,
  Incoming,
  type Loaded,
  ProgramLoader,
  Recording,
  type Update,
  type View,
  WatcherManager,
} from "./runtime/Entry.ts";
export { apply, diff, type Patch } from "./runtime/Patch.ts";
export * as ProgramClient from "./runtime/Client.ts";
export { clientMachineFor } from "./runtime/Client.ts";
export {
  type Binding,
  EventPolicy,
  Input,
  Program,
  ProgramDown,
  Refusal,
  State,
  Step,
  type Stepper,
  stepper,
  Write,
} from "./runtime/Program.ts";
export { type Descriptor, type Opened, ProgramRunner, RunnerError, Sent } from "./runtime/Runner.ts";
export { Saved } from "./runtime/State.ts";
export {
  Declaration,
  type Execution,
  type ExecutionCalls,
  nodeExecution,
  workerExecution,
} from "./runtime/Execution.ts";
export { Gateway, type ConnectionId } from "./gateway/Gateway.ts";
/**
 * @stability unstable
 */
export * as SettingsStart from "./settings/Start.ts";
export { RecordedStart } from "./settings/RecordedStart.ts";
export { ProgramName } from "./packs/ProgramName.ts";
/**
 * @stability unstable
 */
export * as SettingsStarts from "./settings/Starts.ts";
// A program window's typed contract, and the rows a client records (P14).
export {
  commandMsg,
  defineWindow,
  type AnyTile,
  type TileProps,
  type WindowData,
  type WindowMsg,
  type WindowProps,
  type WindowRegistration,
} from "./runtime/Window.ts";
export { ClientRecord, ClientRow } from "./transport/ClientRows.ts";
/**
 * @stability unstable
 */
export * as Ci from "./ci/Ci.ts";
/**
 * @stability unstable
 */
export * as CodeHost from "./codehost/CodeHost.ts";
/**
 * @stability unstable
 */
export * as Send from "./runtime/Send.ts";
/**
 * @stability unstable
 */
export * as StartChild from "./runtime/StartChild.ts";
/**
 * @stability unstable
 */
export * as Programs from "./runtime/Programs.ts";
export { Started } from "./processes/Children.ts";
/**
 * Schema for a registered process name, the whereis key a start registers its child under.
 *
 * @stability unstable
 * @category schemas
 */
export { ProcessName } from "./processes/Process.ts";
/**
 * @stability unstable
 */
export * as Setting from "./settings/Setting.ts";
// tezgah's wire contract: its view's shapes and the layout's geometry, pure and browser-safe. A
// program's box reaches them here; a window may also take each by its own subpath.
/**
 * tezgah's view: workspaces, tiles and their ids, and the names of tezgah's processes.
 * @stability unstable
 */
export * as Workspace from "./tezgah/Workspace.ts";
/**
 * The layout's pure functions: its tile order, a split, a remove, the rects and the check.
 * @stability unstable
 */
export * as Layout from "./tezgah/Layout.ts";
