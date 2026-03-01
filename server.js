require('dotenv').config();
const path = require('path');
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const port = Number(process.env.PORT || 3000);
const jwtSecret = process.env.JWT_SECRET;
const isTestMode = process.env.TEST_MODE === 'true';
const databaseUrl = process.env.DATABASE_URL;

if (!jwtSecret) {
  throw new Error('JWT_SECRET is required');
}

if (!databaseUrl && !isTestMode) {
  throw new Error('DATABASE_URL is required unless TEST_MODE=true');
}

const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const CONTACT_PHRASES = [
  'contact',
  'contact us',
  'get in touch',
  'talk to us',
  'chat with us',
  'support',
  'help center',
  'customer service',
  'sales',
  'email us',
  'send message',
  'request a quote',
  'book a demo',
  'live chat',
  'open chat',
  'contato',
  'entre em contato',
  'entre em contato conosco',
  'entre contato com nos',
  'converse com nos',
  'converse conosco',
  'fale conosco',
  'fale com a gente',
  'suporte',
  'atendimento',
  'central de ajuda',
  'sac',
  'orcamento',
  'orçamento',
  'solicitar orçamento',
  'agendar demo',
  'chame no whatsapp',
  'iniciar conversa',
  'falar no chat',
  'quero comprar',
  'faça seu pedido',
  'whatsapp',
  'telegram',
  'messenger',
];

const CONTACT_PATH_HINTS = [
  '/contact',
  '/contacts',
  '/contato',
  '/fale-conosco',
  '/suporte',
  '/atendimento',
  '/help',
  '/support',
  '/sac',
  '/about',
  '/sobre',
  '/empresa',
  '/institucional',
];

const normalizeText = (text) => String(text || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ').trim();

const unique = (items) => [...new Set(items)];

const normalizeUrlForDedup = (rawUrl) => {
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = '';

    const filtered = [];
    for (const [key, value] of parsed.searchParams.entries()) {
      const lowerKey = key.toLowerCase();
      if (lowerKey.startsWith('utm_') || lowerKey === 'fbclid' || lowerKey === 'gclid') {
        continue;
      }
      filtered.push([key, value]);
    }

    parsed.search = '';
    filtered.sort(([a], [b]) => a.localeCompare(b));
    for (const [key, value] of filtered) {
      parsed.searchParams.append(key, value);
    }

    let pathname = parsed.pathname || '/';
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    parsed.pathname = pathname;

    return parsed.toString();
  } catch (_error) {
    return null;
  }
};

const extractTagContent = (html, tagName) => {
  const results = [];
  const regex = new RegExp(`<${tagName}\b([^>]*)>([\s\S]*?)<\/${tagName}>`, 'gi');
  let match = regex.exec(html);

  while (match) {
    const attrs = match[1] || '';
    const innerHtml = match[2] || '';
    const text = innerHtml.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ');
    results.push({ attrs, text: text.trim() });
    match = regex.exec(html);
  }

  return results;
};

const getAttr = (attrs, attrName) => {
  const regex = new RegExp(`${attrName}\s*=\s*["']([^"']+)["']`, 'i');
  const match = attrs.match(regex);
  return match ? match[1].trim() : '';
};

const detectContactPhrases = (rawText) => {
  const normalized = normalizeText(rawText);
  return CONTACT_PHRASES.filter((phrase) => normalized.includes(normalizeText(phrase)));
};

const getPageTitle = (html) => {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : 'Untitled';
};

const buildAbsoluteUrl = (currentUrl, href) => {
  try {
    return new URL(href, currentUrl).toString();
  } catch (_error) {
    return null;
  }
};

const shouldVisitUrl = (baseUrl, candidateUrl) => {
  try {
    const base = new URL(baseUrl);
    const candidate = new URL(candidateUrl);

    if (!['http:', 'https:'].includes(candidate.protocol)) {
      return false;
    }

    if (candidate.host !== base.host) {
      return false;
    }

    const badExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.zip', '.rar', '.mp4'];
    if (badExtensions.some((ext) => candidate.pathname.toLowerCase().endsWith(ext))) {
      return false;
    }

    return true;
  } catch (_error) {
    return false;
  }
};

