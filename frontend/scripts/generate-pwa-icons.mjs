/**
 * Regenerate PWA icons from public/FrontFuseLogo.png.
 * Requires: pip install Pillow (Python 3) or npm install sharp
 *
 * Usage: npm run pwa:icons
 */
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const pythonScript = `
from PIL import Image
import os

src = '${root.replace(/\\/g, '/')}/public/FrontFuseLogo.png'
out = '${root.replace(/\\/g, '/')}/public/icons'
os.makedirs(out, exist_ok=True)

img = Image.open(src).convert('RGBA')

def make(size, name, pad=0):
    logo = int(size * (1 - 2*pad))
    off = (size - logo) // 2
    r = img.resize((logo, logo), Image.LANCZOS)
    bg = Image.new('RGBA', (size, size), (11, 14, 21, 255))
    bg.paste(r, (off, off), mask=r.split()[3])
    bg.convert('RGB').save(f'{out}/{name}', 'PNG')
    print(f'  {name}')

make(192, 'pwa-192x192.png')
make(512, 'pwa-512x512.png')
make(192, 'pwa-maskable-192x192.png', pad=0.20)
make(512, 'pwa-maskable-512x512.png', pad=0.20)
make(180, 'apple-touch-icon.png')
print('Done.')
`

console.log('Generating PWA icons…')
try {
  execSync(`python3 -c "${pythonScript.replace(/"/g, '\\"')}"`, { stdio: 'inherit' })
} catch {
  console.error('python3 + Pillow not available. Install with: pip install Pillow')
  process.exit(1)
}
