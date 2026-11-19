-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sources" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "inbound_secret" TEXT,
    "requires_signature" BOOLEAN NOT NULL DEFAULT false,
    "transform" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sources_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "destinations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "signing_secret" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "destinations_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source_id" TEXT NOT NULL,
    "idempotency_key" TEXT,
    "content_type" TEXT,
    "headers" JSONB NOT NULL DEFAULT '{}',
    "body" TEXT NOT NULL,
    "received_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "events_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "deliveries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "event_id" TEXT NOT NULL,
    "destination_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_status_code" INTEGER,
    "last_error" TEXT,
    "next_attempt_at" DATETIME,
    "delivered_at" DATETIME,
    "replay_of" TEXT,
    "replayed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "deliveries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "deliveries_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "destinations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "delivery_attempts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "delivery_id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "status_code" INTEGER,
    "duration_ms" INTEGER NOT NULL,
    "error" TEXT,
    "response_body" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "delivery_attempts_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "sources_slug_key" ON "sources"("slug");

-- CreateIndex
CREATE INDEX "sources_user_id_idx" ON "sources"("user_id");

-- CreateIndex
CREATE INDEX "destinations_source_id_idx" ON "destinations"("source_id");

-- CreateIndex
CREATE INDEX "events_source_id_received_at_idx" ON "events"("source_id", "received_at" DESC);

-- CreateIndex
CREATE INDEX "events_received_at_idx" ON "events"("received_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "events_source_id_idempotency_key_key" ON "events"("source_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "deliveries_event_id_idx" ON "deliveries"("event_id");

-- CreateIndex
CREATE INDEX "deliveries_destination_id_idx" ON "deliveries"("destination_id");

-- CreateIndex
CREATE INDEX "deliveries_status_updated_at_idx" ON "deliveries"("status", "updated_at");

-- CreateIndex
CREATE INDEX "delivery_attempts_delivery_id_idx" ON "delivery_attempts"("delivery_id");
