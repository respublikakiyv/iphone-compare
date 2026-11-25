import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const statePath = process.env.RENDER_STATE_PATH || "/var/data";
const vars = ["TELEGRAM_BOT_TOKEN", "SYNC_WORKER_KEY", "MOYSKLAD_TOKEN", "MOYSKLAD_WEBHOOK_SECRET"]
  .flatMap((key) => (process.env[key] ? ["--var", `${key}:${process.env[key]}`] : []));

const child = spawn(
  process.execPath,
  [
    path.join(root, "node_modules/wrangler/bin/wrangler.js"),
    "dev",
    "--config", path.join(root, "dist/server/wrangler.json"),
    "--local",
    "--persist-to", statePath,
    "--ip", "0.0.0.0",
    "--port", process.env.PORT || "10000",
    "--inspector-port", "0",
    ...vars,
  ],
  { stdio: "inherit", env: process.env },
);

child.on("exit", (code) => process.exit(code ?? 1));
