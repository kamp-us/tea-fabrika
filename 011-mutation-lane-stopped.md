REPORT: The hourly mutation lane is stopped on the owner's call after pass 1, covered through 700af11471655a892923fba5b72d891061bd790d, with no run in progress and no next pass scheduled.

- Pass 1 only recorded main's head as its starting point; it ran no mutation.
- Draft pull request: https://github.com/kamp-us/tea-fabrika/pull/1250, branch fabrikalfa/mutation-hourly. Its first line still reads "Covered through: 700af11471655a892923fba5b72d891061bd790d", so a restart can begin from that commit.
- No mutation.yaml run was started. The pass 2 wake-up is deleted.
- The lane stays idle until it is told to start again.
