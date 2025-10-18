# 🧭 Cloudflare Worker + CockroachDB + Prisma (Auto-Migrations)

> 💡 **Want step-by-step instructions?** See [INSTRUCTIONS.md](./INSTRUCTIONS.md) for a complete linear workflow from start to finish.

## 📋 Challenge

Create a Cloudflare Worker responsible for running database migrations with **two separate migration files**:

**First migration:**
```sql
CREATE TABLE users (id TEXT PRIMARY KEY);
```

**Second migration:**
```sql
ALTER TABLE users ADD COLUMN default_game TEXT;
UPDATE users SET default_game = 'lingo' WHERE default_game IS NULL;
-- Existing users should get default game 'lingo', but new users should have NULL
```

**Additional requirements:**
- Create seed data to demonstrate migration behavior
- Users created **after migration 1 but before migration 2** should have `default_game = 'lingo'`
- Users created **after migration 2** should have `default_game = NULL`
- Demonstrate that migrations run sequentially and idempotently

## 🎯 Solution Architecture

- **Prisma**: Used locally only to generate SQL migrations
- **Cloudflare Worker**: Single source of truth that applies migrations to production CockroachDB
- **Cloudflare KV**: Stores migration files
- **Cloudflare Hyperdrive**: Provides connection pooling to CockroachDB
- **GitHub Actions**: Automates deployment and migration triggers

### Flow:
1. Develop locally using Prisma + local CockroachDB to generate SQL migrations
2. CI uploads SQL files to KV and deploys the Worker
3. CI automatically pings the Worker after deployment
4. Worker applies pending migrations via Hyperdrive to production database

---

## ⚙️ Implementation Steps

### 0️⃣ Initial Setup

**Create project structure:**
```bash
mkdir -p src prisma .github/workflows
cd cf-worker-test-task
npm init -y
```

**Install dependencies:**
```bash
npm install pg
npm install -D @cloudflare/workers-types dotenv dotenv-cli prisma tsx typescript wrangler
```

**Create `package.json` with scripts:**
```json
{
  "name": "migration-worker",
  "version": "1.0.0",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "seed:before": "tsx prisma/seed-before.ts",
    "seed:after": "tsx prisma/seed-after.ts",
    "seed:before:prod": "dotenv -e .env.production -- tsx prisma/seed-before.ts",
    "seed:after:prod": "dotenv -e .env.production -- tsx prisma/seed-after.ts"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20240925.0",
    "dotenv": "^16.4.5",
    "dotenv-cli": "^7.4.2",
    "prisma": "^5.20.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "wrangler": "^3.78.0"
  },
  "dependencies": {
    "pg": "^8.13.0"
  }
}
```

**Create `tsconfig.json`:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "moduleResolution": "node",
    "resolveJsonModule": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*", "prisma/**/*"]
}
```

**Create `.gitignore`:**
```gitignore
# Environment
.env
.env.local
.env.production

# Dependencies
node_modules/

# Wrangler
.wrangler/
dist/

# Prisma
prisma/.env
```

**Project structure:**
```
cf-worker-test-task/
├── src/
│   └── worker.ts              # Worker code (Wrangler auto-compiles TS)
├── prisma/
│   ├── schema.prisma
│   ├── seed-before.ts
│   ├── seed-after.ts
│   └── migrations/            # Generated SQL files
├── .github/workflows/
│   └── deploy.yml
├── wrangler.toml
├── package.json
├── tsconfig.json
└── .gitignore
```

> **Note:** Wrangler has built-in TypeScript support via esbuild. You specify `main = "src/worker.ts"` directly in `wrangler.toml` - no separate build step needed!

---

### 1️⃣ Complete Workflow (Two Deployments)

This demonstrates a **realistic production workflow** with two separate deployments, testing migrations locally and in production.

---

#### 🚀 **Phase 1: First Migration + First Deployment**

**Step 1.1: Setup databases**

```bash
# Start local CockroachDB
docker run -d --name cockroach \
  -p 26257:26257 -p 8080:8080 \
  cockroachdb/cockroach:latest start-single-node --insecure

