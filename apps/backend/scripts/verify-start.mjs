import { spawn } from "node:child_process";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const child = spawn(process.execPath, ["dist/index.js"], {
  cwd: new URL("..", import.meta.url),
  stdio: ["ignore", "pipe", "pipe"]
});

let serverOutput = "";

child.stdout.on("data", (chunk) => {
  serverOutput += chunk.toString();
});

child.stderr.on("data", (chunk) => {
  serverOutput += chunk.toString();
});

async function waitForHealthcheck() {
  const timeoutAt = Date.now() + 10000;

  while (Date.now() < timeoutAt) {
    if (child.exitCode !== null) {
      throw new Error(`Backend exited early.\n${serverOutput}`);
    }

    try {
      const response = await fetch("http://localhost:4000/api/health");
      if (response.ok) {
        const body = await response.json();
        console.log("Backend health check passed:", body);
        return;
      }
    } catch {
      await delay(250);
    }
  }

  throw new Error(`Timed out waiting for backend health check.\n${serverOutput}`);
}

try {
  await waitForHealthcheck();
} finally {
  child.kill("SIGTERM");
  await delay(250);
}
