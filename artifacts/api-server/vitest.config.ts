import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";

// PRIVATE/app_db.json 에서 DATABASE_URL 주입 (테스트는 운영 Neon에 SELECT만 수행)
const cfgPath = path.resolve(__dirname, "../../PRIVATE/app_db.json");
const cfg = fs.existsSync(cfgPath)
  ? JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as { database_url?: string }
  : {};

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30000,
    hookTimeout: 30000,
    include: ["tests/**/*.test.ts"],
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? cfg.database_url ?? "",
    },
  },
});
