# 📋 Step-by-Step Instructions

Complete guide to implement the Cloudflare Worker migration system from scratch.

---

## ✅ Prerequisites

- [ ] Node.js 20+ installed
- [ ] Docker installed (for local CockroachDB)
- [ ] Git installed
- [ ] GitHub account
- [ ] Cloudflare account
- [ ] CockroachDB Cloud account (free tier is fine)

---

## 📦 Phase 0: Project Initialization

### Step 1: Create project directory
```bash
mkdir cf-worker-test-task
cd cf-worker-test-task
git init
```

### Step 2: Create folder structure
```bash
mkdir -p src prisma .github/workflows
```

### Step 3: Initialize npm and install dependencies
```bash
npm init -y
npm install pg
npm install -D @cloudflare/workers-types dotenv dotenv-cli prisma tsx typescript wrangler
```

### Step 4: Create `package.json` with scripts

Edit `package.json` to add scripts section:
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

### Step 5: Create `tsconfig.json`

Create `tsconfig.json`:
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

### Step 6: Create `.gitignore`

Create `.gitignore`:
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

---

## 🗄️ Phase 1: Setup Databases

### Step 7: Start local CockroachDB
```bash
docker run -d --name cockroach \
  -p 26257:26257 -p 8080:8080 \
  cockroachdb/cockroach:latest start-single-node --insecure
```

Verify it's running:
```bash
docker ps | grep cockroach
```

### Step 8: Setup CockroachDB Cloud

1. Go to https://cockroachlabs.cloud/
2. Sign up / Log in
3. Create a new cluster (free tier)
4. Create a database called `defaultdb` (or use existing)
5. Create SQL user with password
6. Get connection string (should look like):
   ```
   postgresql://username:password@host.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full
   ```
7. **Save this connection string** - you'll need it multiple times!

### Step 9: Create environment files

Create `.env` (for local):
```bash
cat > .env << 'EOF'
DATABASE_URL="postgresql://root@localhost:26257/defaultdb?sslmode=disable"
EOF
```

Create `.env.production` (use your real CockroachDB Cloud credentials):
```bash
cat > .env.production << 'EOF'
DATABASE_URL="postgresql://username:password@host.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full"
EOF
```

---

## 🔄 Phase 2: First Migration

### Step 10: Initialize Prisma
```bash
npx prisma init
```

This creates `prisma/schema.prisma`.

### Step 11: Configure Prisma schema (first version - only id)

Edit `prisma/schema.prisma`:
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

### Step 12: Create first migration
```bash
npx prisma migrate dev --name init
```

This creates `prisma/migrations/XXXXXX_init/migration.sql` with:
```sql
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    PRIMARY KEY ("id")
);
```

### Step 13: Create seed-before script

Create `prisma/seed-before.ts`:
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

### Step 14: Create seed-after script

Create `prisma/seed-after.ts`:
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

### Step 15: Test first migration locally
```bash
# Seed local database (before second migration)
npm run seed:before

# Verify
docker exec cockroach ./cockroach sql --insecure \
  -e "SELECT * FROM defaultdb.users"
```

You should see user1, user2, user3 with only `id` column.

---

## ☁️ Phase 3: Setup Cloudflare Resources

### Step 16: Login to Wrangler
```bash
npx wrangler login
```

This opens a browser to authorize Wrangler.

### Step 17: Create KV namespace
```bash
npx wrangler kv:namespace create MIGRATIONS
```

**Output example:**
```
✨ Success!
Add the following to your configuration file:
{ binding = "MIGRATIONS", id = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6" }
```

**Copy the ID** (e.g., `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6`)

### Step 18: Create Hyperdrive connection

Use your CockroachDB Cloud connection string:
```bash
npx wrangler hyperdrive create cockroach \
  --connection-string="postgresql://username:password@host.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full"
```

**Output example:**
```
✨ Created new Hyperdrive config
 📋 ID: 1a2b3c4d5e6f7g8h9i0j
 📝 Name: cockroach
```

**Copy the ID** (e.g., `1a2b3c4d5e6f7g8h9i0j`)

### Step 19: Create `wrangler.toml`

Create `wrangler.toml` and paste the IDs from steps 17 and 18:
```toml
name = "migration-worker"
main = "src/worker.ts"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

[[kv_namespaces]]
binding = "MIGRATIONS"
id = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"  # ← Paste KV namespace ID here

[[hyperdrive]]
binding = "HYPERDRIVE"
id = "1a2b3c4d5e6f7g8h9i0j"  # ← Paste Hyperdrive ID here
```

---

## 🛠️ Phase 4: Create Worker Code

### Step 20: Create Worker

Create `src/worker.ts`:
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

---

## 🚀 Phase 5: Setup GitHub Actions

### Step 21: Get Cloudflare credentials

1. Go to https://dash.cloudflare.com/profile/api-tokens
2. Click "Create Token"
3. Use template "Edit Cloudflare Workers"
4. Or create custom token with permissions:
   - Account → Workers KV Storage → Edit
   - Account → Workers Scripts → Edit
5. **Copy the token** (you can only see it once!)

Get your Account ID:
1. Go to https://dash.cloudflare.com/
2. Select any site or go to Workers & Pages
3. Copy **Account ID** from the right sidebar

### Step 22: Add GitHub Secrets

1. Go to your GitHub repository
2. Settings → Secrets and variables → Actions
3. Click "New repository secret"
4. Add two secrets:
   - Name: `CF_API_TOKEN`, Value: (token from step 21)
   - Name: `CF_ACCOUNT_ID`, Value: (account ID from step 21)

