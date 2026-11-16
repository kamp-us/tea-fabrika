#!/bin/sh
# Today's tooling. Every shell shares this lock, regardless of its temp settings.
set -eu
# pnpm -r refuses a node_modules that is no folder (ERR_PNPM_UNSAFE_TASK_RUN_STATE_PATH). A link is
# replaced by this worktree's own install below, under the lock. Anything else that is no folder is
# not ours to remove, so say so before pnpm or the lock starts.
if [ ! -L node_modules ] && [ -e node_modules ] && [ ! -d node_modules ]; then
  echo "typecheck: node_modules is no folder; remove it and run pnpm install --offline --frozen-lockfile" >&2
  exit 1
fi
# One fixed system file, never under TMPDIR: agents' TMPDIR differs, and the lock must be shared.
# Only a test points FABRIKA_TYPECHECK_LOCK at a file of its own, so a real typecheck on the same
# machine never holds up its fake compilers, and they never hold up a real typecheck.
FABRIKA_TYPECHECK_LOCK=${FABRIKA_TYPECHECK_LOCK:-/tmp/fabrika-typecheck.lock}
# The compiler's process name, which the laptop wait looks for. Only a test names another, for the
# same reason as the lock: a real tsgo on the machine never holds up a law's stand-ins.
FABRIKA_TYPECHECK_COMPILER=${FABRIKA_TYPECHECK_COMPILER:-tsgo}
export FABRIKA_TYPECHECK_LOCK FABRIKA_TYPECHECK_COMPILER
exec python3 - <<'PY'
import fcntl, os, subprocess, sys, time

LOCK = os.environ["FABRIKA_TYPECHECK_LOCK"]
COMPILER = os.environ["FABRIKA_TYPECHECK_COMPILER"]


def named(pid):
    # The process's command line, so a person can tell what holds things up; just the pid where ps
    # cannot read it.
    ps = subprocess.run(["ps", "-o", "command=", "-p", pid], capture_output=True, text=True)
    command = ps.stdout.strip() if ps.returncode == 0 else ""
    return f"pid {pid} ({command})" if command else f"pid {pid}"


def take(lock):
    # Another typecheck holds the lock: say once whose pid it wrote, then wait for the OS to hand it
    # over. A holder that died left only its pid in the file, and the OS has already let go, so a
    # stale lock is taken at once. The lock is the OS's, never the pid: a pid file is only a label.
    # A holder writes its pid just after it takes the lock, so a waiter that finds no pid yet looks
    # again a few times before it names no one.
    for attempt in range(20):
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except BlockingIOError:
            with open(LOCK) as label:
                holder = label.read().strip()
            if holder.isdigit() or attempt == 19:
                who = named(holder) if holder.isdigit() else "another typecheck"
                sys.stderr.write(f"typecheck: waiting for {who}, which holds {LOCK}\n")
                sys.stderr.flush()
                fcntl.flock(lock, fcntl.LOCK_EX)
                break
            time.sleep(0.05)
    os.ftruncate(lock.fileno(), 0)
    lock.write(f"{os.getpid()}\n")
    lock.flush()


def wait_for_compiler():
    # On the laptop, a compiler this lock does not cover (a package's own tsc, a tool's tsgo) still
    # takes about 8 cores, and two at once froze it (AGENTS.md, 0012). So the holder waits until none
    # runs, the same wait drive.ts makes before a step. CI runs one job to a machine and skips it,
    # the same way the test config's local guard reads CI (0410). Where pgrep cannot list processes
    # (a sandbox), the wait is skipped with one line, never read as "none running".
    if os.environ.get("CI"):
        return
    said = False
    while True:
        try:
            found = subprocess.run(["pgrep", "-x", COMPILER], capture_output=True, text=True)
        except OSError:
            found = subprocess.CompletedProcess([], 127)
        if found.returncode == 1:
            return
        if found.returncode != 0:
            sys.stderr.write(f"typecheck: pgrep cannot list processes here, so the wait for a running {COMPILER} is skipped\n")
            return
        if not said:
            first = found.stdout.split()[0]
            sys.stderr.write(f"typecheck: waiting for {named(first)}, a {COMPILER} already running\n")
            sys.stderr.flush()
            said = True
        time.sleep(1)


INSTALL = ["pnpm", "install", "--offline", "--frozen-lockfile"]
# Each package keeps what its last check found in this file, relative to the package, and checks
# again only the files whose text changed and the files that reach them. tsc keys each file by a
# hash of its text, never its mtime, so a fresh checkout reads it too. CI keeps these files in its
# cache (check.yaml's typecheck job). Planted on next/packages/libfabrika, 2026-11-14: an error in
# one file, an error only an unchanged importer shows, a change under the old mtime and an Effect
# check each failed the warm run; fresh mtimes on every file kept it warm.
commands = [["pnpm", "exec", "effect-tsgo", "patch", "--typescript"],
            ["pnpm", "-r", "typecheck", "--incremental",
             "--tsBuildInfoFile", "node_modules/.cache/tsc/typecheck.tsbuildinfo"]]

# Keep this file in place. Unlinking it could give waiters different locks.
# The OS releases a dead holder's lock, including after SIGKILL.
with open(LOCK, "a") as lock:
    take(lock)
    wait_for_compiler()
    # A linked node_modules (a worktree pointed at another checkout's) is never written through:
    # the patch would change the other checkout's compiler, and an install through the link rewrites
    # its install state. Only the link goes, never what it points at, and this worktree gets its own
    # install from the warm store, with no network. Under the lock, since the install's `prepare`
    # runs the same patch and a second typecheck here must find the folder, not the link.
    if os.path.islink("node_modules"):
        os.unlink("node_modules")
        commands.insert(0, INSTALL)
    for command in commands:
        # A compiler keeps the lock if this wrapper dies before it does.
        status = subprocess.call(command, pass_fds=(lock.fileno(),))
        if status == 0 and command is INSTALL and not os.path.isdir("node_modules"):
            status = 1
        if status:
            if command is INSTALL:
                sys.stderr.write("typecheck: node_modules was a link and is removed, but the offline install failed;"
                                 " run pnpm install --frozen-lockfile\n")
            sys.exit(status if status > 0 else 128 - status)
PY
