#!/usr/bin/env node
// CLI for managing usage API keys.
// Usage:
//   node scripts/usage-key.js create <name>      Generate a new key (prints once)
//   node scripts/usage-key.js import <name>      Import existing key from stdin
//   node scripts/usage-key.js revoke <name>      Revoke a key by name
//   node scripts/usage-key.js list                List all keys (hashes not shown)
//
// Requires USAGE_KEYS_PATH (default: ./data/keys.json).

import "dotenv/config";
import { createKeyStore } from "@ageback/middleware";
import readline from "node:readline";

const keysPath = process.env.USAGE_KEYS_PATH || "./data/keys.json";

const cmd = process.argv[2];
const name = process.argv[3];

async function readStdinLine() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin });
    rl.once("line", (line) => { rl.close(); resolve(line.trim()); });
  });
}

async function main() {
  const store = await createKeyStore({ path: keysPath });

  switch (cmd) {
    case "create": {
      if (!name) return usageError("name required");
      const { apiKey } = await store.createKey(name);
      console.log(JSON.stringify({ name, apiKey }, null, 2));
      console.log("\nSave this key — it will NOT be shown again.");
      break;
    }
    case "import": {
      if (!name) return usageError("name required");
      const raw = await readStdinLine();
      const res = await store.importKey(name, raw);
      console.log(JSON.stringify(res, null, 2));
      break;
    }
    case "revoke": {
      if (!name) return usageError("name required");
      const res = await store.revokeKey(name);
      console.log(JSON.stringify(res, null, 2));
      break;
    }
    case "list": {
      console.log(JSON.stringify(store.listKeys(), null, 2));
      break;
    }
    default:
      return usageError("unknown command");
  }
}

function usageError(msg) {
  console.error("error:", msg);
  console.error("\nusage:");
  console.error("  node scripts/usage-key.js create <name>");
  console.error("  node scripts/usage-key.js import <name>   (raw key on stdin)");
  console.error("  node scripts/usage-key.js revoke <name>");
  console.error("  node scripts/usage-key.js list");
  process.exit(1);
}

main().catch((err) => {
  console.error("failed:", err.message);
  process.exit(1);
});
