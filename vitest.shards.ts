import { relative } from "node:path";
import { BaseSequencer, type TestSpecification } from "vitest/node";

// How `--shard k/n` splits the test files over the check's machines: each machine gets about the
// same seconds, not the same count of files. vitest's own split gives each the same count, so two
// five-minute files can land on one machine while another runs only one-second files.

const E2E = "next/apps/fabrika/e2e";

/**
 * Seconds per file from the repo root: medians of the test-file times in CI runs
 * 42579837468, 42573088027 and 42571265116, rounded to one decimal.
 * The refreshed rows use main runs 42803733957, 42807559589
 * and 42801440878. box, boxrm, loosening and program-package-layout come from PR 757's check
 * run 42874119130, attempts 5 to 14 (a median of 10).
 * stepcommit, redact and gc use CI runs 42631962689, 42631256491 and 42630840277.
 * next/ rows use attempt 1 of green runs 43544589151 (push to main), 43551626086 (merge queue
 * group) and 43556494864 (push to main), rounded to one decimal: the median of the three samples,
 * or the larger of those in hand when a run did not hold the file. The samples and their jobs are
 * in vitest.shards.test.ts. The 8 end-to-end rows (next/apps/fabrika/e2e and the tuval key law) use
 * attempt 1 of runs 43601966383 (job 132468657925), 43601964962 (job 132468687674) and 43605298688
 * (job 132478645693), the median of the three, from Vitest's printed Duration per file.
 * A file with no row is placed by the fallback at the median measured time; CI's `shard-times`
 * step prints its real seconds for a later row.
 */
