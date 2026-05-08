/**
 * Cloudflare Worker — GastroTracker proxy
 *
 * Secrets required (set via `wrangler secret put`):
 *   GIST_TOKEN   GitHub Personal Access Token (scope: gist)
 *   GIST_ID      ID of the target GitHub Gist
 *
 * API:
 *   GET  /        → returns full JSON data from Gist
 *   GET  /?debug  → diagnostic info (file names, truncation status, content preview)
 *   POST /        → body: { events: [{author, date, time, count}] }
 *                   merges new events into existing data, never overwrites
 */

const FILENAME   = 'gastro-data.json';
const EMPTY_DATA = { version: 1, members: {}, aliases: {}, hidden: [], lastUpdated: null };

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
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
      const url = new URL(request.url);
      if (url.searchParams.has('debug')) {
        return debugInfo(GIST_ID, ghHeaders);
      }
      const data = await readGist(GIST_ID, ghHeaders);
      if (data.error) return json({ error: data.error }, data.status || 500);
      return json(data);
    }

    // ── POST: merge new events into existing data ───────────────────────
    if (request.method === 'POST') {
      let body;
      try { body = await request.json(); }
      catch { return json({ error: 'Invalid JSON body' }, 400); }

      const events   = body?.events;
      const settings = body?.settings;

      // Settings-only update (rename aliases / hidden list)
      if (settings !== undefined && !events) {
        const current = await readGist(GIST_ID, ghHeaders);
        if (current.error) return json({ error: current.error }, current.status || 500);
        const updated = {
          ...current,
          aliases:     settings.aliases ?? current.aliases ?? {},
          hidden:      settings.hidden  ?? current.hidden  ?? [],
          lastUpdated: new Date().toISOString(),
        };
        const saveErr = await writeGist(GIST_ID, ghHeaders, updated);
        if (saveErr) return json({ error: saveErr }, 500);
        return json({ success: true, type: 'settings' });
      }

      if (!Array.isArray(events) || events.length === 0) {
        return json({ error: 'Body must contain a non-empty events array' }, 400);
      }

      // Validate each event has the minimum required fields
      for (const ev of events) {
        if (!ev.author || !ev.date || !ev.time) {
          return json({ error: 'Each event must have author, date, and time' }, 400);
        }
      }

      // Load current data from Gist
      const current = await readGist(GIST_ID, ghHeaders);
      if (current.error) return json({ error: current.error }, current.status || 500);

      // Merge — existing data is never discarded
      const { data: merged, added } = mergeEvents(current, events);

      // Save only if there's something new
      if (added === 0) {
        return json({ success: true, added: 0 });
      }

      const saveErr = await writeGist(GIST_ID, ghHeaders, merged);
      if (saveErr) return json({ error: saveErr }, 500);

      return json({ success: true, added });
    }

    return new Response('Method Not Allowed', { status: 405, headers: CORS });
  },
};

// ── Gist helpers ─────────────────────────────────────────────────────────────

async function readGist(gistId, headers) {
  const res = await fetch(`https://api.github.com/gists/${gistId}`, { headers });
  if (!res.ok) {
    return { error: `GitHub API error: ${res.status}`, status: res.status };
  }
  const gist = await res.json();
  const file = gist.files?.[FILENAME];
  if (!file) return { ...EMPTY_DATA };

  // GitHub truncates large files — fetch raw content when needed
  let content = file.content;
  if (!content || file.truncated) {
    const rawRes = await fetch(file.raw_url, { headers: { 'User-Agent': 'GastroTracker/1.0' } });
    if (!rawRes.ok) return { ...EMPTY_DATA };
    content = await rawRes.text();
  }

  try {
    const parsed = JSON.parse(content);
    return (parsed && typeof parsed === 'object' && parsed.members)
      ? {
          version:     parsed.version || 1,
          members:     parsed.members,
          aliases:     parsed.aliases  || {},
          hidden:      parsed.hidden   || [],
          lastUpdated: parsed.lastUpdated || null,
        }
      : { ...EMPTY_DATA };
  } catch {
    return { ...EMPTY_DATA };
  }
}

async function debugInfo(gistId, headers) {
  const res = await fetch(`https://api.github.com/gists/${gistId}`, { headers });
  if (!res.ok) return json({ github_status: res.status, error: 'GitHub API request failed' });
  const gist = await res.json();
  const fileNames = Object.keys(gist.files || {});
  const file = gist.files?.[FILENAME];
  return json({
    looking_for:          FILENAME,
    files_in_gist:        fileNames,
    file_found:           !!file,
    file_truncated:       file?.truncated ?? null,
    file_content_null:    file ? file.content === null : null,
    file_content_length:  file?.content?.length ?? null,
    file_content_preview: file?.content?.slice(0, 200) ?? null,
  });
}

async function writeGist(gistId, headers, data) {
  const res = await fetch(`https://api.github.com/gists/${gistId}`, {
    method:  'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files: { [FILENAME]: { content: JSON.stringify(data, null, 2) } },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    return `GitHub API error: ${res.status} — ${body}`;
  }
  return null;
}

// ── Merge logic ───────────────────────────────────────────────────────────────
// Incoming events: [{ author, date, time, count }]
// Stored format:   { members: { "Name": [{ date, time, count }] } }

function mergeEvents(existing, newEvents) {
  const data = {
    version:     existing.version || 1,
    members:     JSON.parse(JSON.stringify(existing.members || {})),
    aliases:     existing.aliases || {},
    hidden:      existing.hidden  || [],
    lastUpdated: existing.lastUpdated,
  };

  const seen = new Set();
  for (const [member, entries] of Object.entries(data.members)) {
    for (const e of entries) seen.add(`${member}|${e.date}|${e.time}`);
  }

  let added = 0;
  for (const ev of newEvents) {
    const key = `${ev.author}|${ev.date}|${ev.time}`;
    if (seen.has(key)) continue;
    if (!data.members[ev.author]) data.members[ev.author] = [];
    data.members[ev.author].push({ date: ev.date, time: ev.time, count: ev.count || 1 });
    seen.add(key);
    added++;
  }

  for (const entries of Object.values(data.members)) {
    entries.sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
  }

  data.lastUpdated = new Date().toISOString();
  return { data, added };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
