import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pubDir = path.join(root, 'public');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getSiteUrl() {
  const env = process.env;
  let url = env.VITE_SITE_URL || env.SITE_URL || (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : 'https://agentic-notes.vercel.app');
  if (!url.startsWith('http')) url = `https://${url}`;
  if (url.endsWith('/')) url = url.slice(0, -1);
  return url;
}

function writeSitemap(siteUrl) {
  const paths = ['/', '/about', '/features', '/blog', '/privacy-policy'];
  const today = new Date().toISOString().split('T')[0];
  const urlset = paths
    .map(p => (
`  <url>
    <loc>${siteUrl}${p}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${p === '/' ? '1.0' : '0.8'}</priority>
  </url>`
  )).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  `${urlset}\n` +
  `</urlset>\n`;
  fs.writeFileSync(path.join(pubDir, 'sitemap.xml'), xml, 'utf8');
  console.log('Wrote public/sitemap.xml');
}

function upsertRobots(siteUrl) {
  const robotsPath = path.join(pubDir, 'robots.txt');
  let robots = '';
  if (fs.existsSync(robotsPath)) {
    robots = fs.readFileSync(robotsPath, 'utf8');
    // Remove existing Sitemap lines to avoid duplicates
    robots = robots.split(/\r?\n/).filter(l => !/^sitemap:/i.test(l.trim())).join('\n').trim();
  } else {
    robots = `User-agent: *\nAllow: /`;
  }
  const withSitemap = robots + `\n\nSitemap: ${siteUrl}/sitemap.xml\n`;
  fs.writeFileSync(robotsPath, withSitemap, 'utf8');
  console.log('Updated public/robots.txt');
}

ensureDir(pubDir);
const siteUrl = getSiteUrl();
writeSitemap(siteUrl);
upsertRobots(siteUrl);
