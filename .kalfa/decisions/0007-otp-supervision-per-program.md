# Supervision follows OTP, with one tree per program

Each program is its own OTP-style application with its own supervisor and restart count, so one program's crash loop never stops another; `Program.supervise` asks a `Supervisor` service whether to restart (on a `Schedule`, which may back off) or stop. Past its restart limit a program stops and waits for a person to restart it, never a timer: the old timer-retry restarted a name that always throws about 86,000 times a day. Isolation also has hard walls, not code alone: write and storage quotas per program and a CPU limit per isolate.
