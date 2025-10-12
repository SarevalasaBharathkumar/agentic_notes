#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'

function escapeHtml(input) {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function renderInline(md) {
  md = md.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`)
  md = md.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  md = md.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>')
  md = md.replace(/`([^`]+)`/g, '<code>$1</code>')
  return md
}

function renderHeadings(text) {
  return text
    .replace(/^######\s+(.+)$/gim, '<h6>$1</h6>')
    .replace(/^#####\s+(.+)$/gim, '<h5>$1</h5>')
    .replace(/^####\s+(.+)$/gim, '<h4>$1</h4>')
    .replace(/^###\s+(.+)$/gim, '<h3>$1</h3>')
    .replace(/^##\s+(.+)$/gim, '<h2>$1</h2>')
    .replace(/^#\s+(.+)$/gim, '<h1>$1</h1>')
}

function toHtml(markdown) {
  const escaped = escapeHtml(markdown || '')
  let html = renderHeadings(escaped)
  html = renderInline(html)
  const parts = html.split(/\n\s*\n/).map(p => {
    if (/^\s*<(h\d|ul|ol|pre|table|blockquote)/.test(p)) return p
    return `<p>${p.replaceAll('\n', '<br/>')}</p>`
  })
  return parts.join('\n')
}

async function main() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env.')
    process.exit(1)
  }
  const supabase = createClient(url, key)
  const { data: notes, error } = await supabase.from('notes').select('id, content')
  if (error) throw error
  let updated = 0
  for (const n of notes) {
    const content = n.content || ''
    if (/^\s*</.test(content)) continue // already HTML
    const html = toHtml(content)
    const { error: upErr } = await supabase.from('notes').update({ content: html }).eq('id', n.id)
    if (upErr) {
      console.error('Update failed for', n.id, upErr)
      continue
    }
    updated++
  }
  console.log('Migration completed. Updated notes:', updated)
}

main().catch(e => { console.error(e); process.exit(1) })