# Create local .env
cat > .env << EOF
DATABASE_URL="postgresql://root@localhost:26257/defaultdb?sslmode=disable"
EOF

# Create production .env (use your real CockroachDB Cloud credentials)
cat > .env.production << EOF
DATABASE_URL="postgresql://user:pass@host.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full"
EOF

# Initialize Prisma
npx prisma init
```

**Step 1.2: Create first migration locally**

Configure `prisma/schema.prisma`:
```prisma
datasource db {
  provider = "cockroachdb"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id String @id
}
```

Generate and test locally:
```bash
# Create migration
npx prisma migrate dev --name init

# Seed local DB (before second migration)
npm run seed:before  # Creates user1, user2, user3

# Verify locally
docker exec cockroach ./cockroach sql --insecure \
  -e "SELECT * FROM defaultdb.users"
```

**Step 1.3: Deploy first migration to production**

```bash
# Setup Cloudflare resources (first time only)
wrangler kv:namespace create MIGRATIONS
# Copy ID to wrangler.toml → [[kv_namespaces]].id

wrangler hyperdrive create cockroach \
  --connection-string="postgresql://user:pass@..."
# Copy ID to wrangler.toml → [[hyperdrive]].id

# Create all necessary files (worker.ts, wrangler.toml, deploy.yml, seed scripts)
# See sections 1️⃣.5, 2️⃣, 3️⃣, 4️⃣ below

# Git commit and push (triggers CI/CD)
git add .
git commit -m "feat: add first migration - create users table"
git push origin main
```

**Step 1.4: Seed production (after first migration deployed)**

```bash
# CI has deployed migration 1, now seed production
npm run seed:before:prod  # Creates user1, user2, user3 in production
```

✅ **Checkpoint:** Production DB has `users` table with user1, user2, user3 (no default_game column yet)

---

#### 🚀 **Phase 2: Second Migration + Second Deployment**

**Step 2.1: Create second migration locally**

Update `prisma/schema.prisma`:
```prisma
datasource db {
  provider = "cockroachdb"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id           String  @id
  default_game String?
}
```

Generate migration:
```bash
npx prisma migrate dev --name add_default_game
```

**Edit** `prisma/migrations/XXXXXX_add_default_game/migration.sql` to add UPDATE:
```sql
-- AlterTable
ALTER TABLE "users" ADD COLUMN "default_game" TEXT;

-- Set 'lingo' for existing users
UPDATE "users" SET "default_game" = 'lingo' WHERE "default_game" IS NULL;
```

Apply locally:
```bash
npx prisma migrate deploy

# Verify local users got 'lingo'
docker exec cockroach ./cockroach sql --insecure \
  -e "SELECT * FROM defaultdb.users ORDER BY id"
```

**Step 2.2: Test seed after second migration locally**

```bash
npm run seed:after  # Creates user4, user5

# Verify final state locally
docker exec cockroach ./cockroach sql --insecure \
  -e "SELECT * FROM defaultdb.users ORDER BY id"
```

Expected local result:
```
  id    | default_game
--------+-------------
 user1  | lingo       ← seeded before migration 2
 user2  | lingo       ← seeded before migration 2
 user3  | lingo       ← seeded before migration 2
 user4  | NULL        ← seeded after migration 2
 user5  | NULL        ← seeded after migration 2
```

**Step 2.3: Deploy second migration to production**

```bash
# Git commit and push (triggers CI/CD)
git add .
git commit -m "feat: add second migration - add default_game column"
git push origin main
```

**Step 2.4: Seed production (after second migration deployed)**

```bash
# CI has deployed migration 2, now seed production
npm run seed:after:prod  # Creates user4, user5 in production
```

✅ **Success!** Both local and production databases now have the correct state with two migrations applied sequentially!

---

### 1️⃣.5 Seed Scripts Implementation

Create **two separate seed files** as referenced in the workflow above.

**Create `prisma/seed-before.ts`:**
```typescript
import { Client } from "pg";
import "dotenv/config";

