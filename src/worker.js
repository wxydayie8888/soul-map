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
    // V6.0 Act II/III: meaning journey artifacts
    if (path === '/api/journey' && request.method === 'POST') {
      return handleJourney(request, env);
    }
    // V6.0 Act III: weekly commitments
    if (path === '/api/commit' && request.method === 'POST') {
      return handleCommit(request, env);
    }
    // Manual cron trigger for testing — protected by ADMIN_KEY
    if (path === '/api/cron-test' && request.method === 'POST') {
      return handleCronTest(request, env);
    }

    // Let Cloudflare Pages handle static assets (index.html, etc.)
    return env.ASSETS.fetch(request);
  },

  // ----------------------------------------------------------------
  // SCHEDULED — Cloudflare Cron Trigger handler.
  // Runs Mondays 01:00 UTC = 09:00 Beijing (config in wrangler.toml).
  // Sends one "opponent letter" per active commitment whose
  // reminded_at has passed; advances reminded_at by 7 days.
  // After 12 weeks, marks status='done'.
  // ----------------------------------------------------------------
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(processWeeklyCommitments(env));
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

    // Rate limit: 1 PDF email per address per 24h (does NOT block weekly cron letters)
    const recent = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM email_sends WHERE email = ? AND sent_at >= datetime('now', '-24 hours')"
    ).bind(email).first();
    if (recent?.cnt > 0) return jsonResponse({ error: 'Already sent within 24h', sent: true });

    const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0d1117;color:#f5f0e8;padding:2rem;">
      <h1 style="color:#c9a84c;text-align:center;font-size:1.5rem;">灵魂地图 · 你的完整报告</h1>
      <div style="text-align:center;margin:1.5rem 0;">
        <div style="font-size:2.5rem;color:#b892ff;font-weight:bold;letter-spacing:0.2em;">${displayCode}</div>
        <div style="font-size:1.5rem;color:#c9a84c;margin-top:0.5rem;">${poeticName}</div>
      </div>
      <p style="text-align:center;color:rgba(245,240,232,0.7);">Hi ${name}，你的完整灵魂地图报告已附在本邮件中。</p>
      <p style="text-align:center;color:rgba(245,240,232,0.5);font-size:0.85rem;">这不是你的人生标签，只是一次哲学对话。</p>
      <hr style="border-color:rgba(201,168,76,0.2);margin:1.5rem 0;">
      <p style="text-align:center;color:rgba(201,168,76,0.6);font-size:0.8rem;">灵魂地图 · Philosophical Soul Cartography</p>
    </div>`;

    const result = await sendEmail(env, {
      to: email,
      subject: `你的灵魂地图：${displayCode} · ${poeticName}`,
      html,
      attachments: [{ filename: `灵魂地图-${poeticName}-${name}.pdf`, content: pdfBase64 }]
    });

    if (result.ok){
      await env.DB.prepare('INSERT INTO email_sends (email) VALUES (?)').bind(email).run();
      return jsonResponse({ success: true });
    }
    return jsonResponse({ error: result.error }, 500);
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

/**
 * sendEmail() — single Resend wrapper. Used by handleSendReport (PDF report)
 * and processWeeklyCommitments (cron letters). No DB side-effects here;
 * callers do their own rate-limit / logging.
 *
 * Returns { ok: bool, error?: string }.
 */
async function sendEmail(env, { to, subject, html, attachments, from }) {
  if (!env.RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY not set' };
  try {
    const body = {
      from: from || 'Soul Map <onboarding@resend.dev>',
      to: Array.isArray(to) ? to : [to],
      subject,
      html
    };
    if (attachments && attachments.length) body.attachments = attachments;
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (resp.ok) return { ok: true };
    const errText = await resp.text();
    return { ok: false, error: `Resend ${resp.status}: ${errText}` };
  } catch (e) {
    return { ok: false, error: e.message };
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
    const {
      session_id, name, email, referred_by,
      // Optional — when called from the post-result "upgrade" flow (anonymous
      // user finished quiz then opted in for email), the frontend forwards
      // already-computed archetype info so we can mark the lead 'completed'
      // immediately and downstream Act II / cron work without a second hop.
      archetype_code, display_code, poetic_name
    } = body;

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
    const hasArchetype = !!(archetype_code && display_code);

    // Check returning user by email (most recent completed submission)
    const lastSubmission = await env.DB.prepare(
      `SELECT display_code, poetic_name, archetype_code, created_at
       FROM submissions WHERE email = ? ORDER BY id DESC LIMIT 1`
    ).bind(email).first();

    // Upsert lead by session_id. When archetype info is provided (post-quiz
    // upgrade), seed/overwrite it so /api/journey + cron see a real lead.
    if (hasArchetype) {
      await env.DB.prepare(`
        INSERT INTO leads (session_id, name, email, referred_by, status, progress,
                           archetype_code, display_code, poetic_name,
                           completed_at, ip_hint, user_agent, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'completed', 40, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          name = excluded.name,
          email = excluded.email,
          referred_by = COALESCE(leads.referred_by, excluded.referred_by),
          status = 'completed',
          progress = 40,
          archetype_code = excluded.archetype_code,
          display_code = excluded.display_code,
          poetic_name = excluded.poetic_name,
          completed_at = COALESCE(leads.completed_at, excluded.completed_at),
          updated_at = excluded.updated_at
      `).bind(
        session_id, name, email, referred_by || null,
        archetype_code, display_code, poetic_name || null,
        t, hint, ua, t, t
      ).run();
    } else {
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
    }

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

/**
 * POST /api/journey
 * V6.0 — Persist Act II artifacts (values, strengths, BPS) onto the lead row.
 * Body: { session_id, values_json?, strengths_json?, bps_text? }
 * Any subset of the three artifact fields can be sent; only non-empty ones update.
 * Idempotent — re-submission overwrites prior value.
 */
async function handleJourney(request, env) {
  try {
    const body = await request.json();
    const { session_id, values_json, strengths_json, bps_text } = body;

    if (!session_id || typeof session_id !== 'string') {
      return jsonResponse({ error: 'session_id required' }, 400);
    }

    // Validate JSON-ish fields are reasonable size
    if (values_json && values_json.length > 4000) return jsonResponse({ error: 'values_json too large' }, 400);
    if (strengths_json && strengths_json.length > 2000) return jsonResponse({ error: 'strengths_json too large' }, 400);
    if (bps_text && bps_text.length > 8000) return jsonResponse({ error: 'bps_text too large' }, 400);

    // Build dynamic UPDATE — only the non-null fields
    const sets = [];
    const binds = [];
    if (values_json !== undefined && values_json !== null) { sets.push('values_json = ?'); binds.push(values_json); }
    if (strengths_json !== undefined && strengths_json !== null) { sets.push('strengths_json = ?'); binds.push(strengths_json); }
    if (bps_text !== undefined && bps_text !== null) { sets.push('bps_text = ?'); binds.push(bps_text); }

    if (sets.length === 0) {
      return jsonResponse({ error: 'no fields to update' }, 400);
    }

    sets.push('updated_at = ?');
    binds.push(now());
    binds.push(session_id);

    const result = await env.DB.prepare(
      `UPDATE leads SET ${sets.join(', ')} WHERE session_id = ?`
    ).bind(...binds).run();

    return jsonResponse({
      ok: true,
      changed: result.meta?.changes ?? 0,
      fields: sets.length - 1  // exclude updated_at from count
    });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

// ============================================================
// V6.0 ACT III · COMMITMENT + WEEKLY OPPONENT LETTER (cron-driven)
// ============================================================

// Per-archetype opponent character + Socratic challenge (mirrored from
// public/index.html ARCHETYPES[].opponent — must stay in sync).
const ARCHETYPE_OPPONENTS = {
  OREI: { name: '庄子',   challenge: '你守的灯，会不会是别人的牢？' },
  ORSI: { name: '王阳明', challenge: '心外无理，规则写在纸上有何用？' },
  OREW: { name: '荣格',   challenge: '你为谁活？你的名字在哪？' },
  ORSW: { name: '庄子',   challenge: '风暴与船都是你自造的，为何不下船？' },
  FREI: { name: '费孝通', challenge: '没有他人，"自己"从何而来？' },
  FRSI: { name: '孔子',   challenge: '没有安土重迁，如何有家？' },
  FREW: { name: '庄子',   challenge: '热闹背后，是否是一种空？' },
  FRSW: { name: '王阳明', challenge: '听过一万种声音，你自己的声音呢？' },
  OVEI: { name: '马克思', challenge: '"神秘"是否只是逃避？' },
  OVSI: { name: '韩非',   challenge: '仁爱治得了具体的伤，治得了制度的病吗？' },
  OVEW: { name: '庄子',   challenge: '根是稳定，也可能是牢笼。' },
  OVSW: { name: '韩非',   challenge: '和稀泥是不是另一种欺骗？' },
  FVEI: { name: '老子',   challenge: '思考越多，离道越远。' },
  FVSI: { name: '老子',   challenge: '为无为之道——不动而动。' },
  FVEW: { name: '萨特',   challenge: '自我是否被群体吞没？' },
  FVSW: { name: '加缪',   challenge: '松弛是否是另一种逃避？' }
};

// Total weeks of the meaning-arc. After WEEKS_TOTAL letters, status='done'.
const WEEKS_TOTAL = 12;

// Beijing 09:00 = UTC 01:00.
function nextMondayBeijing9am() {
  const d = new Date();
  // Floor to today 01:00 UTC
  d.setUTCHours(1, 0, 0, 0);
  const day = d.getUTCDay(); // 0=Sun...6=Sat
  let daysUntil;
  if (day === 1) {
    // Today is Monday: if 01:00 UTC is still in the future today, fire today; else next week
    daysUntil = (Date.now() < d.getTime()) ? 0 : 7;
  } else {
    daysUntil = (8 - day) % 7;
  }
  d.setUTCDate(d.getUTCDate() + daysUntil);
  return Math.floor(d.getTime() / 1000);
}

/**
 * POST /api/commit
 * Body: { session_id, email, archetype_code, practice_text,
 *         smart_when, smart_freq, smart_signal }
 * Inserts a new commitments row with reminded_at = next Monday 09:00 Beijing.
 * If user has an existing 'active' commitment, marks it 'replaced' first.
 */
async function handleCommit(request, env) {
  try {
    const body = await request.json();
    const {
      session_id, email, archetype_code,
      practice_text, smart_when, smart_freq, smart_signal
    } = body;

    if (!session_id || !email || !EMAIL_RE.test(email)) {
      return jsonResponse({ error: 'session_id and valid email required' }, 400);
    }
    if (!archetype_code || !ARCHETYPE_OPPONENTS[archetype_code]) {
      return jsonResponse({ error: 'unknown archetype_code' }, 400);
    }
    if (!practice_text || practice_text.length > 200) {
      return jsonResponse({ error: 'practice_text required, max 200 chars' }, 400);
    }
    if (!smart_when || !smart_freq || !smart_signal) {
      return jsonResponse({ error: 'smart_when / smart_freq / smart_signal all required' }, 400);
    }

    const ts = now();
    const reminded = nextMondayBeijing9am();

    // Mark any existing active commitments as replaced
    await env.DB.prepare(
      "UPDATE commitments SET status = 'replaced' WHERE email = ? AND status = 'active'"
    ).bind(email).run();

    // Insert new active commitment. week_start = the upcoming Monday in seconds
    await env.DB.prepare(
      `INSERT INTO commitments
       (session_id, email, archetype_code, week_start, practice_text,
        smart_when, smart_freq, smart_signal, status, created_at, reminded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
    ).bind(
      session_id, email, archetype_code, reminded,
      practice_text.slice(0, 200),
      smart_when.slice(0, 60),
      smart_freq.slice(0, 40),
      smart_signal.slice(0, 60),
      ts, reminded
    ).run();

    return jsonResponse({
      ok: true,
      reminded_at: reminded,
      reminded_at_iso: new Date(reminded * 1000).toISOString()
    });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

/**
 * POST /api/cron-test  { email?: optional }  Header: x-admin-key: <ADMIN_KEY>
 * For dev testing — invokes processWeeklyCommitments() with a forced now-time.
 * If `email` provided, scoped to one email's active commitments.
 */
async function handleCronTest(request, env) {
  // Accept either ADMIN_KEY or a dedicated CRON_TEST_KEY (so testing the cron
  // doesn't require the same key used for the admin dashboard).
  const k = request.headers.get('x-admin-key');
  const validAdmin = env.ADMIN_KEY && k === env.ADMIN_KEY;
  const validCron  = env.CRON_TEST_KEY && k === env.CRON_TEST_KEY;
  if (!validAdmin && !validCron) {
    return jsonResponse({ error: 'forbidden' }, 403);
  }
  let scope = null;
  try { scope = await request.json(); } catch(_){}
  const result = await processWeeklyCommitments(env, { force: true, email: scope?.email });
  return jsonResponse(result);
}

/**
 * The actual cron worker. Runs once per scheduled invocation.
 * @param {object} env
 * @param {object} opts  { force?: bool, email?: string }
 *   force: ignore reminded_at threshold (for testing)
 *   email: scope to one address (for testing)
 */
async function processWeeklyCommitments(env, opts = {}) {
  const t0 = now();
  const sql = opts.email
    ? "SELECT * FROM commitments WHERE status = 'active' AND email = ?" + (opts.force ? '' : ' AND reminded_at <= ?')
    : "SELECT * FROM commitments WHERE status = 'active'" + (opts.force ? '' : ' AND reminded_at <= ?');
  const stmt = env.DB.prepare(sql);
  const bind = [];
  if (opts.email) bind.push(opts.email);
  if (!opts.force) bind.push(t0);

  const rows = (await stmt.bind(...bind).all()).results || [];
  let sent = 0, errors = [], skipped = 0;

  for (const row of rows) {
    try {
      // Compute current week (1-indexed) since created_at
      const elapsedDays = Math.floor((t0 - row.created_at) / 86400);
      const weekIndex = Math.floor(elapsedDays / 7) + 1;  // week 1 on first send

      const opponent = ARCHETYPE_OPPONENTS[row.archetype_code];
      if (!opponent) { skipped++; continue; }

      // Look up player name from leads table for personal greeting
      const lead = await env.DB.prepare(
        'SELECT name FROM leads WHERE email = ? ORDER BY id DESC LIMIT 1'
      ).bind(row.email).first();
      const playerName = (lead && lead.name) || '旅人';

      const { subject, html } = composeOpponentLetter({
        playerName,
        opponentName: opponent.name,
        opponentChallenge: opponent.challenge,
        practiceText: row.practice_text,
        smartWhen: row.smart_when,
        smartFreq: row.smart_freq,
        smartSignal: row.smart_signal,
        weekNumber: weekIndex,
        weeksTotal: WEEKS_TOTAL
      });

      const r = await sendEmail(env, { to: row.email, subject, html });
      if (!r.ok) { errors.push({ id: row.id, email: row.email, err: r.error }); continue; }
      sent++;

      // Update reminded_at: next Monday OR mark done if reached final week
      const nextStatus = weekIndex >= WEEKS_TOTAL ? 'done' : 'active';
      const nextRemind = weekIndex >= WEEKS_TOTAL ? null : nextMondayBeijing9am();
      await env.DB.prepare(
        'UPDATE commitments SET reminded_at = ?, status = ? WHERE id = ?'
      ).bind(nextRemind, nextStatus, row.id).run();
    } catch (e) {
      errors.push({ id: row.id, err: e.message });
    }
  }

  return { ok: true, scanned: rows.length, sent, errors, skipped, at: new Date(t0 * 1000).toISOString() };
}

/**
 * Compose the weekly opponent letter. Plain styled HTML, no logo, no buttons.
 * Reads like a friend's letter, not a product email — by design.
 */
function composeOpponentLetter({ playerName, opponentName, opponentChallenge, practiceText, smartWhen, smartFreq, smartSignal, weekNumber, weeksTotal }) {
  const isFinalWeek = weekNumber >= weeksTotal;
  const subject = isFinalWeek
    ? `${opponentName}最后一封信 · 第 ${weekNumber} 周`
    : `${opponentName}来信 · 第 ${weekNumber} 周`;

  const closing = isFinalWeek
    ? `这是这一季的最后一封。\n下一颗种子要不要再种，由你。`
    : `下周一这个时候我再来。`;

  // Use straight Chinese text. Plain serif-ish styling. NO emojis. NO call-to-action buttons.
  const html = `<div style="font-family:'Songti SC','Noto Serif SC','Georgia',serif;max-width:560px;margin:0 auto;background:#fafaf6;color:#1a1a1a;padding:2.4rem 1.8rem;line-height:1.95;font-size:16px;">

<p style="color:#888;font-size:13px;letter-spacing:0.1em;margin:0 0 1.5rem;">第 ${weekNumber} / ${weeksTotal} 周</p>

<p style="margin:0 0 1.5rem;">${escapeHtmlSrv(playerName)}，</p>

<p style="margin:0 0 1.5rem;">我是 <strong>${opponentName}</strong>。</p>

<p style="margin:0 0 1.2rem;">你这周想做的事：</p>
<p style="margin:0 0 0.6rem;padding:0 0 0 1rem;border-left:2px solid #c9a84c;color:#444;font-style:italic;">${escapeHtmlSrv(practiceText)}</p>
<p style="margin:0 0 1.8rem;color:#888;font-size:14px;padding-left:1rem;">${escapeHtmlSrv(smartWhen)}　·　${escapeHtmlSrv(smartFreq)}　·　${escapeHtmlSrv(smartSignal)}</p>

<p style="margin:0 0 1.2rem;">我没什么能帮你。但我想问你一句：</p>

<p style="margin:0 0 2rem;font-size:18px;color:#1a1a1a;border-top:1px solid #e0d8c0;border-bottom:1px solid #e0d8c0;padding:1.2rem 0;text-align:center;font-style:italic;">${escapeHtmlSrv(opponentChallenge)}</p>

<p style="margin:0 0 1.5rem;color:#444;">不需要现在回答。等你做了这件事，回头想想这个问题——可能比那件事本身更重要。</p>

<p style="margin:0 0 1.5rem;color:#444;white-space:pre-wrap;">${escapeHtmlSrv(closing)}</p>

<p style="margin:2rem 0 0;color:#666;">— ${opponentName}</p>

<hr style="border:0;border-top:1px solid #e0d8c0;margin:2.5rem 0 1rem;">

<p style="color:#aaa;font-size:11px;text-align:center;letter-spacing:0.15em;margin:0;">SOUL MAP · 灵魂地图 · 一周一颗种子</p>
<p style="color:#aaa;font-size:11px;text-align:center;margin:0.5rem 0 0;">不想继续收信？回信告诉我们就好。</p>

</div>`;

  return { subject, html };
}

// Tiny HTML-escape (server-side variant, separate name to avoid colliding with frontend escHtml)
function escapeHtmlSrv(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
