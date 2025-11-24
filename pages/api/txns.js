// pages/api/txns.js
// Server-side endpoint to insert transactions into Supabase using the service_role key.
// Protect with ADMIN_WRITE_SECRET header or integrate NextAuth/session to allow only you to create trades.

import { supabaseAdmin } from '../../lib/supabaseAdmin';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ADMIN_SECRET = process.env.ADMIN_WRITE_SECRET;
  if (!ADMIN_SECRET) return res.status(500).json({ error: 'Server misconfigured: missing ADMIN_WRITE_SECRET' });

  // Simple header-based protection — you can replace this with proper auth/session check
  if (req.headers['x-admin-secret'] !== ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  const { symbol, qty, price, date, note, user_id } = req.body;
  if (!symbol || !qty || !price || !date) return res.status(400).json({ error: 'Missing fields' });

  try {
    const { data, error } = await supabaseAdmin.from('transactions').insert([{
      symbol: symbol.toUpperCase(),
      qty,
      price,
      date,
      note: note || null,
      user_id: user_id || null,
    }]);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}