async function seedBefore() {
  const connectionString = process.env.DATABASE_URL;
  
  if (!connectionString) {
    throw new Error("DATABASE_URL not set");
  }

  const client = new Client({ connectionString });
  await client.connect();

  console.log("🌱 Seeding users BEFORE second migration...");
  console.log(`📍 Using: ${connectionString.replace(/:[^:@]+@/, ':****@')}`);
  
  await client.query("INSERT INTO users (id) VALUES ('user1')");
  await client.query("INSERT INTO users (id) VALUES ('user2')");
  await client.query("INSERT INTO users (id) VALUES ('user3')");
  console.log("✅ Created 3 users (default_game column doesn't exist yet)");

  const result = await client.query("SELECT * FROM users ORDER BY id");
  console.table(result.rows);

  await client.end();
}

seedBefore().catch(console.error);
```

**Create `prisma/seed-after.ts`:**
```typescript
import { Client } from "pg";
import "dotenv/config";

async function seedAfter() {
  const connectionString = process.env.DATABASE_URL;
  
  if (!connectionString) {
    throw new Error("DATABASE_URL not set");
  }

  const client = new Client({ connectionString });
  await client.connect();

  console.log("🌱 Seeding users AFTER second migration...");
  console.log(`📍 Using: ${connectionString.replace(/:[^:@]+@/, ':****@')}`);
  
  await client.query("INSERT INTO users (id) VALUES ('user4')");
  await client.query("INSERT INTO users (id) VALUES ('user5')");
  console.log("✅ Created 2 new users (should have default_game = NULL)");

  console.log("\n📊 Final state - all users:");
  const result = await client.query("SELECT * FROM users ORDER BY id");
  console.table(result.rows);

  await client.end();
}

seedAfter().catch(console.error);
```

**Environment files:**

Create `.env.production` for production seeding:
```bash
# .env.production (for CockroachDB Cloud)
DATABASE_URL="postgresql://user:pass@host.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full"
```

**NPM scripts** (will be in package.json):
```bash
npm run seed:before        # Local: uses .env
npm run seed:after         # Local: uses .env
npm run seed:before:prod   # Production: uses .env.production
npm run seed:after:prod    # Production: uses .env.production
```

---

### 2️⃣ Cloudflare Configuration

**Create `.gitignore`:**
```gitignore
# Environment files
.env
.env.local
.env.production

# Dependencies
node_modules/

# Wrangler
.wrangler/
dist/

# Prisma
prisma/.env
```

**Create `wrangler.toml`:**
```toml
name = "migration-worker"
main = "src/worker.ts"              # Wrangler auto-compiles TypeScript
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

[[kv_namespaces]]
binding = "MIGRATIONS"
id = "<namespace_id>"

