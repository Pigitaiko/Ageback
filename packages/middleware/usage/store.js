// Per-day rollup store for the Ageback usage API.
//
// Data lives in a single JSON file (atomic write-then-rename), kept warm in
// memory. Writes are debounced; reads are O(days in window). Falls back to
// in-memory only if no path is configured (with a console warning), which is
// fine for testing but loses data on restart.

import { promises as fs } from "node:fs";
import path from "node:path";

const FLUSH_DELAY_MS = 1500;
const SCHEMA_VERSION = 1;

function emptyDay() {
  return {
    requests: { total: 0, paid: 0, rejected_402: 0, free: 0 },
    revenue: {
      totalUsd: 0,
      paymentCount: 0,
      payers: [],
      byProtocol: {},
      byEndpoint: {},
    },
    cashback: {
      count: 0,
      totalEth: 0,
      agents: [],
    },
  };
}

function emptyDb() {
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    cumulativePayers: [],
    days: {},
  };
}

export function utcDayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export async function createUsageStore({ path: filePath = null, logger = console } = {}) {
  let db = emptyDb();
  let dirty = false;
  let flushTimer = null;
  let writeChain = Promise.resolve();

  if (filePath) {
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && parsed.schemaVersion === SCHEMA_VERSION && parsed.days) {
        db = parsed;
        logger.log?.(`[usage] loaded ${Object.keys(db.days).length} days from ${filePath}`);
      }
    } catch (err) {
      if (err.code !== "ENOENT") {
        logger.warn?.(`[usage] could not read ${filePath}, starting fresh: ${err.message}`);
      }
    }
  } else {
    logger.warn?.("[usage] no path configured — running in-memory only (data lost on restart)");
  }

  function getDay(dayKey) {
    if (!db.days[dayKey]) db.days[dayKey] = emptyDay();
    return db.days[dayKey];
  }

  function scheduleFlush() {
    dirty = true;
    if (!filePath) return;
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush().catch((err) => logger.error?.(`[usage] flush failed: ${err.message}`));
    }, FLUSH_DELAY_MS);
  }

  async function flush() {
    if (!filePath || !dirty) return;
    dirty = false;
    writeChain = writeChain.then(async () => {
      const tmp = filePath + ".tmp";
      const data = JSON.stringify(db);
      await fs.writeFile(tmp, data, "utf8");
      await fs.rename(tmp, filePath);
    });
    return writeChain;
  }

  function recordRequest({ outcome, dayKey = utcDayKey() }) {
    // outcome: "paid" | "rejected_402" | "free"
    const day = getDay(dayKey);
    day.requests.total += 1;
    if (outcome === "paid") day.requests.paid += 1;
    else if (outcome === "rejected_402") day.requests.rejected_402 += 1;
    else day.requests.free += 1;
    scheduleFlush();
  }

  function recordPayment({
    payer,
    usd,
    protocol = "x402",
    endpoint,
    dayKey = utcDayKey(),
  }) {
    const day = getDay(dayKey);
    const amt = Number(usd) || 0;

    day.revenue.totalUsd = round6(day.revenue.totalUsd + amt);
    day.revenue.paymentCount += 1;

    const payerLc = (payer || "").toLowerCase();
    if (payerLc && !day.revenue.payers.includes(payerLc)) {
      day.revenue.payers.push(payerLc);
    }
    if (payerLc && !db.cumulativePayers.includes(payerLc)) {
      db.cumulativePayers.push(payerLc);
    }

    const byProto = day.revenue.byProtocol[protocol] || { totalUsd: 0, count: 0 };
    byProto.totalUsd = round6(byProto.totalUsd + amt);
    byProto.count += 1;
    day.revenue.byProtocol[protocol] = byProto;

    if (endpoint) {
      const byEp = day.revenue.byEndpoint[endpoint] || { totalUsd: 0, count: 0 };
      byEp.totalUsd = round6(byEp.totalUsd + amt);
      byEp.count += 1;
      day.revenue.byEndpoint[endpoint] = byEp;
    }
    scheduleFlush();
  }

  function recordCashback({ agent, eth, dayKey = utcDayKey() }) {
    const day = getDay(dayKey);
    const amt = Number(eth) || 0;
    day.cashback.count += 1;
    day.cashback.totalEth = round8(day.cashback.totalEth + amt);
    const agentLc = (agent || "").toLowerCase();
    if (agentLc && !day.cashback.agents.includes(agentLc)) {
      day.cashback.agents.push(agentLc);
    }
    scheduleFlush();
  }

  function aggregate({ startDay, endDayExclusive }) {
    const out = {
      requests: { total: 0, paid: 0, rejected_402: 0, free: 0 },
      revenue: {
        totalUsd: 0,
        paymentCount: 0,
        payersInWindow: new Set(),
        byProtocol: {},
        byEndpoint: {},
      },
      cashback: { count: 0, totalEth: 0, agentsInWindow: new Set() },
    };

    for (const [day, bucket] of Object.entries(db.days)) {
      if (day < startDay || day >= endDayExclusive) continue;

      out.requests.total += bucket.requests.total;
      out.requests.paid += bucket.requests.paid;
      out.requests.rejected_402 += bucket.requests.rejected_402;
      out.requests.free += bucket.requests.free;

      out.revenue.totalUsd = round6(out.revenue.totalUsd + bucket.revenue.totalUsd);
      out.revenue.paymentCount += bucket.revenue.paymentCount;
      for (const p of bucket.revenue.payers) out.revenue.payersInWindow.add(p);

      for (const [k, v] of Object.entries(bucket.revenue.byProtocol)) {
        const cur = out.revenue.byProtocol[k] || { totalUsd: 0, count: 0 };
        cur.totalUsd = round6(cur.totalUsd + v.totalUsd);
        cur.count += v.count;
        out.revenue.byProtocol[k] = cur;
      }
      for (const [k, v] of Object.entries(bucket.revenue.byEndpoint)) {
        const cur = out.revenue.byEndpoint[k] || { totalUsd: 0, count: 0 };
        cur.totalUsd = round6(cur.totalUsd + v.totalUsd);
        cur.count += v.count;
        out.revenue.byEndpoint[k] = cur;
      }

      out.cashback.count += bucket.cashback.count;
      out.cashback.totalEth = round8(out.cashback.totalEth + bucket.cashback.totalEth);
      for (const a of bucket.cashback.agents) out.cashback.agentsInWindow.add(a);
    }
    return out;
  }

  function firstTimePayersInWindow({ startDay, endDayExclusive }) {
    // A payer is "first-time in window" if their FIRST paying day falls within [startDay, endDayExclusive).
    const firstSeen = {};
    const sortedDays = Object.keys(db.days).sort();
    for (const day of sortedDays) {
      for (const p of db.days[day].revenue.payers) {
        if (firstSeen[p] === undefined) firstSeen[p] = day;
      }
    }
    return Object.entries(firstSeen)
      .filter(([, day]) => day >= startDay && day < endDayExclusive)
      .map(([p]) => p);
  }

  function cumulativePayers() {
    return db.cumulativePayers.slice();
  }

  function snapshot() {
    return db;
  }

  async function close() {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    await flush();
    await writeChain;
  }

  return {
    recordRequest,
    recordPayment,
    recordCashback,
    aggregate,
    firstTimePayersInWindow,
    cumulativePayers,
    snapshot,
    flush,
    close,
  };
}

function round6(n) { return Math.round(n * 1e6) / 1e6; }
function round8(n) { return Math.round(n * 1e8) / 1e8; }
