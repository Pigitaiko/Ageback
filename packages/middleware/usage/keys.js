// API key management for the Ageback usage API.
//
// Keys look like `ageback_<22 chars base32-ish>`. Storage holds only the
// sha256 of each key — the raw value is shown exactly once at creation time.
// Keys can be loaded from a JSON file (preferred, supports rotation/revoke)
// or seeded via the AGEBACK_USAGE_API_KEYS env var (comma-separated raw keys,
// useful for ephemeral deploys without persistent disk).

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const KEY_PREFIX = "ageback_";

export function generateKey() {
  // 16 random bytes -> 26 base32 chars (no padding). Plenty of entropy.
  const bytes = crypto.randomBytes(16);
  const raw = bytes.toString("base64url").replace(/[_-]/g, "").slice(0, 22);
  return KEY_PREFIX + raw;
}

export function hashKey(raw) {
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

function emptyDb() {
  return { schemaVersion: 1, keys: [] };
}

export async function createKeyStore({ path: filePath = null, envKeys = "", logger = console } = {}) {
  let db = emptyDb();
  let writeChain = Promise.resolve();

  if (filePath) {
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.keys)) {
        db = { schemaVersion: parsed.schemaVersion || 1, keys: parsed.keys };
      }
    } catch (err) {
      if (err.code !== "ENOENT") {
        logger.warn?.(`[usage] keys: could not read ${filePath}, starting fresh: ${err.message}`);
      }
    }
  }

  // Seed env-supplied keys (raw values). Useful for ephemeral deploys.
  const envSeed = (envKeys || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.startsWith(KEY_PREFIX));
  for (const raw of envSeed) {
    const hash = hashKey(raw);
    if (!db.keys.find((k) => k.hash === hash)) {
      db.keys.push({
        id: "k_env_" + hash.slice(0, 8),
        name: "env-seed",
        hash,
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
        revokedAt: null,
      });
    }
  }

  async function persist() {
    if (!filePath) return;
    writeChain = writeChain.then(async () => {
      const tmp = filePath + ".tmp";
      await fs.writeFile(tmp, JSON.stringify(db, null, 2), "utf8");
      await fs.rename(tmp, filePath);
    });
    return writeChain;
  }

  function listKeys() {
    return db.keys.map((k) => ({
      id: k.id,
      name: k.name,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
      revokedAt: k.revokedAt,
    }));
  }

  async function createKey(name) {
    if (!name || typeof name !== "string") throw new Error("name required");
    const raw = generateKey();
    const hash = hashKey(raw);
    const entry = {
      id: "k_" + crypto.randomBytes(4).toString("hex"),
      name,
      hash,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      revokedAt: null,
    };
    db.keys.push(entry);
    await persist();
    return { name, apiKey: raw, id: entry.id };
  }

  async function importKey(name, raw) {
    if (!raw.startsWith(KEY_PREFIX)) throw new Error(`key must start with "${KEY_PREFIX}"`);
    const hash = hashKey(raw);
    if (db.keys.find((k) => k.hash === hash)) {
      return { imported: false, reason: "already present" };
    }
    const entry = {
      id: "k_" + crypto.randomBytes(4).toString("hex"),
      name,
      hash,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      revokedAt: null,
    };
    db.keys.push(entry);
    await persist();
    return { imported: true, id: entry.id, name };
  }

  async function revokeKey(name) {
    const k = db.keys.find((k) => k.name === name && !k.revokedAt);
    if (!k) return { revoked: false, reason: "not found or already revoked" };
    k.revokedAt = new Date().toISOString();
    await persist();
    return { revoked: true, id: k.id, name };
  }

  function verifyRaw(raw) {
    if (!raw || !raw.startsWith(KEY_PREFIX)) return null;
    const hash = hashKey(raw);
    const found = db.keys.find((k) => k.hash === hash && !k.revokedAt);
    if (!found) return null;
    found.lastUsedAt = new Date().toISOString();
    // touch persist but don't await — auth path should be fast
    persist().catch(() => {});
    return { id: found.id, name: found.name };
  }

  function extractFromReq(req) {
    const apiKey = req.headers["x-api-key"];
    if (apiKey && typeof apiKey === "string") return apiKey.trim();
    const auth = req.headers["authorization"];
    if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "").trim();
    return null;
  }

  function authMiddleware() {
    return (req, res, next) => {
      const raw = extractFromReq(req);
      if (!raw) return res.status(401).json({ error: "unauthorized", message: "missing api key" });
      const found = verifyRaw(raw);
      if (!found) return res.status(401).json({ error: "unauthorized", message: "invalid or revoked api key" });
      req.usageApiKey = found;
      next();
    };
  }

  return {
    listKeys,
    createKey,
    importKey,
    revokeKey,
    verifyRaw,
    extractFromReq,
    authMiddleware,
  };
}