[[hyperdrive]]
binding = "HYPERDRIVE"
id = "<hyperdrive_id>"
```

> **Note:** The `main` field points directly to `.ts` file. Wrangler uses built-in esbuild to compile TypeScript automatically during `wrangler dev` and `wrangler deploy`.

**Create KV namespace:**
```bash
wrangler kv:namespace create MIGRATIONS
```

This will output something like:
```
✨ Success!
Add the following to your configuration file:
{ binding = "MIGRATIONS", id = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6" }
```

Copy the `id` value and paste it into `wrangler.toml` in the `[[kv_namespaces]]` section.

**Create Hyperdrive connection:**
```bash
wrangler hyperdrive create cockroach \
  --connection-string="postgres://user:pass@host.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full"
```

This will output:
```
✨ Created new Hyperdrive config
 📋 ID: 1a2b3c4d5e6f7g8h9i0j
 📝 Name: cockroach
```

Copy the `ID` value and paste it into `wrangler.toml` in the `[[hyperdrive]]` section.

---

### 3️⃣ Worker Implementation

**Create `src/worker.ts`:**
```typescript
import { Client } from "pg";

export interface Env {
  MIGRATIONS: KVNamespace;
  HYPERDRIVE: { connectionString: string };
}

async function listKV(env: Env): Promise<string[]> {
  let keys: string[] = [];
  let cursor: string | undefined;
  do {
    const res = await env.MIGRATIONS.list({ cursor });
    keys.push(...res.keys.map(k => k.name));
    cursor = res.cursor;
  } while (cursor);
  return keys.sort();
}

async function applyMigrations(env: Env): Promise<void> {
  const client = new Client({ 
    connectionString: env.HYPERDRIVE.connectionString 
  });
  await client.connect();

  // Create migrations tracking table
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  // Get applied migrations
  const applied = new Set(
    (await client.query<{ id: string }>("SELECT id FROM _migrations"))
      .rows.map(r => r.id)
  );

  // Apply pending migrations
  for (const key of await listKV(env)) {
    if (applied.has(key)) continue;
    
    const sql = await env.MIGRATIONS.get(key);
    if (!sql) continue;

    console.log("Applying migration:", key);
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO _migrations (id) VALUES ($1)", [key]);
    await client.query("COMMIT");
  }

  await client.end();
}

export default {
  async fetch(_req: Request, env: Env): Promise<Response> {
    try {
      await applyMigrations(env);
      return new Response("✅ All migrations applied successfully");
    } catch (e: any) {
      return new Response("❌ Migration failed: " + e.message, { 
        status: 500 
      });
    }
  },
};
```

**Key features:**
- Connects to CockroachDB via Hyperdrive
- Maintains `_migrations` table to track applied migrations
- Applies only new SQL files from KV
- Idempotent and transactional

---

### 4️⃣ CI/CD with GitHub Actions

**Create `.github/workflows/deploy.yml`:**
```yaml
name: Deploy Migration Worker

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      
      - run: npm ci

      # Upload all migrations to KV
      - name: Upload migrations to KV
        run: |
          for f in $(find prisma/migrations -name "migration.sql"); do
            key=$(basename $(dirname "$f")).sql
            echo "→ Uploading $key"
            npx wrangler kv:key put --binding=MIGRATIONS "$key" "$(cat "$f")"
          done
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}

      # Deploy the Worker and capture URL dynamically
      - name: Deploy Worker
        id: deploy
        run: |
          npx wrangler deploy | tee deploy-output.txt
          URL=$(grep -oP 'https://[^\s]+\.workers\.dev' deploy-output.txt | head -1 || echo "")
          echo "worker_url=$URL" >> $GITHUB_OUTPUT
          if [ -n "$URL" ]; then
            echo "✅ Worker deployed at: $URL"
          fi
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}

      # Automatically trigger migrations using dynamic URL
      - name: Trigger migrations
        run: |
          if [ -n "${{ steps.deploy.outputs.worker_url }}" ]; then
            echo "🚀 Triggering migrations at ${{ steps.deploy.outputs.worker_url }}"
            curl -sf ${{ steps.deploy.outputs.worker_url }} || echo "⚠️ Migration trigger failed, will retry on next deploy"
          else
            echo "ℹ️ Worker URL not detected, skipping migration trigger"
          fi
