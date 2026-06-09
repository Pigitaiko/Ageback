// Public surface for the usage subsystem. Wires the store, keys, and router.

import { createUsageStore, utcDayKey } from "./store.js";
import { createKeyStore, generateKey, hashKey } from "./keys.js";
import { createUsageRouter, parseWindow } from "./router.js";

export { utcDayKey, generateKey, hashKey, parseWindow, createUsageStore, createKeyStore, createUsageRouter };

/**
 * Attach the /usage/* API to an Express app.
 *
 * @param {import('express').Application} app
 * @param {object} opts
 * @param {string} [opts.storePath]      JSON file path for per-day rollups (recommended)
 * @param {string} [opts.keysPath]       JSON file path for API key hashes
 * @param {string} [opts.envKeys]        Comma-separated raw API keys (env-seeded)
 * @param {string} [opts.basePath="/usage"]
 * @param {boolean} [opts.recordRequests=true]  Auto-install request counter middleware
 * @param {(req: import('express').Request) => boolean} [opts.classifyPaid]
 *        Predicate that returns true if the request was a paid x402 call.
 *        Default: presence of X-PAYMENT or Payment-Signature header AND response 2xx.
 *
 * @returns {Promise<{ store, keys, router, attachRequestRecorder }>}
 */
export async function attachUsageApi(app, opts = {}) {
  const basePath = opts.basePath || "/usage";
  const store = await createUsageStore({ path: opts.storePath, logger: opts.logger });
  const keys = await createKeyStore({
    path: opts.keysPath,
    envKeys: opts.envKeys || "",
    logger: opts.logger,
  });

  if (opts.recordRequests !== false) {
    app.use(makeRequestRecorder(store, opts));
  }

  const router = createUsageRouter({ store, auth: keys.authMiddleware() });
  app.use(basePath, router);

  return { store, keys, router, attachRequestRecorder: makeRequestRecorder };
}

/**
 * Express middleware that classifies every response as paid / rejected_402 / free
 * and records it in the store on `res.finish`.
 */
export function makeRequestRecorder(store, opts = {}) {
  const skipPaths = new Set(opts.skipPaths || ["/usage", "/.well-known/ageback.json", "/.well-known/x402"]);
  return (req, res, next) => {
    // Skip recording for the usage endpoints themselves to avoid polluting metrics.
    const p = req.path || "";
    for (const skip of skipPaths) {
      if (p.startsWith(skip)) return next();
    }
    res.on("finish", () => {
      try {
        const status = res.statusCode;
        const paid = !!(req.headers["x-payment"] || req.headers["payment-signature"]);
        let outcome;
        if (status === 402) outcome = "rejected_402";
        else if (paid && status >= 200 && status < 400) outcome = "paid";
        else outcome = "free";
        store.recordRequest({ outcome });
      } catch {
        // never crash the response on a recording failure
      }
    });
    next();
  };
}
