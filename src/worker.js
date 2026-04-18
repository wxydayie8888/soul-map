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
    // V5.0 lead capture + progress
    if (path === '/api/lead' && request.method === 'POST') {
      return handleLead(request, env);
    }
    if (path === '/api/lead/progress' && request.method === 'POST') {
      return handleLeadProgress(request, env);
    }
    if (path === '/api/lookup' && request.method === 'GET') {
      return handleLookup(request, env);
    }
    if (path === '/api/counts' && request.method === 'GET') {
      return handleCounts(env);
    }
    if (path === '/api/stats' && request.method === 'GET') {
      return handleStats(request, env);
    }
    if (path === '/api/export' && request.method === 'GET') {
      return handleExport(request, env);
    }
    if (path === '/api/referral' && request.method === 'GET') {
      return handleReferral(request, env);
    }
    if (path === '/api/send-report' && request.method === 'POST') {
      return handleSendReport(request, env);
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
      i_score, hesitations, resonances, referred_by,
      session_id
    } = body;

    // Validate required fields
    if (!name || !archetype_code || !display_code) {
      return jsonResponse({ error: 'Missing required fields: name, archetype_code, display_code' }, 400);
    }

    // Generate referral code
    const refCode = generateRefCode();

    // Insert submission with referral info
    await env.DB.prepare(`
      INSERT INTO submissions (
        name, age, gender, email,
        archetype_code, display_code, poetic_name,
        rarity_tier, rarity_pct, scores_json, intensities_json,
        i_score, hesitations, resonances,
        user_agent, referrer, referral_code, referred_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      request.headers.get('referer') || null,
      refCode,
      referred_by || null
    ).run();

    // If referred_by exists, complete the referral
    if (referred_by) {
      const inviter = await env.DB.prepare(
        'SELECT name, display_code, poetic_name FROM submissions WHERE referral_code = ?'
      ).bind(referred_by).first();
      if (inviter) {
        // Compute compatibility (axis diff count)
        const selfAxes = archetype_code;
        const inviterCode = inviter.display_code;
        // Simple compat: store in referrals
        await env.DB.prepare(`
          INSERT INTO referrals (inviter_code, inviter_name, inviter_archetype, invitee_code, invitee_name, invitee_archetype, completed_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        `).bind(referred_by, inviter.name, inviter.poetic_name, refCode, name, poetic_name).run();
      }
    }

    // V5.0: If session_id provided, mark lead as completed
    if (session_id) {
      const tNow = Math.floor(Date.now() / 1000);
      await env.DB.prepare(`
        UPDATE leads
        SET status = 'completed', progress = 40,
            archetype_code = ?, display_code = ?, poetic_name = ?,
            completed_at = ?, updated_at = ?
        WHERE session_id = ?
      `).bind(archetype_code, display_code, poetic_name || null, tNow, tNow, session_id).run();
    }

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
      total_players: totalRow?.total || 1,
      referral_code: refCode
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

    // Recent 100 submissions
    const { results: recent } = await env.DB.prepare(`
      SELECT id, created_at, name, age, gender, email,
             display_code, poetic_name, rarity_tier, i_score, hesitations, resonances
      FROM submissions
      ORDER BY created_at DESC
      LIMIT 100
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

/**
 * GET /api/export?key=ADMIN_KEY
 * Export ALL submissions as JSON (for CSV conversion on client)
 */
async function handleExport(request, env) {
  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM submissions ORDER BY created_at DESC'
    ).all();
    return jsonResponse({ submissions: results || [] });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

/**
 * GET /api/referral?code=xxx
 * Look up who invited this user
 */
async function handleReferral(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  if (!code) return jsonResponse({ error: 'Missing code' }, 400);
  try {
    const inviter = await env.DB.prepare(
      'SELECT name, display_code, poetic_name FROM submissions WHERE referral_code = ?'
    ).bind(code).first();
    if (!inviter) return jsonResponse({ found: false });
    return jsonResponse({
      found: true,
      name: inviter.name,
      display_code: inviter.display_code,
      poetic_name: inviter.poetic_name
    });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

/**
 * POST /api/send-report
 * Send PDF report via Resend email API
 */
async function handleSendReport(request, env) {
  try {
    const { email, name, displayCode, poeticName, pdfBase64 } = await request.json();
    if (!email || !pdfBase64) return jsonResponse({ error: 'Missing email or PDF' }, 400);

    // Rate limit: 1 email per address per 24h
    const recent = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM email_sends WHERE email = ? AND sent_at >= datetime('now', '-24 hours')"
    ).bind(email).first();
    if (recent?.cnt > 0) return jsonResponse({ error: 'Already sent within 24h', sent: true });

    // Check for RESEND_API_KEY
    if (!env.RESEND_API_KEY) return jsonResponse({ error: 'Email not configured' }, 500);

    // Send via Resend API
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Soul Map <onboarding@resend.dev>',
        to: [email],
        subject: `你的灵魂地图：${displayCode} · ${poeticName}`,
        html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0d1117;color:#f5f0e8;padding:2rem;">
          <h1 style="color:#c9a84c;text-align:center;font-size:1.5rem;">灵魂地图 · 你的完整报告</h1>
          <div style="text-align:center;margin:1.5rem 0;">
            <div style="font-size:2.5rem;color:#b892ff;font-weight:bold;letter-spacing:0.2em;">${displayCode}</div>
            <div style="font-size:1.5rem;color:#c9a84c;margin-top:0.5rem;">${poeticName}</div>
          </div>
          <p style="text-align:center;color:rgba(245,240,232,0.7);">Hi ${name}，你的完整灵魂地图报告已附在本邮件中。</p>
          <p style="text-align:center;color:rgba(245,240,232,0.5);font-size:0.85rem;">这不是你的人生标签，只是一次哲学对话。</p>
          <hr style="border-color:rgba(201,168,76,0.2);margin:1.5rem 0;">
          <p style="text-align:center;color:rgba(201,168,76,0.6);font-size:0.8rem;">灵魂地图 · Philosophical Soul Cartography</p>
        </div>`,
        attachments: [{
          filename: `灵魂地图-${poeticName}-${name}.pdf`,
          content: pdfBase64
        }]
      })
    });

    if (resp.ok) {
      // Record send
      await env.DB.prepare('INSERT INTO email_sends (email) VALUES (?)').bind(email).run();
      return jsonResponse({ success: true });
    } else {
      const err = await resp.text();
      return jsonResponse({ error: 'Resend API error: ' + err }, 500);
    }
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

function generateRefCode() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
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

// ============================================================
// V5.0 Lead Capture + Progress Tracking
// ============================================================

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function now() { return Math.floor(Date.now() / 1000); }

function ipHint(request) {
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '';
  const ua = request.headers.get('user-agent') || '';
  // Coarse: first 2 octets + UA length, no raw IP kept
  const ipPrefix = ip.split('.').slice(0, 2).join('.') || ip.slice(0, 8);
  return `${ipPrefix}|${ua.length}`;
}

/**
 * POST /api/lead
 * Capture name+email at start of quiz (before Q1).
 * Upserts by session_id. Returns is_returning flag + last_result if email seen before.
 * Body: { session_id, name, email, referred_by? }
 */
async function handleLead(request, env) {
  try {
    const body = await request.json();
    const { session_id, name, email, referred_by } = body;

    if (!session_id || !name || !email) {
      return jsonResponse({ error: 'Missing session_id, name, or email' }, 400);
    }
    if (!EMAIL_RE.test(email)) {
      return jsonResponse({ error: 'Invalid email format' }, 400);
    }
    if (name.length < 1 || name.length > 24) {
      return jsonResponse({ error: 'Name must be 1-24 chars' }, 400);
    }

    const t = now();
    const hint = ipHint(request);
    const ua = request.headers.get('user-agent') || null;

    // Check returning user by email (most recent completed submission)
    const lastSubmission = await env.DB.prepare(
      `SELECT display_code, poetic_name, archetype_code, created_at
       FROM submissions WHERE email = ? ORDER BY id DESC LIMIT 1`
    ).bind(email).first();

    // Upsert lead by session_id
    await env.DB.prepare(`
      INSERT INTO leads (session_id, name, email, referred_by, status, progress,
                         ip_hint, user_agent, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'started', 0, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        name = excluded.name,
        email = excluded.email,
        referred_by = COALESCE(leads.referred_by, excluded.referred_by),
        updated_at = excluded.updated_at
    `).bind(session_id, name, email, referred_by || null, hint, ua, t, t).run();

    return jsonResponse({
      success: true,
      session_id,
      is_returning: !!lastSubmission,
      last_result: lastSubmission ? {
        display_code: lastSubmission.display_code,
        poetic_name: lastSubmission.poetic_name,
        created_at: lastSubmission.created_at
      } : null
    });
  } catch (e) {
    return jsonResponse({ error: 'Server error: ' + e.message }, 500);
  }
}

/**
 * POST /api/lead/progress
 * Write partial progress every 10 questions + on completion.
 * Body: { session_id, progress, partial_scores?, status? }
 */
async function handleLeadProgress(request, env) {
  try {
    const body = await request.json();
    const { session_id, progress, partial_scores, status } = body;

    if (!session_id || typeof progress !== 'number') {
      return jsonResponse({ error: 'Missing session_id or progress' }, 400);
    }

    const t = now();
    const s = status || (progress >= 40 ? 'completed' : `q${Math.floor(progress / 10) * 10}`);
    const partialJson = partial_scores ? JSON.stringify(partial_scores) : null;

    // Compute reminded_at: first crossing of Q20 median → now + 24h (placeholder; cron not wired)
    const existing = await env.DB.prepare(
      'SELECT progress, reminded_at FROM leads WHERE session_id = ?'
    ).bind(session_id).first();

    if (!existing) {
      return jsonResponse({ error: 'Unknown session_id' }, 404);
    }

    let remindedAt = existing.reminded_at;
    if (!remindedAt && existing.progress < 20 && progress >= 20 && progress < 40) {
      remindedAt = t + 86400; // +24h
    }

    await env.DB.prepare(`
      UPDATE leads
      SET progress = ?, partial_scores = COALESCE(?, partial_scores),
          status = ?, updated_at = ?,
          reminded_at = ?,
          completed_at = CASE WHEN ? >= 40 THEN ? ELSE completed_at END
      WHERE session_id = ?
    `).bind(progress, partialJson, s, t, remindedAt, progress, t, session_id).run();

    return jsonResponse({ success: true, status: s });
  } catch (e) {
    return jsonResponse({ error: 'Server error: ' + e.message }, 500);
  }
}

/**
 * GET /api/lookup?email=xxx
 * Returning-user check for hero gate. Returns the most recent completed submission summary.
 */
async function handleLookup(request, env) {
  try {
    const url = new URL(request.url);
    const email = url.searchParams.get('email');
    if (!email || !EMAIL_RE.test(email)) {
      return jsonResponse({ error: 'Invalid email' }, 400);
    }

    const last = await env.DB.prepare(
      `SELECT display_code, poetic_name, archetype_code, created_at
       FROM submissions WHERE email = ? ORDER BY id DESC LIMIT 1`
    ).bind(email).first();

    return jsonResponse({
      found: !!last,
      last_result: last ? {
        display_code: last.display_code,
        poetic_name: last.poetic_name,
        created_at: last.created_at
      } : null
    });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}
