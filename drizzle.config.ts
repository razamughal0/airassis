import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load the same env files the app loads, so `npx drizzle-kit push` always
// targets the database named in your .env (no hardcoded database name).
for (const fileName of [".env.local", ".env"]) {
  const filePath = path.join(process.cwd(), fileName);
  if (fs.existsSync(filePath)) dotenv.config({ path: filePath, override: false });
}

const url = process.env.DATABASE_URL?.trim();

if (!url) {
  throw new Error(
    "DATABASE_URL is not set.\nCreate a .env file (Copy-Item .env.example .env) and set:\n" +
      "DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/air_university_kb",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
  strict: false,
  verbose: true,
});