### Step 23: Create GitHub Actions workflow

Create `.github/workflows/deploy.yml`:
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

---

## 🎯 Phase 6: First Deployment

### Step 24: Push to GitHub

```bash
git add .
git commit -m "feat: add first migration - create users table"
git push origin main
```

### Step 25: Watch GitHub Actions

1. Go to your GitHub repository
2. Click "Actions" tab
3. Watch the workflow run
4. It should:
   - Upload migration to KV
   - Deploy Worker
   - Trigger migration automatically

### Step 26: Verify Worker deployed

Check the Actions log for the Worker URL (something like):
```
✅ Worker deployed at: https://migration-worker.yourname.workers.dev
```

### Step 27: Seed production database (first batch)

```bash
npm run seed:before:prod
```

You should see:
```
🌱 Seeding users BEFORE second migration...
✅ Created 3 users
```

### Step 28: Verify production database

You can verify in CockroachDB Cloud console:
1. Go to your CockroachDB Cloud cluster
2. Open SQL Shell
3. Run:
```sql
SELECT * FROM users;
```

You should see user1, user2, user3 with only `id` column.

---

## 🔄 Phase 7: Second Migration

### Step 29: Update Prisma schema (add default_game)

Edit `prisma/schema.prisma`:
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

### Step 30: Generate second migration
```bash
npx prisma migrate dev --name add_default_game
```

### Step 31: Edit second migration to add UPDATE

Find the file `prisma/migrations/XXXXXX_add_default_game/migration.sql` and edit it:

**Original (generated by Prisma):**
```sql
-- AlterTable
ALTER TABLE "users" ADD COLUMN "default_game" TEXT;
```

**Updated (add UPDATE statement):**
```sql
-- AlterTable
ALTER TABLE "users" ADD COLUMN "default_game" TEXT;

-- Set 'lingo' for existing users
UPDATE "users" SET "default_game" = 'lingo' WHERE "default_game" IS NULL;
```

### Step 32: Apply second migration locally
```bash
npx prisma migrate deploy
```

### Step 33: Verify local users got 'lingo'
```bash
docker exec cockroach ./cockroach sql --insecure \
  -e "SELECT * FROM defaultdb.users ORDER BY id"
```

You should see:
```
  id    | default_game
--------+-------------
 user1  | lingo
 user2  | lingo
 user3  | lingo
```

### Step 34: Seed local database (second batch)
```bash
npm run seed:after
```

### Step 35: Verify final local state
```bash
docker exec cockroach ./cockroach sql --insecure \
  -e "SELECT * FROM defaultdb.users ORDER BY id"
```

You should see:
```
  id    | default_game
--------+-------------
 user1  | lingo
 user2  | lingo
 user3  | lingo
 user4  | NULL
 user5  | NULL
```

✅ Perfect! Local testing complete.

---

## 🚀 Phase 8: Second Deployment

### Step 36: Push second migration to GitHub

```bash
git add .
git commit -m "feat: add second migration - add default_game column"
git push origin main
```

### Step 37: Watch GitHub Actions again

1. Go to "Actions" tab in GitHub
2. Watch the second workflow run
3. It should:
   - Upload **both** migrations to KV (init + add_default_game)
   - Deploy Worker
   - Trigger migrations (it will apply only the second one since first is already applied)

### Step 38: Seed production database (second batch)

```bash
npm run seed:after:prod
```

### Step 39: Verify final production state

In CockroachDB Cloud SQL Shell:
```sql
SELECT * FROM users ORDER BY id;
```

Expected result:
```
  id    | default_game
--------+-------------
 user1  | lingo
 user2  | lingo
 user3  | lingo
 user4  | NULL
 user5  | NULL
```

---

## ✅ Verification Checklist

- [ ] Local CockroachDB has 5 users with correct default_game values
- [ ] Production CockroachDB has 5 users with correct default_game values
- [ ] user1, user2, user3 have `default_game = 'lingo'`
- [ ] user4, user5 have `default_game = NULL`
- [ ] GitHub Actions runs successfully
- [ ] Worker is accessible at URL
- [ ] `_migrations` table exists in production DB
- [ ] `_migrations` table has 2 records (init and add_default_game)

---

## 🎉 Success!

You've successfully implemented:
- ✅ Cloudflare Worker for automated migrations
- ✅ Two separate migrations with different behavior
- ✅ CockroachDB integration via Hyperdrive
- ✅ KV storage for migration files
- ✅ CI/CD with GitHub Actions
- ✅ Seed data demonstrating migration behavior
- ✅ Idempotent, transactional migrations

The system is production-ready and will automatically apply any new migrations on every deployment!

---

## 🔧 Troubleshooting

### Worker fails to connect to database
- Check Hyperdrive connection string is correct
- Verify CockroachDB Cloud allows connections
- Check firewall settings in CockroachDB Cloud

### Migration fails
- Check `_migrations` table in database
- View Worker logs in Cloudflare dashboard
- Verify SQL syntax in migration files

### GitHub Actions fails
- Verify `CF_API_TOKEN` and `CF_ACCOUNT_ID` secrets are set
- Check token has correct permissions
- Verify wrangler.toml has correct KV and Hyperdrive IDs

### Seed scripts fail
- Verify `.env` or `.env.production` exists and has correct DATABASE_URL
- Check database is accessible
- Verify users table exists