export const measured: Record<string, number> = {
  ".agents/skills/lead/scripts/box.test.ts": 348.7,
  ".agents/skills/lead/scripts/gc.test.ts": 0.1,
  ".agents/skills/lead/scripts/redact.test.ts": 7.2,
  ".agents/skills/lead/scripts/skillscheck.test.ts": 25.9,
  ".agents/skills/mutation/scripts/run.test.ts": 5.8,
  ".agents/skills/mutation/scripts/sample.test.ts": 0.5,
  ".agents/skills/plan/scripts/plancheck.test.ts": 106.2,
  ".agents/skills/step-commit/scripts/stepcommit.test.ts": 18.2,
  [`${E2E}/chaos-revoke.test.ts`]: 46.7,
  [`${E2E}/electron-launchd.test.ts`]: 1.5,
  [`${E2E}/first-window.test.ts`]: 222.2,
  [`${E2E}/instance.test.ts`]: 23.7,
  [`${E2E}/one-file.test.ts`]: 14.6,
  [`${E2E}/resources.laws.test.ts`]: 366.6,
  [`${E2E}/stored.test.ts`]: 1.2,
  "next/apps/fabrika/src/brain-life.test.ts": 26.5,
  "next/apps/fabrika/src/build-command.test.ts": 2.2,
  "next/apps/fabrika/src/build.test.ts": 41.6,
  "next/apps/fabrika/src/chaos.laws.test.ts": 79.9,
  "next/apps/fabrika/src/checklist-instance.laws.test.ts": 98.0,
  "next/apps/fabrika/src/checklist-runner.laws.test.ts": 20.7,
  "next/apps/fabrika/src/door-recovery.test.ts": 20.9,
  "next/apps/fabrika/src/door-spans.test.ts": 2.8,
  "next/apps/fabrika/src/door.test.ts": 174.9,
  "next/apps/fabrika/src/error-cause.test.ts": 0.1,
  "next/apps/fabrika/src/exam/agent-may.test.ts": 3.3,
  "next/apps/fabrika/src/exam/agents.test.ts": 9.6,
  "next/apps/fabrika/src/exam/alchemy-lifecycle.test.ts": 10.9,
  "next/apps/fabrika/src/exam/bytes.test.ts": 6.4,
  "next/apps/fabrika/src/exam/client-manager-contract.test.ts": 13.9,
  "next/apps/fabrika/src/exam/clock.test.ts": 0.0,
  "next/apps/fabrika/src/exam/commits-git-chain.test.ts": 61.7,
  "next/apps/fabrika/src/exam/commits-git-person.test.ts": 49.8,
  "next/apps/fabrika/src/exam/commits-git-signatures.test.ts": 63.8,
  "next/apps/fabrika/src/exam/commits-git-steps.test.ts": 73.4,
  "next/apps/fabrika/src/exam/commits.test.ts": 1.0,
  "next/apps/fabrika/src/exam/compiler.test.ts": 0.0,
  "next/apps/fabrika/src/exam/deps.test.ts": 4.1,
  "next/apps/fabrika/src/exam/edge-comment.test.ts": 0.0,
  "next/apps/fabrika/src/exam/edges.test.ts": 2.9,
  "next/apps/fabrika/src/exam/effect-functions.test.ts": 0.0,
  "next/apps/fabrika/src/exam/laws-scan.test.ts": 0.0,
  "next/apps/fabrika/src/exam/layers.test.ts": 4.0,
  "next/apps/fabrika/src/exam/ledger-sql.test.ts": 6.4,
  "next/apps/fabrika/src/exam/no-effect-run-outside-edge.test.ts": 0.0,
  "next/apps/fabrika/src/exam/no-hand-tag.test.ts": 0.0,
  "next/apps/fabrika/src/exam/no-of.test.ts": 0.0,
  "next/apps/fabrika/src/exam/no-promises.test.ts": 31.2,
  "next/apps/fabrika/src/exam/object-imports.test.ts": 1.5,
  "next/apps/fabrika/src/exam/one-store-hook.test.ts": 0.4,
  "next/apps/fabrika/src/exam/react-rules.test.ts": 0.0,
  "next/apps/fabrika/src/exam/runner-contract.test.ts": 59.7,
  "next/apps/fabrika/src/exam/secret-types.test.ts": 5.3,
  "next/apps/fabrika/src/exam/twin.test.ts": 20.9,
  "next/apps/fabrika/src/file-services.laws.test.ts": 4.4,
  "next/apps/fabrika/src/grant-readers.laws.test.ts": 1.2,
  "next/apps/fabrika/src/inbox-runner.laws.test.ts": 7.3,
  "next/apps/fabrika/src/input-recording.test.ts": 39.4,
  "next/apps/fabrika/src/instance-one-file.test.ts": 25.7,
  "next/apps/fabrika/src/instance-records.test.ts": 53.7,
  "next/apps/fabrika/src/instance-watch.laws.test.ts": 0.4,
  "next/apps/fabrika/src/instance-wire.test.ts": 151.9,
  "next/apps/fabrika/src/jobs-wire.test.ts": 3.7,
  "next/apps/fabrika/src/local-instance.test.ts": 1.5,
  "next/apps/fabrika/src/port.test.ts": 0.0,
  "next/apps/fabrika/src/record.laws.test.ts": 2.8,
  "next/apps/fabrika/src/repository-open.test.ts": 19.3,
  "next/apps/fabrika/src/runtime-recovery.laws.test.ts": 96.7,
  "next/apps/fabrika/src/runtime.decode.test.ts": 0.2,
  "next/apps/fabrika/src/runtime.laws.test.ts": 48.4,
  "next/apps/fabrika/src/scheduled-job-alarm.test.ts": 6.7,
  "next/apps/fabrika/src/settings-generated.test.ts": 3.0,
  "next/apps/fabrika/src/settings-start.test.ts": 12.6,
  "next/apps/fabrika/src/settings.test.ts": 0.0,
  "next/apps/fabrika/src/sibling.laws.test.ts": 11.3,
  "next/apps/fabrika/src/start-child.laws.test.ts": 175.9,
  "next/apps/fabrika/src/worker-mail.test.ts": 30.6,
  "next/apps/fabrika/src/worker-supervision.test.ts": 22.2,
  "next/apps/fabrika/src/worker-usage.test.ts": 1.1,
  "next/packages/libfabrika/src/Id.cause.test.ts": 0.1,
  "next/packages/libfabrika/src/Id.test.ts": 2.9,
  "next/packages/libfabrika/src/Id.types.test.ts": 0.0,
  "next/packages/libfabrika/src/Testing.test.ts": 0.0,
  "next/packages/libfabrika/src/access/Access.test.ts": 2.0,
  "next/packages/libfabrika/src/access/AccessMachine.laws.test.ts": 2.8,
  "next/packages/libfabrika/src/access/AccessSpans.test.ts": 3.8,
  "next/packages/libfabrika/src/access/Authorization.test.ts": 16.4,
  "next/packages/libfabrika/src/access/ClientManager.test.ts": 16.8,
  "next/packages/libfabrika/src/access/ClientManager.types.test.ts": 0.0,
  "next/packages/libfabrika/src/access/Passkey.test.ts": 0.0,
  "next/packages/libfabrika/src/access/Text.test.ts": 0.0,
  "next/packages/libfabrika/src/ci/Ci.test.ts": 0.2,
  "next/packages/libfabrika/src/cloudflare/SettingsInput.test.ts": 0.8,
  "next/packages/libfabrika/src/cloudflare/SettingsRecorded.test.ts": 2.3,
  "next/packages/libfabrika/src/cloudflare/SettingsRuntime.test.ts": 0.3,
  "next/packages/libfabrika/src/cloudflare/SettingsStarts.test.ts": 27.6,
  "next/packages/libfabrika/src/cloudflare/Watchers.test.ts": 0.3,
  "next/packages/libfabrika/src/cloudflare/alarm.laws.test.ts": 0.4,
  "next/packages/libfabrika/src/cloudflare/connection.test.ts": 12.9,
  "next/packages/libfabrika/src/cloudflare/error-cause.test.ts": 0.4,
  "next/packages/libfabrika/src/cloudflare/fetch.test.ts": 0.7,
  "next/packages/libfabrika/src/cloudflare/index.test.ts": 0.2,
  "next/packages/libfabrika/src/cloudflare/mail.test.ts": 0.6,
  "next/packages/libfabrika/src/cloudflare/p14.test.ts": 0.4,
  "next/packages/libfabrika/src/cloudflare/platform.test.ts": 0.2,
  "next/packages/libfabrika/src/cloudflare/reach.laws.test.ts": 0.3,
  "next/packages/libfabrika/src/cloudflare/readers.laws.test.ts": 0.5,
  "next/packages/libfabrika/src/cloudflare/runner-reply.laws.test.ts": 5.5,
  "next/packages/libfabrika/src/cloudflare/supervision.laws.test.ts": 27.0,
  "next/packages/libfabrika/src/cloudflare/tail.test.ts": 0.2,
  "next/packages/libfabrika/src/codehost/CodeHost.test.ts": 0.5,
  "next/packages/libfabrika/src/desktop/BrainLife.laws.test.ts": 6.8,
  "next/packages/libfabrika/src/desktop/BrainService.types.test.ts": 0.0,
  "next/packages/libfabrika/src/desktop/BrainServiceManaged.laws.test.ts": 4.0,
  "next/packages/libfabrika/src/desktop/Menu.laws.test.ts": 1.9,
  "next/packages/libfabrika/src/desktop/Menu.types.test.ts": 0.0,
  "next/packages/libfabrika/src/gateway/GatewayRevocation.test.ts": 10.3,
  "next/packages/libfabrika/src/gateway/JobAccess.test.ts": 0.1,
  "next/packages/libfabrika/src/gateway/internal/rateLimit.test.ts": 0.1,
  "next/packages/libfabrika/src/gateway/internal/waiting.test.ts": 2.3,
  "next/packages/libfabrika/src/jobs/Job.test.ts": 9.9,
  "next/packages/libfabrika/src/jobs/Jobs.types.test.ts": 0.0,
  "next/packages/libfabrika/src/jobs/internal/job.test.ts": 31.4,
  "next/packages/libfabrika/src/ledger/Ledger.test.ts": 3.2,
  "next/packages/libfabrika/src/ledger/Ledger.types.test.ts": 0.0,
  "next/packages/libfabrika/src/ledger/LedgerCallSpans.test.ts": 0.6,
  "next/packages/libfabrika/src/ledger/LedgerSpans.test.ts": 2.3,
  "next/packages/libfabrika/src/ledger/LedgerStreams.types.test.ts": 0.0,
  "next/packages/libfabrika/src/ledger/LedgerTransaction.test.ts": 0.3,
  "next/packages/libfabrika/src/ledger/Log.test.ts": 1.5,
  "next/packages/libfabrika/src/ledger/Rings.test.ts": 0.1,
  "next/packages/libfabrika/src/ledger/TraceId.test.ts": 0.9,
  "next/packages/libfabrika/src/node/Chaos.laws.test.ts": 0.0,
  "next/packages/libfabrika/src/node/Children.test.ts": 84.4,
  "next/packages/libfabrika/src/node/ErrorCause.test.ts": 3.8,
  "next/packages/libfabrika/src/node/ErrorCause.types.test.ts": 0.0,
  "next/packages/libfabrika/src/node/ExitReason.test.ts": 37.4,
  "next/packages/libfabrika/src/node/IsolateUsage.test.ts": 62.4,
  "next/packages/libfabrika/src/node/Nemesis.laws.test.ts": 7.6,
  "next/packages/libfabrika/src/node/ProgramMail.test.ts": 34.0,
  "next/packages/libfabrika/src/node/ProgramMailRuntime.test.ts": 169.1,
  "next/packages/libfabrika/src/node/RecordPart.test.ts": 1.1,
  "next/packages/libfabrika/src/node/RecordPartResources.test.ts": 1.0,
  "next/packages/libfabrika/src/node/RecoveryJournal.test.ts": 52.6,
  "next/packages/libfabrika/src/node/Replies.test.ts": 70.8,
  "next/packages/libfabrika/src/node/RunnerAdmission.test.ts": 258.9,
  "next/packages/libfabrika/src/node/StartChild.test.ts": 349.9,
  "next/packages/libfabrika/src/node/Watchers.test.ts": 492.4,
  "next/packages/libfabrika/src/node/access/SessionManager.test.ts": 9.6,
  "next/packages/libfabrika/src/node/build/build-assets.test.ts": 37.0,
  "next/packages/libfabrika/src/node/build/build-one-file.test.ts": 44.8,
  "next/packages/libfabrika/src/node/build/css.test.ts": 11.9,
  "next/packages/libfabrika/src/node/build/error-cause.test.ts": 0.3,
  "next/packages/libfabrika/src/node/dev/DevLife.laws.test.ts": 0.1,
  "next/packages/libfabrika/src/node/dev/dev-control.laws.test.ts": 9.3,
  "next/packages/libfabrika/src/node/dev/dev-errors.laws.test.ts": 1.0,
  "next/packages/libfabrika/src/node/dev/dev-recording.laws.test.ts": 0.0,
  "next/packages/libfabrika/src/node/dev/dev-secrets.laws.test.ts": 3.5,
  "next/packages/libfabrika/src/node/dev/dev.laws.test.ts": 2.1,
  "next/packages/libfabrika/src/node/dev/error-cause.test.ts": 0.2,
  "next/packages/libfabrika/src/node/dev/local-dev.test.ts": 3.8,
  "next/packages/libfabrika/src/node/dev/supervision-spans.test.ts": 3.2,
  "next/packages/libfabrika/src/node/gateway/Jobs.test.ts": 147.5,
  "next/packages/libfabrika/src/node/gateway/RateLimit.test.ts": 5.8,
  "next/packages/libfabrika/src/node/jobs/JobsLedger.test.ts": 39.2,
  "next/packages/libfabrika/src/node/launchd/BrainControlLaunchd.laws.test.ts": 35.6,
  "next/packages/libfabrika/src/node/launchd/LaunchdStatus.laws.test.ts": 0.3,
  "next/packages/libfabrika/src/node/launchd/ProcessGroups.laws.test.ts": 0.0,
  "next/packages/libfabrika/src/node/ledger/LedgerStreams.test.ts": 73.3,
  "next/packages/libfabrika/src/node/repositories/OpenRepository.test.ts": 106.3,
  "next/packages/libfabrika/src/node/repositories/RepositoriesGit.test.ts": 379.3,
  "next/packages/libfabrika/src/node/repositories/RepositoryTrust.test.ts": 15.4,
  "next/packages/libfabrika/src/node/repositories/Sources.test.ts": 59.8,
  "next/packages/libfabrika/src/node/runtime/RunnerInit.test.ts": 3.6,
  "next/packages/libfabrika/src/node/settings/Command.test.ts": 0.6,
  "next/packages/libfabrika/src/node/settings/Load.test.ts": 1.2,
  "next/packages/libfabrika/src/packs/ProgramName.test.ts": 0.1,
  "next/packages/libfabrika/src/packs/internal/open.test.ts": 9.4,
  "next/packages/libfabrika/src/presence/Connections.test.ts": 0.7,
  "next/packages/libfabrika/src/processes/ExitReason.test.ts": 0.4,
  "next/packages/libfabrika/src/processes/Mailbox.test.ts": 4.2,
  "next/packages/libfabrika/src/processes/MailboxHistory.test.ts": 0.3,
  "next/packages/libfabrika/src/processes/ProcessIdGenerator.test.ts": 1.0,
  "next/packages/libfabrika/src/processes/ProcessLifecycle.test.ts": 5.3,
  "next/packages/libfabrika/src/processes/ProcessManager.test.ts": 0.8,
  "next/packages/libfabrika/src/processes/ProcessMonitors.test.ts": 8.8,
  "next/packages/libfabrika/src/processes/ProcessSpans.test.ts": 1.5,
  "next/packages/libfabrika/src/processes/ProcessStreams.test.ts": 2.4,
  "next/packages/libfabrika/src/processes/ProcessTextCaps.test.ts": 2.4,
  "next/packages/libfabrika/src/processes/ProcessWindow.test.ts": 0.5,
  "next/packages/libfabrika/src/processes/internal/processTable.laws.test.ts": 1.9,
  "next/packages/libfabrika/src/processes/internal/programMail.test.ts": 0.1,
  "next/packages/libfabrika/src/repositories/Repositories.types.test.ts": 0.0,
  "next/packages/libfabrika/src/runtime/Audit.test.ts": 1.4,
  "next/packages/libfabrika/src/runtime/BrainLife.laws.test.ts": 0.1,
  "next/packages/libfabrika/src/runtime/Built.test.ts": 1.4,
  "next/packages/libfabrika/src/runtime/Chaos.laws.test.ts": 0.2,
  "next/packages/libfabrika/src/runtime/Client.laws.test.ts": 0.8,
  "next/packages/libfabrika/src/runtime/EffectFunctions.test.ts": 8.3,
  "next/packages/libfabrika/src/runtime/Entry.test.ts": 0.0,
  "next/packages/libfabrika/src/runtime/ErrorCause.test.ts": 0.3,
  "next/packages/libfabrika/src/runtime/Execution.test.ts": 0.1,
  "next/packages/libfabrika/src/runtime/Gateway.laws.test.ts": 1.1,
  "next/packages/libfabrika/src/runtime/IsolateUsage.test.ts": 0.0,
  "next/packages/libfabrika/src/runtime/Patch.test.ts": 0.1,
  "next/packages/libfabrika/src/runtime/ProcessStore.test.ts": 2.3,
  "next/packages/libfabrika/src/runtime/Program.test.ts": 1.7,
  "next/packages/libfabrika/src/runtime/Program.types.test.ts": 0.1,
  "next/packages/libfabrika/src/runtime/RecoveryGaps.test.ts": 5.6,
  "next/packages/libfabrika/src/runtime/RecoveryStore.test.ts": 0.3,
  "next/packages/libfabrika/src/runtime/Runner.test.ts": 123.8,
  "next/packages/libfabrika/src/runtime/RunnerOptions.test.ts": 0.0,
  "next/packages/libfabrika/src/runtime/RunnerRecovery.laws.test.ts": 2.2,
  "next/packages/libfabrika/src/runtime/RunnerSupervision.test.ts": 62.5,
  "next/packages/libfabrika/src/runtime/State.test.ts": 0.1,
  "next/packages/libfabrika/src/runtime/internal/exitReason.test.ts": 0.0,
  "next/packages/libfabrika/src/runtime/internal/recovery.test.ts": 1.2,
  "next/packages/libfabrika/src/runtime/internal/reply.test.ts": 0.2,
  "next/packages/libfabrika/src/runtime/internal/supervisor.laws.test.ts": 1.0,
  "next/packages/libfabrika/src/runtime/internal/watchers.test.ts": 31.1,
  "next/packages/libfabrika/src/schedules/ScheduledJob.test.ts": 0.3,
  "next/packages/libfabrika/src/settings/Codec.test.ts": 0.2,
  "next/packages/libfabrika/src/settings/DesktopBrain.test.ts": 0.3,
  "next/packages/libfabrika/src/settings/DesktopLink.test.ts": 0.2,
  "next/packages/libfabrika/src/settings/Files.test.ts": 0.5,
  "next/packages/libfabrika/src/settings/JsonSchema.test.ts": 0.4,
  "next/packages/libfabrika/src/settings/Print.test.ts": 0.2,
  "next/packages/libfabrika/src/settings/Reference.test.ts": 0.3,
  "next/packages/libfabrika/src/settings/Setting.test.ts": 0.2,
  "next/packages/libfabrika/src/settings/Snapshot.test.ts": 1.1,
  "next/packages/libfabrika/src/settings/Sources.test.ts": 0.1,
  "next/packages/libfabrika/src/settings/Start.test.ts": 0.2,
  "next/packages/libfabrika/src/settings/Toml.types.test.ts": 0.0,
  "next/packages/libfabrika/src/settings/TomlEdit.test.ts": 3.8,
  "next/packages/libfabrika/src/settings/TomlParser.test.ts": 0.2,
  "next/packages/libfabrika/src/telemetry/ArchiveCryptoFailure.test.ts": 0.0,
  "next/packages/libfabrika/src/telemetry/ErrorCause.test.ts": 0.2,
  "next/packages/libfabrika/src/telemetry/P12Readers.laws.test.ts": 0.2,
  "next/packages/libfabrika/src/telemetry/Records.test.ts": 5.2,
  "next/packages/libfabrika/src/telemetry/Sink.test.ts": 13.1,
  "next/packages/libfabrika/src/telemetry/Trace.types.test.ts": 0.0,
  "next/packages/libfabrika/src/telemetry/internal/measurements.test.ts": 10.5,
  "next/packages/libfabrika/src/telemetry/internal/sink.test.ts": 0.4,
  "next/packages/libfabrika/src/telemetry/internal/sums.test.ts": 1.4,
  "next/packages/libfabrika/src/transport/Answer.test.ts": 0.2,
  "next/packages/libfabrika/src/transport/Connection.test.ts": 1.9,
  "next/packages/libfabrika/src/transport/ErrorCause.test.ts": 0.2,
  "next/packages/libfabrika/src/transport/Hello.test.ts": 0.4,
  "next/packages/libfabrika/src/transport/Link.laws.test.ts": 0.2,
  "next/packages/libfabrika/src/transport/Sshsig.test.ts": 0.6,
  "next/packages/libfabrika/src/transport/SshsigWebauthn.test.ts": 0.6,
  "next/packages/libfabrika/src/transport/internal/binaryCryptoFailure.test.ts": 0.0,
  "next/packages/libfabrika/src/transport/internal/connection.test.ts": 1.8,
  "next/packages/tuval/src/browser/key.laws.test.ts": 7.1,
  "next/packages/tuval/src/window/machine.model.laws.test.ts": 18.7,
  "next/packages/tuval/src/window/main.laws.test.ts": 11.5,
  "next/programs/chaos/src/program.laws.test.ts": 1.5,
  "next/programs/checklist/src/client.laws.test.ts": 0.1,
  "next/programs/checklist/src/program.laws.test.ts": 0.2,
  "next/programs/checklist/src/tile.laws.test.ts": 0.2,
  "next/programs/checklist/src/window.laws.test.ts": 0.7,
  "next/programs/checklist/src/window.types.test.ts": 0.0,
  "next/programs/counter/src/program.laws.test.ts": 0.3,
  "next/programs/counter/src/runner.laws.test.ts": 5.1,
  "next/programs/counter/src/window.types.test.ts": 0.0,
  "next/programs/inbox/src/program.laws.test.ts": 0.2,
  "next/programs/pipeline/src/Change.test.ts": 0.7,
  "next/programs/pipeline/src/Merger.laws.test.ts": 1.7,
  "next/programs/pipeline/src/Queue.laws.test.ts": 8.4,
  "next/programs/pipeline/src/Settings.test.ts": 0.3,
  "next/programs/pipeline/src/handlers.test.ts": 0.1,
  "next/programs/pipeline/src/node/queue.laws.test.ts": 125.7,
  "next/programs/pipeline/src/node/runner.laws.test.ts": 21.8,
  "oxlint-plugins/door-is-library.test.ts": 0.0,
  "oxlint-plugins/exact-versions.test.ts": 7.1,
  "oxlint-plugins/one-id-module.test.ts": 9.0,
  "oxlint-plugins/outside-input-constructor.test.ts": 1.1,
  "oxlint-plugins/plants.test.ts": 48.2,
  "oxlint-plugins/stylelint.test.ts": 6.9,
  "packages/fabrika-design/src/build/contrast.test.ts": 0.0,
  "packages/fabrika-design/src/build/schema.test.ts": 0.1,
  "packages/fabrika-design/src/build/tokens.test.ts": 22.2,
  "packages/fabrika-design/src/themes.frame.test.ts": 0.0,
  "packages/fabrika-design/src/themes.test.ts": 0.1,
  ".agents/skills/lead/scripts/boxrm.test.ts": 295.0,
  ".agents/skills/lead/scripts/loosening.test.ts": 234.6,
  "scripts/caps.test.ts": 108.5,
  "oxlint-plugins/padding-line-between-statements.test.ts": 44.7,
  ".agents/skills/lead/scripts/leakgrep.test.ts": 34.2,
  ".agents/skills/lead/scripts/mutbox.test.ts": 34.0,
  "oxlint-plugins/program-package-layout.test.ts": 80.3,
  "vitest.shards.test.ts": 0.3,
};

