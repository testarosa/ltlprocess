import { app } from "./app.js";
import { config } from "./config.js";
import { initializeDatabase } from "./db.js";
import { seedDemoData } from "./seed.js";

async function main(): Promise<void> {
  await initializeDatabase();
  if (config.seedDemoData) await seedDemoData();
  app.listen(config.backendPort, "127.0.0.1", () => {
    console.log(`Backend listening on http://127.0.0.1:${config.backendPort}`);
  });
}

void main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`Backend startup failed: ${detail}`);
  process.exitCode = 1;
});
