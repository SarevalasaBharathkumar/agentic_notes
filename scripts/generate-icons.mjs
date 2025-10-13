// Generate PNG and ICO icons from public/favicon.svg
// Uses @resvg/resvg-js (WASM) + png-to-ico (JS) to avoid native deps

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import pngToIco from 'png-to-ico'

const root = process.cwd()
const pubDir = path.join(root, 'public')
const srcSvg = path.join(pubDir, 'favicon.svg')

const targets = [
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'apple-touch-icon-180.png', size: 180 },
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
]

async function renderPng(svgData, size) {
  // Fit by width to a square viewBox SVG
  const resvg = new Resvg(svgData, {
    fitTo: { mode: 'width', value: size },
    background: 'transparent',
  })
  const pngData = resvg.render().asPng()
  return pngData
}

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true })
}

async function main() {
  const svg = await readFile(srcSvg)
  await ensureDir(pubDir)

  // Write PNG targets
  for (const t of targets) {
    const outPath = path.join(pubDir, t.file)
    const png = await renderPng(svg, t.size)
    await writeFile(outPath, png)
    console.log(`Wrote ${t.file}`)
  }

  // Write ICO with common sizes
  const icoSizes = [16, 32, 48, 64]
  const pngBuffers = []
  for (const s of icoSizes) {
    pngBuffers.push(await renderPng(svg, s))
  }
  const icoBuffer = await pngToIco(pngBuffers)
  await writeFile(path.join(pubDir, 'favicon.ico'), icoBuffer)
  console.log('Wrote favicon.ico')
}

main().catch((err) => {
  console.error('Icon generation failed:', err)
  process.exit(1)
})