/**
 * The middle of `seconds` once sorted; of an even count, the lower middle, so no two rows are
 * averaged into a number nobody measured. With no seconds at all there is no middle, so 1 s.
 */
export const median = (seconds: readonly number[]): number =>
  seconds.toSorted((a, b) => a - b)[Math.floor((seconds.length - 1) / 2)] ?? 1;

/** What a file with no row counts as: the median of every row, read once. */
const guess = median(Object.values(measured));

/**
 * Each file's machine, `0` to `count - 1`, in the order the files came. Each measured file,
 * heaviest first (ties by path), goes to the machine with the least seconds so far (ties: the
 * first). Then each file with no seconds, in path order, goes the same way and counts as
 * `unmeasured` seconds, the table's median by default, so several new files spread over the
 * machines. The same files in any order get the same machines, so every machine computes the same
 * split.
 */
export const assign = (
  files: readonly { readonly path: string; readonly seconds?: number | undefined }[],
  count: number,
  start: readonly number[] = [],
  unmeasured: number = guess,
): number[] => {
  const byPath = (x: { readonly path: string }, y: { readonly path: string }) =>
    x.path < y.path ? -1 : x.path > y.path ? 1 : 0;
  const order = files
    .map((file, at) => ({ path: file.path, seconds: file.seconds, at }))
    .toSorted((x, y) =>
      x.seconds === undefined || y.seconds === undefined
        ? Number(x.seconds === undefined) - Number(y.seconds === undefined) || byPath(x, y)
        : y.seconds - x.seconds || byPath(x, y),
    );
  const load = Array.from({ length: count }, (_, i) => start[i] ?? 0);
  const machines = files.map(() => 0);

  for (const file of order) {
    const least = load.indexOf(Math.min(...load));
    machines[file.at] = least;
    load[least] = (load[least] ?? 0) + (file.seconds ?? unmeasured);
  }

  return machines;
};

/** Workers used by the rest step on each CI machine. */
export const WORKERS = 3;

export const wall = (seconds: readonly number[]): number =>
  Math.max(0, ...seconds, seconds.reduce((sum, value) => sum + value, 0) / WORKERS);

/** vitest's own sequencer, with only `shard` changed: it keeps this machine's files of `assign`. */
export class Shards extends BaseSequencer {
  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { root, shard } = this.ctx.config;

    // vitest calls `shard` only when `--shard` is given; the type does not know that.
    if (shard === undefined) {
      throw new Error("Shards.shard: called without --shard");
    }

    const machines = assign(
      files.map((spec) => {
        const path = relative(root, spec.moduleId);
        return { path, seconds: Object.hasOwn(measured, path) ? measured[path] : undefined };
      }),
      shard.count,
    );
    return files.filter((_, i) => machines[i] === shard.index - 1);
  }
}
