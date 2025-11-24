// pages/api/prices.js
// Next.js API route: price proxy + in-memory cache for Alpha Vantage
// Usage: GET /api/prices?symbols=AAPL,TSLA
// IMPORTANT: Set ALPHA_API_KEY in Vercel env (server-only; DO NOT expose as NEXT_PUBLIC_)

const API_KEY = process.env.ALPHA_API_KEY;
const DEFAULT_TTL = Number(process.env.PRICE_CACHE_TTL || 60); // seconds

globalThis._priceCache = globalThis._priceCache || {};

async function fetchAlphaPrice(symbol) {
  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  const data = await res.json();
  const quote = data['Global Quote'] || {};
  const priceStr = quote['05. price'] || quote['05. Price'] || null;
  const price = priceStr ? parseFloat(priceStr) : null;
  if (!price || !isFinite(price)) throw new Error('no-price');
  return { price, raw: data };
}

export default async function handler(req, res) {
  if (!API_KEY) {
    return res.status(500).json({ error: 'Server misconfigured: missing ALPHA_API_KEY' });
  }

  const q = (req.query.symbols || req.query.symbol || '').toString();
  if (!q) return res.status(400).json({ error: 'Provide symbols query, e.g. ?symbols=AAPL,TSLA' });

  const symbols = Array.from(new Set(q.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)));
  const now = Date.now();
  const ttl = DEFAULT_TTL * 1000;

  const results = {};
  const toFetch = [];

  for (const s of symbols) {
    const cached = globalThis._priceCache[s];
    if (cached && now - cached.ts < ttl) {
      results[s] = { price: cached.price, cached: true, ts: cached.ts };
    } else {
      toFetch.push(s);
    }
  }

  // fetch sequentially to be friendlier to rate limits
  for (const s of toFetch) {
    try {
      const { price } = await fetchAlphaPrice(s);
      globalThis._priceCache[s] = { price, ts: now };
      results[s] = { price, cached: false, ts: now };
      // small delay can be enabled if you hit strict rate limits:
      // await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      const cached = globalThis._priceCache[s];
      if (cached) {
        results[s] = { price: cached.price, cached: true, ts: cached.ts, warning: 'upstream failed - returned cached' };
      } else {
        results[s] = { price: null, error: 'fetch_failed', message: err.message };
      }
    }
  }

  // Let Vercel CDN cache responses server-side for a short TTL (s-maxage)
  res.setHeader('Cache-Control', `s-maxage=${DEFAULT_TTL}, stale-while-revalidate=${Math.max(30, DEFAULT_TTL)}`);
  res.json({ serverTime: now, ttlSeconds: DEFAULT_TTL, data: results });
}