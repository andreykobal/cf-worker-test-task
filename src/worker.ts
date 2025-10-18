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

async function applyMigrations(env: Env): Promise<string[]> {
  const logs: string[] = [];
  const log = (msg: string) => {
    console.log(msg);
    logs.push(msg);
  };

  const client = new Client({ 
    connectionString: env.HYPERDRIVE.connectionString 
  });
  await client.connect();

  log("🔌 Connected to database");

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
  log("📋 Already applied: " + JSON.stringify(Array.from(applied)));

  // Get all migrations from KV
  const allKeys = await listKV(env);
  log("📦 Migrations in KV: " + JSON.stringify(allKeys));

  // Apply pending migrations
  for (const key of allKeys) {
    if (applied.has(key)) {
      log(`⏭️  Skipping ${key} (already applied)`);
      continue;
    }
    
    const sql = await env.MIGRATIONS.get(key);
    if (!sql) {
      log(`⚠️  No SQL found for ${key}`);
      continue;
    }

    log(`🚀 Applying migration: ${key}`);
    log(`📝 SQL length: ${sql.length} chars`);
    
    // Remove comment-only lines, then split by semicolons
    const cleanedSql = sql
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n');
    
    const statements = cleanedSql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    
    log(`📊 Found ${statements.length} statements to execute`);
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      log(`▶️  Executing statement ${i + 1}/${statements.length}`);
      log(`   SQL: ${statement.substring(0, 100)}...`);
      
      try {
        const result = await client.query(statement);
        log(`   ✅ Success (rows affected: ${result.rowCount || 0})`);
      } catch (e: any) {
        log(`   ❌ Error: ${e.message}`);
        
        // If it's a backfill error, wait and retry
        if (e.message?.includes('backfilled') || e.message?.includes('backfill')) {
          log("   ⏳ Waiting for backfill to complete, retrying in 2s...");
          await new Promise(resolve => setTimeout(resolve, 2000));
          try {
            const retryResult = await client.query(statement);
            log(`   ✅ Retry success (rows affected: ${retryResult.rowCount || 0})`);
          } catch (retryError: any) {
            log(`   ❌ Retry also failed: ${retryError.message}`);
            throw retryError;
          }
        } else {
          throw e;
        }
      }
    }
    
    // Record migration as applied
    await client.query("INSERT INTO _migrations (id, applied_at) VALUES ($1, now())", [key]);
    log(`✅ Migration ${key} recorded as applied`);
  }

  log("🎉 All migrations processed");
  await client.end();
  return logs;
}

export default {
  async fetch(_req: Request, env: Env): Promise<Response> {
    try {
      const logs = await applyMigrations(env);
      return new Response(
        "✅ All migrations applied successfully\n\n" +
        "📋 Execution Log:\n" +
        logs.join("\n"),
        { headers: { "Content-Type": "text/plain" } }
      );
    } catch (e: any) {
      return new Response(
        "❌ Migration failed: " + e.message + "\n" + 
        (e.stack || ""),
        { status: 500, headers: { "Content-Type": "text/plain" } }
      );
    }
  },
};

