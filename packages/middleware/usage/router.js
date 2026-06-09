// /usage/* router. Window control follows UTC day boundaries with start
// (inclusive) and end (exclusive).
//
// All endpoints respond with Cache-Control: no-store, are JSON, and require
// an authenticated API key (X-API-Key or Authorization: Bearer).
//
// Endpoints:
//   GET /usage/summary    — full payload (window, revenue, requests, cashback, wallets)
//   GET /usage/revenue    — revenue object only
//   GET /usage/requests   — request counts only
//   GET /usage/wallets    — payer stats only
//   GET /usage/cashback   — cashback allocations (Ageback-specific replacement for /usage/pins)

import express from "express";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_WINDOW_DAYS = 366;
const DEFAULT_LOOKBACK_DAYS = 6; // default window: today + 6 prior days

function utcDayKey(d) {
  return d.toISOString().slice(0, 10);
}

function parseDayKey(s) {
  if (!DAY_RE.test(s)) return null;
  const d = new Date(s + "T00:00:00Z");
  if (isNaN(d.getTime())) return null;
  return d;
}

function addDays(d, days) {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

export function parseWindow(query) {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const defaultEnd = addDays(today, 1); // tomorrow, exclusive
  const defaultStart = addDays(today, -DEFAULT_LOOKBACK_DAYS);

  const startStr = query.start;
  const endStr = query.end;

  let start = defaultStart;
  let end = defaultEnd;

  if (startStr) {
    const d = parseDayKey(startStr);
    if (!d) return { error: "start must be YYYY-MM-DD (UTC day)" };
    start = d;
  }
  if (endStr) {
    const d = parseDayKey(endStr);
    if (!d) return { error: "end must be YYYY-MM-DD (UTC day)" };
    end = d;
  }
  if (start.getTime() >= end.getTime()) {
    return { error: "start must be strictly before end" };
  }
  const spanDays = Math.round((end - start) / 86_400_000);
  if (spanDays > MAX_WINDOW_DAYS) {
    return { error: `window too large: ${spanDays} days (max ${MAX_WINDOW_DAYS})` };
  }
  return {
    start,
    end,
    startDay: utcDayKey(start),
    endDayExclusive: utcDayKey(end),
  };
}

function buildSummary(store, window) {
  const agg = store.aggregate({ startDay: window.startDay, endDayExclusive: window.endDayExclusive });
  const firstTimePayers = store.firstTimePayersInWindow({
    startDay: window.startDay,
    endDayExclusive: window.endDayExclusive,
  });
  const cumulative = store.cumulativePayers();

  return {
    window: {
      start: window.start.toISOString(),
      end: window.end.toISOString(),
      startDay: window.startDay,
      endDayExclusive: window.endDayExclusive,
    },
    generatedAt: new Date().toISOString(),
    revenue: {
      totalUsd: agg.revenue.totalUsd,
      paymentCount: agg.revenue.paymentCount,
      uniquePayers: agg.revenue.payersInWindow.size,
      byProtocol: agg.revenue.byProtocol,
      byEndpoint: agg.revenue.byEndpoint,
    },
    requests: agg.requests,
    cashback: {
      allocated: {
        count: agg.cashback.count,
        totalEth: agg.cashback.totalEth,
      },
      recipients: {
        uniqueInWindow: agg.cashback.agentsInWindow.size,
      },
    },
    wallets: {
      payersInWindow: agg.revenue.payersInWindow.size,
      cumulativePayers: cumulative.length,
      firstTimePayersInWindow: firstTimePayers,
    },
  };
}

export function createUsageRouter({ store, auth }) {
  const router = express.Router();

  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  if (auth) router.use(auth);

  function withWindow(handler) {
    return (req, res) => {
      const w = parseWindow(req.query || {});
      if (w.error) return res.status(400).json({ error: "bad_request", message: w.error });
      try {
        return handler(req, res, w);
      } catch (err) {
        return res.status(500).json({ error: "internal", message: err.message });
      }
    };
  }

  router.get("/summary", withWindow((req, res, w) => {
    res.json(buildSummary(store, w));
  }));

  router.get("/revenue", withWindow((req, res, w) => {
    res.json(buildSummary(store, w).revenue);
  }));

  router.get("/requests", withWindow((req, res, w) => {
    res.json(buildSummary(store, w).requests);
  }));

  router.get("/wallets", withWindow((req, res, w) => {
    res.json(buildSummary(store, w).wallets);
  }));

  router.get("/cashback", withWindow((req, res, w) => {
    res.json(buildSummary(store, w).cashback);
  }));

  return router;
}
