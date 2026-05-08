/**
 * Cloudflare Worker — GastroTracker proxy
 *
 * Secrets required (set via `wrangler secret put`):
 *   GIST_TOKEN   GitHub Personal Access Token (scope: gist)
 *   GIST_ID      ID of the target GitHub Gist
 */

const FILENAME = 'gastro-data.json';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const EMPTY_DATA = { version: 1, members: {}, lastUpdated: null };

export default {
  async fetch(request, env) {
    // Pre-flight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    const { GIST_TOKEN, GIST_ID } = env;

    if (!GIST_TOKEN || !GIST_ID) {
      return json({ error: 'Secrets GIST_TOKEN and GIST_ID are not configured.' }, 500);
    }

    const ghHeaders = {
      Authorization:  `token ${GIST_TOKEN}`,
      'User-Agent':   'GastroTracker/1.0',
      Accept:         'application/vnd.github.v3+json',
    };

    // ── GET: read current data ──────────────────────────────────────────
    if (request.method === 'GET') {
      const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
        headers: ghHeaders,
      });

      if (!res.ok) {
        const body = await res.text();
        return json({ error: `GitHub API error: ${res.status} — ${body}` }, res.status);
      }

      const gist = await res.json();
      const file = gist.files?.[FILENAME];

      if (!file) {
        // First run: Gist exists but file doesn't yet
        return json(EMPTY_DATA);
      }

      // Parse and return
      try {
        const data = JSON.parse(file.content);
        return json(data);
      } catch {
        return json(EMPTY_DATA);
      }
    }

    // ── POST: overwrite data ────────────────────────────────────────────
    if (request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'Invalid JSON body' }, 400);
      }

      const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
        method:  'PATCH',
        headers: { ...ghHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: {
            [FILENAME]: { content: JSON.stringify(body, null, 2) },
          },
        }),
      });

      if (!res.ok) {
        const errBody = await res.text();
        return json({ error: `GitHub API error: ${res.status} — ${errBody}` }, res.status);
      }

      return json({ success: true });
    }

    return new Response('Method Not Allowed', { status: 405, headers: CORS });
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
