CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "password" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AuthToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Conversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "topic" TEXT NOT NULL DEFAULT '新的聊天',
    "memoryPrompt" TEXT NOT NULL DEFAULT '',
    "lastUpdate" BIGINT NOT NULL DEFAULT 0,
    "lastSummarizeIndex" INTEGER NOT NULL DEFAULT 0,
    "clearContextIndex" INTEGER,
    "maskConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "date" TEXT NOT NULL,
    "isError" BOOLEAN NOT NULL DEFAULT false,
    "model" TEXT,
    "tools" JSONB,
    "fileContent" TEXT,
    "ragKgSources" JSONB,
    "researchSources" JSONB,
    "designCalculations" JSONB,
    "structureVisualizations" JSONB,
    "simulationJobDrafts" JSONB,
    "sessionFileSources" JSONB,
    "userFileSources" JSONB,
    "agentPlan" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "UploadedFile" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "extractedText" TEXT,
    "parseStatus" TEXT NOT NULL DEFAULT 'pending',
    "parseError" TEXT,
    "parsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UploadedFile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "UserFileRagChunk" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "charStart" INTEGER NOT NULL,
    "charEnd" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserFileRagChunk_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SimulationJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "messageId" TEXT,
    "solver" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "title" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "result" JSONB,
    "externalJobId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SimulationJob_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Message"
    ADD COLUMN IF NOT EXISTS "structureVisualizations" JSONB;

ALTER TABLE "Message"
    ADD COLUMN IF NOT EXISTS "simulationJobDrafts" JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "AuthToken_token_key" ON "AuthToken"("token");
CREATE INDEX IF NOT EXISTS "AuthToken_token_idx" ON "AuthToken"("token");
CREATE INDEX IF NOT EXISTS "AuthToken_userId_idx" ON "AuthToken"("userId");
CREATE INDEX IF NOT EXISTS "Conversation_userId_idx" ON "Conversation"("userId");
CREATE INDEX IF NOT EXISTS "Conversation_userId_updatedAt_idx" ON "Conversation"("userId", "updatedAt");
CREATE INDEX IF NOT EXISTS "Message_conversationId_idx" ON "Message"("conversationId");
CREATE INDEX IF NOT EXISTS "Message_conversationId_date_idx" ON "Message"("conversationId", "date");
CREATE INDEX IF NOT EXISTS "UploadedFile_userId_createdAt_idx" ON "UploadedFile"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "UploadedFile_userId_parseStatus_idx" ON "UploadedFile"("userId", "parseStatus");
CREATE INDEX IF NOT EXISTS "UserFileRagChunk_userId_createdAt_idx" ON "UserFileRagChunk"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "UserFileRagChunk_userId_fileId_idx" ON "UserFileRagChunk"("userId", "fileId");
CREATE UNIQUE INDEX IF NOT EXISTS "UserFileRagChunk_fileId_chunkIndex_key" ON "UserFileRagChunk"("fileId", "chunkIndex");
CREATE INDEX IF NOT EXISTS "SimulationJob_userId_createdAt_idx" ON "SimulationJob"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "SimulationJob_userId_status_idx" ON "SimulationJob"("userId", "status");
CREATE INDEX IF NOT EXISTS "SimulationJob_conversationId_idx" ON "SimulationJob"("conversationId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'AuthToken_userId_fkey'
    ) THEN
        ALTER TABLE "AuthToken"
            ADD CONSTRAINT "AuthToken_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'SimulationJob_userId_fkey'
    ) THEN
        ALTER TABLE "SimulationJob"
            ADD CONSTRAINT "SimulationJob_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'SimulationJob_conversationId_fkey'
    ) THEN
        ALTER TABLE "SimulationJob"
            ADD CONSTRAINT "SimulationJob_conversationId_fkey"
            FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Conversation_userId_fkey'
    ) THEN
        ALTER TABLE "Conversation"
            ADD CONSTRAINT "Conversation_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Message_conversationId_fkey'
    ) THEN
        ALTER TABLE "Message"
            ADD CONSTRAINT "Message_conversationId_fkey"
            FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'UploadedFile_userId_fkey'
    ) THEN
        ALTER TABLE "UploadedFile"
            ADD CONSTRAINT "UploadedFile_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'UserFileRagChunk_userId_fkey'
    ) THEN
        ALTER TABLE "UserFileRagChunk"
            ADD CONSTRAINT "UserFileRagChunk_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'UserFileRagChunk_fileId_fkey'
    ) THEN
        ALTER TABLE "UserFileRagChunk"
            ADD CONSTRAINT "UserFileRagChunk_fileId_fkey"
            FOREIGN KEY ("fileId") REFERENCES "UploadedFile"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
