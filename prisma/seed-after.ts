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

