/**
 * Soul Map — Cloudflare Workers API
 * Handles: submission storage, archetype counts, admin dashboard data
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // API routes
    if (path === '/api/submit' && request.method === 'POST') {
      return handleSubmit(request, env);
    }
    if (path === '/api/counts' && request.method === 'GET') {
      return handleCounts(env);
    }
    if (path === '/api/stats' && request.method === 'GET') {
      return handleStats(request, env);
    }

    // Let Cloudflare Pages handle static assets (index.html, etc.)
    return env.ASSETS.fetch(request);
  }
};

/**
 * POST /api/submit
 * Store a test submission + increment archetype counter
 */
async function handleSubmit(request, env) {
  try {
    const body = await request.json();
    const {
      name, age, gender, email,
      archetype_code, display_code, poetic_name,
      rarity_tier, rarity_pct, scores, intensities,
      i_score, hesitations, resonances
    } = body;

    // Validate required fields
    if (!name || !archetype_code || !display_code) {
      return jsonResponse({ error: 'Missing required fields: name, archetype_code, display_code' }, 400);
    }

    // Insert submission
    await env.DB.prepare(`
      INSERT INTO submissions (
        name, age, gender, email,
        archetype_code, display_code, poetic_name,
        rarity_tier, rarity_pct, scores_json, intensities_json,
        i_score, hesitations, resonances,
        user_agent, referrer
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      name,
      age || null,
      gender || null,
      email || null,
      archetype_code,
      display_code,
      poetic_name || null,
      rarity_tier || null,
      rarity_pct || null,
      scores ? JSON.stringify(scores) : null,
      intensities ? JSON.stringify(intensities) : null,
      i_score || null,
      hesitations || 0,
      resonances || 0,
      request.headers.get('user-agent') || null,
      request.headers.get('referer') || null
    ).run();

    // Increment archetype counter
    await env.DB.prepare(`
      UPDATE archetype_counts SET count = count + 1 WHERE display_code = ?
    `).bind(display_code).run();

    // Get current count for this archetype
    const countRow = await env.DB.prepare(
      'SELECT count FROM archetype_counts WHERE display_code = ?'
    ).bind(display_code).first();

    // Get total submissions
    const totalRow = await env.DB.prepare(
      'SELECT COUNT(*) as total FROM submissions'
    ).first();

    return jsonResponse({
      success: true,
      your_number: countRow?.count || 1,
      total_players: totalRow?.total || 1
    });
  } catch (e) {
    return jsonResponse({ error: 'Server error: ' + e.message }, 500);
  }
}

/**
 * GET /api/counts
 * Return all 16 archetype counts (for real-time rarity display)
 */
async function handleCounts(env) {
  try {
    const { results } = await env.DB.prepare(
      'SELECT display_code, count FROM archetype_counts ORDER BY display_code'
    ).all();

    const total = await env.DB.prepare(
      'SELECT COUNT(*) as total FROM submissions'
    ).first();

    return jsonResponse({
      counts: results || [],
      total: total?.total || 0
    });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

/**
 * GET /api/stats?key=ADMIN_KEY
 * Admin dashboard: recent submissions, distribution, totals
 */
async function handleStats(request, env) {
  const url = new URL(request.url);
  const key = url.searchParams.get('key');

  // Simple API key auth (set ADMIN_KEY in Cloudflare dashboard secrets)
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  try {
    // Total count
    const totalRow = await env.DB.prepare(
      'SELECT COUNT(*) as total FROM submissions'
    ).first();

    // Distribution by archetype
    const { results: distribution } = await env.DB.prepare(`
      SELECT display_code, poetic_name, rarity_tier, COUNT(*) as count
      FROM submissions
      GROUP BY display_code
      ORDER BY count DESC
    `).all();

    // Recent 50 submissions
    const { results: recent } = await env.DB.prepare(`
      SELECT id, created_at, name, age, gender, email,
             display_code, poetic_name, rarity_tier, i_score, hesitations, resonances
      FROM submissions
      ORDER BY created_at DESC
      LIMIT 50
    `).all();

    // Daily trend (last 30 days)
    const { results: daily } = await env.DB.prepare(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM submissions
      WHERE created_at >= datetime('now', '-30 days')
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `).all();

    return jsonResponse({
      total: totalRow?.total || 0,
      distribution: distribution || [],
      recent: recent || [],
      daily: daily || []
    });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS
    }
  });
}
