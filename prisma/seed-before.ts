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