```

**The CI pipeline:**
1. Uploads SQL migrations to KV
2. Deploys the Worker and extracts URL dynamically
3. Automatically pings the Worker to apply migrations

**Solving the "chicken and egg" problem:**

The dynamic URL extraction solves the issue where you need the Worker URL before it exists:
- First deploy: Worker is created, URL is extracted from wrangler output, migrations are triggered immediately
- Subsequent deploys: Same process works automatically
- No manual configuration of Worker URL needed

---

### 5️⃣ Required Secrets

**GitHub Repository Secrets:**
- `CF_API_TOKEN` - Cloudflare API token with Workers and KV permissions
- `CF_ACCOUNT_ID` - Your Cloudflare account ID

**Cloudflare Resources:**
- KV namespace for `MIGRATIONS`
- Hyperdrive connection to CockroachDB Cloud

---

## ✅ Result

| Stage | What Happens |
|-------|--------------|
| **Local setup** | Prisma + local CockroachDB → generate SQL migrations |
| **Migration 1** | `CREATE TABLE users (id TEXT PRIMARY KEY);` |
| **Seed (before)** | Create user1, user2, user3 (only with id column) |
| **Migration 2** | `ALTER TABLE users ADD COLUMN default_game TEXT;` + UPDATE to set 'lingo' |
| **Seed (after)** | Create user4, user5 (with default_game = NULL) |
| **Deploy** | CI uploads both SQL migration files to KV and deploys Worker |
| **URL extraction** | CI dynamically extracts Worker URL from deployment output |
| **Auto-trigger** | CI pings Worker → applies both migrations sequentially via Hyperdrive |
| **Result** | Production CockroachDB is updated, `_migrations` tracks both migrations |

**Final database state:**
| User ID | default_game | Created |
|---------|--------------|---------|
| user1   | lingo        | After migration 1, before migration 2 |
| user2   | lingo        | After migration 1, before migration 2 |
| user3   | lingo        | After migration 1, before migration 2 |
| user4   | NULL         | After migration 2 |
| user5   | NULL         | After migration 2 |

**Migration sequence:**
1. **Migration 1** runs → creates `users` table with `id` column only
2. **Seed before** runs → inserts user1, user2, user3 (no default_game column exists yet)
3. **Migration 2** runs → adds `default_game` column + UPDATE sets 'lingo' for existing users
4. **Seed after** runs → inserts user4, user5 (default_game = NULL by default)

---

## 💡 Key Benefits

- **Serverless-native**: No CLI binaries, no manual steps
- **Idempotent**: Safe to run multiple times
- **Automated**: Migrations apply automatically on every deployment
- **Self-configuring**: Worker URL is extracted dynamically, no hardcoding needed
- **Simple**: KISS principle - minimal moving parts
- **Auditable**: `_migrations` table tracks what was applied and when

---

## 🗣️ Explanation for the CTO

> "I've implemented the challenge with two separate migrations exactly as specified:
> 
> **Migration 1**: Creates the users table with only the id column (`CREATE TABLE users (id TEXT PRIMARY KEY)`).
> 
> **Migration 2**: Adds the default_game column (`ALTER TABLE users ADD COLUMN default_game TEXT`) with a custom UPDATE statement that sets 'lingo' for all existing users, ensuring new users get NULL by default.
> 
> I've created seed scripts that demonstrate the migration behavior: users created after the first migration but before the second get 'lingo', while users created after the second migration get NULL.
> 
> On every push, GitHub Actions uploads both migration files to Cloudflare KV, deploys the Worker, and automatically triggers it. The CI dynamically extracts the Worker URL from deployment output, solving the 'chicken and egg' problem without manual configuration. The Worker reads the KV migrations, checks the `_migrations` table in CockroachDB via Hyperdrive, and applies only missing ones sequentially and transactionally. This design is serverless-native, idempotent, and completely automated — no CLI binaries or manual steps required."

---

## 🚀 Quick Start

Follow the **complete workflow** in section **"1️⃣ Complete Workflow (Two Deployments)"**:

### Phase 1: First Migration
1. Setup local + production DBs (Step 1.1)
2. Create first migration locally (Step 1.2)
3. Git push → CI deploys migration 1 (Step 1.3)
4. Seed production with user1, user2, user3 (Step 1.4)

### Phase 2: Second Migration
1. Create second migration locally (Step 2.1)
2. Test with seed locally (Step 2.2)
3. Git push → CI deploys migration 2 (Step 2.3)
4. Seed production with user4, user5 (Step 2.4)

**Result:** Two deployments demonstrating sequential migration behavior in both local and production environments!

