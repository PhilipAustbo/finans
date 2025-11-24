# Finans — serverless & Supabase support (proposed)

This branch adds server-side helpers and two API endpoints:
- /api/prices — proxies Alpha Vantage and caches results (requires ALPHA_API_KEY in Vercel env).
- /api/txns — inserts transactions server-side into Supabase (requires SUPABASE_SERVICE_ROLE_KEY and ADMIN_WRITE_SECRET).

Important Vercel environment variables (set in Project > Settings > Environment Variables):
- NEXT_PUBLIC_SUPABASE_URL (public) — your Supabase URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY (public) — anon key for client usage (OK only when RLS is enforced)
- SUPABASE_SERVICE_ROLE_KEY (server-only) — service_role key (must NOT be NEXT_PUBLIC_)
- ALPHA_API_KEY (server-only) — Alpha Vantage key (must NOT be NEXT_PUBLIC_)
- ADMIN_WRITE_SECRET (server-only) — a random secret string you will use in X-Admin-Secret header when calling /api/txns from your own scripts or UI

Quick notes:
- Remove any NEXT_PUBLIC_ALPHA_API_KEY env var. If present, rotate the key and add ALPHA_API_KEY instead.
- Keep the anon key public only if you have strict RLS policies preventing arbitrary writes.
- The API route /api/prices uses a short in-memory cache and sets Cache-Control s-maxage to allow CDN caching. Adjust PRICE_CACHE_TTL env var if needed.

How I can proceed:
- If you approve these files, I will commit them to the branch and open a PR with the changes.
- After PR is open I can:
  - Add more server-side endpoints (snapshot cron job, aggregated portfolio endpoint).
  - Wire up the frontend to call /api/prices and use server-side transactions.
  - Add integration tests and a small README section showing how to call /api/txns safely.

Please confirm if you'd like me to commit these files and open the PR as-is, or tell me any edits you'd prefer.

Next steps I need from you before committing
- Confirm you want these exact file contents committed and a PR opened (or request changes).
- Ensure the following server-only env vars are set in Vercel before merging:
  - SUPABASE_SERVICE_ROLE_KEY
  - ALPHA_API_KEY
  - ADMIN_WRITE_SECRET
- Confirm whether you want ADMIN_WRITE_SECRET to be set to a custom value (I can suggest one) or whether you'd rather use NextAuth/session-based auth (I can scaffold that instead).