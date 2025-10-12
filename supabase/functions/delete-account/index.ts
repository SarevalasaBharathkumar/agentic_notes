// Supabase Edge Function: delete-account
// Purpose: Delete ALL notes for the authenticated user (no account deletion).
// Requires: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the function env.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Helper to build CORS headers (applied to every response)
function cors(headers: Headers, req: Request) {
  const origin = req.headers.get('Origin') ?? '*';
  const reqHeaders = req.headers.get('Access-Control-Request-Headers');
  const allowHeaders = reqHeaders || 'authorization, content-type, apikey, x-client-info';
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', allowHeaders);
  headers.set('Access-Control-Expose-Headers', 'content-type, content-length, apikey, x-client-info');
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Access-Control-Max-Age', '86400');
  headers.append('Vary', 'Origin');
  headers.append('Vary', 'Access-Control-Request-Headers');
  headers.append('Vary', 'Access-Control-Request-Method');
  return headers;
}

Deno.serve(async (req) => {
  const headers = cors(new Headers({ 'Content-Type': 'application/json' }), req);

  if (req.method === 'OPTIONS') {
    // Respond OK to preflight with full CORS headers
    return new Response(null, { status: 200, headers });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Missing auth token' }), { status: 401, headers });
    }

    // Move env access inside handler and after OPTIONS handling
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Client (anon) instance to read the current user from the JWT
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await anon.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
    }

    // Admin client for privileged operations
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    // Delete user data (notes)
    const { error: delDataErr } = await admin.from('notes').delete().eq('user_id', user.id);
    if (delDataErr) {
      console.error('Failed to delete notes', delDataErr);
      return new Response(JSON.stringify({ error: 'Failed to delete notes' }), { status: 500, headers });
    }

    return new Response(JSON.stringify({ success: true, deleted: 'notes' }), { status: 200, headers });
  } catch (e) {
    console.error('Unhandled error in delete-account (delete notes)', e);
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500, headers });
  }
});
