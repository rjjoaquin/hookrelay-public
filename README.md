# HookRelay

HookRelay gives you one URL for incoming webhooks and forwards each event to the services you choose. The dashboard shows which deliveries succeeded, which failed, and why.

### Example: an online store receives an order

1. Your store sends an order webhook to HookRelay.
2. HookRelay forwards it to your inventory app and your shipping app. Inventory accepts it, but shipping returns a server error.
3. HookRelay retries the shipping delivery. If it runs out of attempts, you can open **Dead letters** and replay just that delivery once shipping is back online.

Each delivery is signed. You can also configure a relay to reshape the JSON payload before forwarding it.

Built with NestJS, Prisma, PostgreSQL, Redis and BullMQ.


DEV SETUP

You only need Node.js 20.19 or newer. No database server, no Redis.

    npm install
    npm run dev

Open http://localhost:3000 and create an account.

In development, data is stored in a SQLite file called dev.db in the project folder, and deliveries run on an in-process queue instead of Redis. Delete dev.db to start fresh. npm run dev sets up the tables and restarts the app whenever you save a file.

To develop against PostgreSQL or Redis instead, copy .env.example to .env and fill in DATABASE_URL or REDIS_URL.


TESTING IT

Demo data: while the app is running, run npm run seed in a second terminal. It prints a password for demo@example.com. Sign in with it to see four demo relays already sending: one succeeds, one fails twice then succeeds, one fails until it lands in Dead letters, and one is rejected right away.

Your own relay: create a relay in the dashboard and use one of these as its destination URL.

    http://localhost:3000/dev/sink/200     always succeeds
    http://localhost:3000/dev/sink/500     always fails, retried, then lands in Dead letters
    http://localhost:3000/dev/sink/flaky   fails twice, then succeeds

Then post anything to the relay's ingest URL, shown in the dashboard:

    curl -d '{"hello":"world"}' http://localhost:3000/in/YOUR-SLUG

The event and every delivery attempt show up on the Events tab.

Retries wait 2 seconds and double each time. To watch a full retry cycle in under a minute, put BACKOFF_BASE_MS=500 and MAX_ATTEMPTS=4 in a .env file.

Unit tests: npm test


SETTINGS

Nothing needs configuring for development. .env.example lists the optional settings.


DEPLOYING

Production uses PostgreSQL and Redis. SQLite and the in-process queue are refused when NODE_ENV=production. Use managed Postgres and Redis, and set the Redis eviction policy to noeviction. Build the included Dockerfile and run it with NODE_ENV=production, DATABASE_URL and REDIS_URL set. Serve it over HTTPS and set TRUST_PROXY=true. Database migrations run automatically on startup. To run the production stack locally in Docker, use docker compose up.

The security audit is in SECURITY.md.
