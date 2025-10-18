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

