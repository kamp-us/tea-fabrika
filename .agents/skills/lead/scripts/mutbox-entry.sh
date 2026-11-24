#!/bin/sh
# Runs inside the mutation container (a step that needs ports or its own processes and network isolation runs in a container), as an unprivileged user with no network.
# /in/repo.git is the commit under test, read-only. /out is the only folder that leaves the box.
# Exit: 70 the offline install failed, 71 a related test fails before any mutant, 72 no test left,
# 73 a depth was asked (MUTATE_RUNS) and the build has no depth.config.ts, else run.sh's own (124 when
# its five minutes ran out).
set -eu
usage() {
	cat /sys/fs/cgroup/memory.peak > /out/memory.peak 2>/dev/null || :
	cat /sys/fs/cgroup/cpu.stat > /out/cpu.stat 2>/dev/null || :
}
trap usage EXIT
cd /repo
cp -R /in/repo.git .git
git config core.bare false
git reset -q --hard refs/heads/build
pnpm install --offline --frozen-lockfile > /out/install.txt 2>&1 || exit 70
export TMPDIR=/tmp
# Stryker mutates /repo itself: a sandbox copy would reach other packages' unmutated files
# through their node_modules links (ticket 457). /repo is this container's own throwaway copy.
export IN_PLACE=1
set -f
IFS=,
set -- $RELATED
unset IFS
[ $# -gt 0 ] || exit 72
# MUTATE_RUNS, when set, caps the cases a property law draws in every run here (ticket 1306): the baseline
# and arm a's baseline run through the config that caps them, and run.sh's own config does the same. A
# build from before that config has none to run, and a full-depth answer under a depth label would be a lie.
depth=
if [ -n "${MUTATE_RUNS:-}" ]; then
	[ -f .agents/skills/mutation/scripts/depth.config.ts ] || exit 73
	depth=--config=.agents/skills/mutation/scripts/depth.config.ts
fi
# The baseline, with vitest's own reporter: which tests passed, failed or skipped themselves here.
node_modules/.bin/vitest run --maxWorkers=1 $depth --reporter=json --outputFile=/out/baseline.json "$@" \
	> /out/baseline.txt 2>&1 || exit 71

# arm <name> <ticket> <baseline>: one run.sh round, its files copied to /out/<name>. The baseline is
# the plain run of the arm's own tests here, which sets its test limit (ticket 605).
arm() {
	mkdir -p "/out/$1"
	code=0
	BASELINE=$3 T=$2 sh .agents/skills/mutation/scripts/run.sh > "/out/$1/run.txt" 2>&1 || code=$?
	for f in report.json sample.json log.txt events; do
		[ ! -e "/tmp/mut-$2/$f" ] || cp -R "/tmp/mut-$2/$f" "/out/$1/"
	done
	echo "$code" > "/out/$1/exit"
	# A run stopped at its cap may leave a mutated file behind; the next arm starts clean.
	git reset -q --hard refs/heads/build
}

# With a base, the sample is the quest's own lines, base..build, not the build commit's alone: a
# tip that merged main has main's lines against its first parent (ticket 568).
if git rev-parse -q --verify refs/heads/base > /dev/null; then
	export SINCE=refs/heads/base
fi
arm b "$T" /out/baseline.json
b=$(cat /out/b/exit)

# The recheck (ticket 1306, recheck.ts): a mutant that lived at the capped depth is run again at full depth, in only
# the tests that cover it, so the gate reports it only when it lives there too. Arm c is that run: no MUTATE_RUNS,
# the survivors' own ranges, and the vitest limit at its ceiling, since the plain baseline ran capped and says
# nothing of full-depth times. It runs in a subshell so arm a below keeps the cap. A plan that cannot be made leaves
# no arm c, and every mutant that lived stays reported.
if [ -n "${MUTATE_RUNS:-}" ] && [ -f /out/b/report.json ]; then
	node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
import { planFrom } from "./.agents/skills/mutation/scripts/recheck.ts";
const plan = planFrom(readFileSync("/out/b/report.json", "utf8"), (process.env.RELATED ?? "").split(","));
if (plan !== null) {
  writeFileSync("/out/c-ranges", plan.ranges.map((r) => JSON.stringify(r)).join(","));
  writeFileSync("/out/c-related", plan.related.join(","));
  writeFileSync("/out/c-names", plan.names ?? "");
}' || :
	if [ -s /out/c-ranges ]; then
		(
			unset MUTATE_RUNS
			RANGES=$(cat /out/c-ranges)
			RELATED=$(cat /out/c-related)
			TEST_NAMES=$(cat /out/c-names)
			TEST_LIMIT=60000
			export RANGES RELATED TEST_NAMES TEST_LIMIT
			arm c "${T}c" ""
		) || :
	fi
fi

# Arm a: the same sample against the related tests as the base has them. A test the base lacks
# is left out of that arm. Stryker stops when a test fails in its dry run, so arm a first runs the
# base's tests on the build and keeps only the files that pass; /out/a-kept names them, and
# /out/a-baseline.json says why the rest were dropped (ticket 655).
if git rev-parse -q --verify refs/heads/base > /dev/null; then
	kept=
	for f in "$@"; do
		if git cat-file -e "refs/heads/base:$f" 2> /dev/null; then
			git show "refs/heads/base:$f" > "$f"
			kept="$kept${kept:+,}$f"
		fi
	done
	passing=
	if [ -n "$kept" ]; then
		IFS=,
		set -- $kept
		unset IFS
		node_modules/.bin/vitest run --maxWorkers=1 $depth --reporter=json --outputFile=/out/a-baseline.json "$@" \
			> /out/a-baseline.txt 2>&1 || :
		passing=$(node -e '
const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
process.stdout.write(r.testResults.filter((t) => t.status === "passed").map((t) => t.name.replace(/^\/repo\//, "")).join(","));
' /out/a-baseline.json 2> /dev/null) || passing=
	fi
	printf '%s\n' "$passing" > /out/a-kept
	if [ -n "$passing" ]; then
		RELATED=$passing arm a "${T}a" /out/a-baseline.json
	fi
fi
exit "$b"
