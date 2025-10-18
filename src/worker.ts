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
    
    // Split SQL by semicolons and execute each statement in separate transaction
    const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0 && !s.startsWith('--'));
    
    for (const statement of statements) {
      try {
        await client.query(statement);
      } catch (e: any) {
        // If it's a backfill error, wait and retry
        if (e.message?.includes('backfilled') || e.message?.includes('backfill')) {
          console.log("Waiting for backfill to complete, retrying in 2s...");
          await new Promise(resolve => setTimeout(resolve, 2000));
          await client.query(statement);
        } else {
          throw e;
        }
      }
    }
    
    // Record migration as applied
    await client.query("INSERT INTO _migrations (id, applied_at) VALUES ($1, now())", [key]);
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