const isPriorityContactUrl = (urlText) => {
  const normalized = normalizeText(urlText);
  return CONTACT_PATH_HINTS.some((hint) => normalized.includes(normalizeText(hint))) || detectContactPhrases(urlText).length > 0;
};

const extractCandidates = (html, pageUrl) => {
  const anchors = extractTagContent(html, 'a').map((item) => ({
    element: 'a',
    text: item.text,
    href: getAttr(item.attrs, 'href'),
    sourceUrl: pageUrl,
  }));

  const buttons = extractTagContent(html, 'button').map((item) => ({
    element: 'button',
    text: item.text,
    href: getAttr(item.attrs, 'href') || getAttr(item.attrs, 'data-href'),
    sourceUrl: pageUrl,
  }));

  const spansWithRoleButton = extractTagContent(html, 'span')
    .filter((item) => /role\s*=\s*['"]button['"]/i.test(item.attrs))
    .map((item) => ({
      element: 'span[role=button]',
      text: item.text,
      href: getAttr(item.attrs, 'data-href') || getAttr(item.attrs, 'href'),
      sourceUrl: pageUrl,
    }));

  const inputs = [];
  const inputRegex = /<input\b([^>]*)>/gi;
  let match = inputRegex.exec(html);
  while (match) {
    const attrs = match[1] || '';
    const type = normalizeText(getAttr(attrs, 'type'));
    if (!['submit', 'button'].includes(type)) {
      match = inputRegex.exec(html);
      continue;
    }

    inputs.push({
      element: `input[type=${type}]`,
      text: getAttr(attrs, 'value') || getAttr(attrs, 'aria-label') || getAttr(attrs, 'name'),
      href: getAttr(attrs, 'formaction') || '',
      sourceUrl: pageUrl,
    });

    match = inputRegex.exec(html);
  }

  return [...anchors, ...buttons, ...spansWithRoleButton, ...inputs]
    .map((item) => ({ ...item, text: (item.text || '').replace(/\s+/g, ' ').trim() }))
    .filter((item) => item.text.length > 0 || item.href.length > 0);
};

const enqueueUniqueUrl = (queue, seenQueued, url, priority = false) => {
  const canonical = normalizeUrlForDedup(url);
  if (!canonical || seenQueued.has(canonical)) {
    return;
  }

  seenQueued.add(canonical);
  if (priority) {
    queue.unshift(canonical);
  } else {
    queue.push(canonical);
  }
};

const crawlWebsite = async ({ startUrl, maxPages = 8 }) => {
  const queue = [];
  const seenQueued = new Set();
  enqueueUniqueUrl(queue, seenQueued, startUrl, true);

  const visited = new Set();
  const matchDedupe = new Set();
  const matches = [];
  const pages = [];

  while (queue.length > 0 && visited.size < maxPages) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);

    let response;
    try {
      response = await fetch(current, {
        redirect: 'follow',
        headers: {
          'User-Agent': 'InstascraperWebBot/1.0 (+contact-discovery)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });
    } catch (_error) {
      pages.push({ url: current, status: 'network_error', title: 'Unavailable' });
      continue;
    }

    if (!response.ok) {
      pages.push({ url: current, status: response.status, title: 'Unavailable' });
      continue;
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      pages.push({ url: current, status: response.status, title: `Skipped (${contentType})` });
      continue;
    }

    const html = await response.text();
    const title = getPageTitle(html);
    pages.push({ url: current, status: response.status, title });

    const candidates = extractCandidates(html, current);
    for (const candidate of candidates) {
      const normalizedText = normalizeText(candidate.text);
      const matchedPhrases = unique(detectContactPhrases(`${candidate.text} ${candidate.href}`));
      const absoluteHref = candidate.href ? buildAbsoluteUrl(current, candidate.href) : '';
      const canonicalHref = absoluteHref ? normalizeUrlForDedup(absoluteHref) : '';

      if (matchedPhrases.length > 0) {
        const signature = `${current}|${candidate.element}|${normalizedText}|${canonicalHref || candidate.href}`;
        if (!matchDedupe.has(signature)) {
          matchDedupe.add(signature);
          matches.push({
            page: current,
            pageTitle: title,
            element: candidate.element,
            text: candidate.text,
            href: canonicalHref || absoluteHref || candidate.href,
            matchedPhrases: matchedPhrases.join(', '),
          });
        }
      }

      if (absoluteHref && shouldVisitUrl(startUrl, absoluteHref) && !visited.has(normalizeUrlForDedup(absoluteHref))) {
        enqueueUniqueUrl(queue, seenQueued, absoluteHref, isPriorityContactUrl(`${candidate.text} ${absoluteHref}`));
      }
    }
  }

  return {
    startUrl: normalizeUrlForDedup(startUrl) || startUrl,
    pagesVisited: visited.size,
    maxPages,
    pages,
    totalMatches: matches.length,
    matches,
  };
};

const requireDatabase = (res) => {
  if (!pool) {
    res.status(503).json({ error: 'Database is disabled in TEST_MODE (set DATABASE_URL to enable persistence)' });
    return false;
  }
  return true;
};

const toPublicUser = (row) => ({
  id: row.id,
  email: row.email,
  role: row.role,
  credits: row.credits,
  themeColor: row.theme_color,
  brandName: row.brand_name,
});

const authRequired = async (req, res, next) => {
  if (!requireDatabase(res)) {
    return;
  }
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.slice('Bearer '.length);

  try {
    const payload = jwt.verify(token, jwtSecret);
    const { rows } = await pool.query(
      'SELECT id, email, role, credits, theme_color, brand_name FROM users WHERE id = $1',
      [payload.userId]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Session invalid' });
    }

    req.user = toPublicUser(rows[0]);
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return next();
};

app.get('/health', async (_req, res) => {
  if (!pool) {
    return res.status(200).json({ status: 'ok', mode: 'test', database: 'disabled' });
  }

  try {
    await pool.query('SELECT 1');
    return res.status(200).json({ status: 'ok', mode: isTestMode ? 'test' : 'production', database: 'connected' });
  } catch (error) {
    return res.status(503).json({ status: 'error', database: 'unreachable' });
  }
});

app.post('/api/login', async (req, res) => {
  if (!requireDatabase(res)) {
    return;
  }
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
  if (rows.length === 0) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const user = rows[0];
  const validPassword = await bcrypt.compare(password, user.password_hash);
  if (!validPassword) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ userId: user.id }, jwtSecret, { expiresIn: '12h' });
  return res.json({ token, user: toPublicUser(user) });
});

app.get('/api/me', authRequired, (req, res) => {
  return res.json({ user: req.user });
});

app.post('/api/scrape', authRequired, async (req, res) => {
  if (!requireDatabase(res)) {
    return;
  }
  const { creditsToUse = 1, tool = 'Smart Contact Crawler', targetUrl, targetUrls = [], maxPages = 8 } = req.body;

  const creditsCost = Number(creditsToUse);
  if (!Number.isInteger(creditsCost) || creditsCost <= 0) {
    return res.status(400).json({ error: 'creditsToUse must be a positive integer' });
  }

  const sanitizedMaxPages = Math.min(Math.max(Number(maxPages) || 8, 1), 25);

  const rawTargets = [targetUrl, ...(Array.isArray(targetUrls) ? targetUrls : [])].filter(Boolean);
  if (rawTargets.length === 0) {
    return res.status(400).json({ error: 'Provide targetUrl or targetUrls for crawling' });
  }

  const validTargets = [];
  const dedupe = new Set();
  for (const raw of rawTargets) {
    let parsed;
    try {
      parsed = new URL(raw);
    } catch (_error) {
      return res.status(400).json({ error: `Invalid URL provided: ${raw}` });
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).json({ error: `URL must use http/https: ${raw}` });
    }

    const canonical = normalizeUrlForDedup(parsed.toString());
    if (!canonical || dedupe.has(canonical)) {
      continue;
    }

    dedupe.add(canonical);
    validTargets.push(canonical);
  }

  if (validTargets.length === 0) {
    return res.status(400).json({ error: 'No valid unique URLs left after deduplication' });
  }

  const { rows } = await pool.query(
    `
      UPDATE users
      SET credits = credits - $1, updated_at = NOW()
      WHERE id = $2 AND credits >= $1
      RETURNING id, email, role, credits, theme_color, brand_name;
    `,
    [creditsCost, req.user.id]
  );

  if (rows.length === 0) {
    return res.status(400).json({ error: 'Insufficient credits' });
  }

  const crawls = [];
  for (const url of validTargets) {
    const crawlResult = await crawlWebsite({ startUrl: url, maxPages: sanitizedMaxPages });
    crawls.push(crawlResult);
  }

  const mergedPages = [];
  const mergedPagesDedupe = new Set();
  const mergedMatches = [];
  const mergedMatchesDedupe = new Set();

  for (const crawl of crawls) {
    for (const page of crawl.pages) {
      const sig = `${page.url}|${page.status}|${page.title}`;
      if (!mergedPagesDedupe.has(sig)) {
        mergedPagesDedupe.add(sig);
        mergedPages.push(page);
      }
    }

    for (const item of crawl.matches) {
      const sig = `${item.page}|${item.element}|${normalizeText(item.text)}|${item.href}`;
      if (!mergedMatchesDedupe.has(sig)) {
        mergedMatchesDedupe.add(sig);
        mergedMatches.push(item);
      }
    }
  }

  return res.json({
    message: `Crawler executed with ${tool}.`,
    creditsUsed: creditsCost,
    user: toPublicUser(rows[0]),
    sentPayload: {
      tool,
      targetUrl: validTargets[0],
      targetUrls: validTargets,
      uniqueTargetCount: validTargets.length,
      creditsToUse: creditsCost,
      maxPages: sanitizedMaxPages,
    },
    crawl: {
      startUrl: validTargets[0],
      targetUrls: validTargets,
      pagesVisited: crawls.reduce((sum, item) => sum + item.pagesVisited, 0),
      maxPagesPerTarget: sanitizedMaxPages,
      pages: mergedPages,
      totalMatches: mergedMatches.length,
      matches: mergedMatches,
      crawls,
    },
  });
});

app.get('/api/admin/settings', authRequired, adminOnly, async (_req, res) => {
  if (!requireDatabase(res)) {
    return;
  }
  const { rows } = await pool.query(
    `
      SELECT id, email, role, credits, theme_color, brand_name, created_at
      FROM users
      ORDER BY created_at ASC;
    `
  );

  return res.json({ users: rows.map(toPublicUser) });
});

app.patch('/api/admin/settings', authRequired, adminOnly, async (req, res) => {
  if (!requireDatabase(res)) {
    return;
  }
  const { themeColor, brandName } = req.body;

  if (!themeColor || !brandName) {
    return res.status(400).json({ error: 'themeColor and brandName are required' });
  }

  await pool.query(
    `
      UPDATE users
      SET theme_color = $1, brand_name = $2, updated_at = NOW()
      WHERE role = 'client';
    `,
    [themeColor, brandName]
  );

  return res.json({ message: 'Brand settings updated for all client accounts.' });
});

app.post('/api/admin/clients', authRequired, adminOnly, async (req, res) => {
  if (!requireDatabase(res)) {
    return;
  }
  const { email, password, credits = 0 } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const { rows } = await pool.query(
    `
      INSERT INTO users (email, password_hash, role, credits)
      VALUES ($1, $2, 'client', $3)
      RETURNING id, email, role, credits, theme_color, brand_name;
    `,
    [email.toLowerCase().trim(), passwordHash, Number(credits) || 0]
  );

  return res.status(201).json({ user: toPublicUser(rows[0]) });
});

app.patch('/api/admin/clients/:id', authRequired, adminOnly, async (req, res) => {
  if (!requireDatabase(res)) {
    return;
  }
  const { id } = req.params;
  const { password, credits } = req.body;

  const fields = [];
  const values = [];

  if (typeof credits !== 'undefined') {
    fields.push(`credits = $${fields.length + 1}`);
    values.push(Number(credits));
  }

  if (password) {
    const passwordHash = await bcrypt.hash(password, 12);
    fields.push(`password_hash = $${fields.length + 1}`);
    values.push(passwordHash);
  }

  if (fields.length === 0) {
    return res.status(400).json({ error: 'No updates provided' });
  }

  values.push(id);
  const { rows } = await pool.query(
    `
      UPDATE users
      SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${fields.length + 1} AND role = 'client'
      RETURNING id, email, role, credits, theme_color, brand_name;
    `,
    values
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: 'Client not found' });
  }

  return res.json({ user: toPublicUser(rows[0]) });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  return res.status(500).json({ error: 'Unexpected server error' });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
