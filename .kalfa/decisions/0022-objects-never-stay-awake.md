# A Durable Object never stays awake on its own

An object does its work inside a wake (a call, a socket message, an alarm), sets an alarm for later work, and then has nothing pending: no `setInterval`, pending timer, sleeping fiber or polling. A loop is an alarm whose handler catches its own failures and sets the next alarm. Cloudflare bills awake time, and one pending timer keeps an object awake forever.
