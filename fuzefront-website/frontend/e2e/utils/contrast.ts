import type { Page } from '@playwright/test'
import { PNG } from 'pngjs'

/**
 * Pixel-based "is this text actually visible against what's behind it" check.
 *
 * WHY NOT JUST AN AXE-CORE / CSS COLOR-CONTRAST SCAN: this site's contrast
 * bugs so far (transparent-header-over-hero, and the hero's own gradient
 * silently getting replaced by a dot-pattern background-image) both involve
 * text sitting over a BACKGROUND-IMAGE (a CSS gradient or pattern), not a
 * plain `background-color`. A checker that resolves "effective background"
 * by walking up the DOM for the nearest ancestor's `background-color` never
 * sees the image layer at all — it would have called the broken hero (white
 * text over a see-through section, with only a background-color chain of
 * `transparent` all the way to `white`) EITHER a false failure (if it
 * defaults unknown-background to white, coincidentally right) OR a false
 * pass (if it treats "has a background-image" as "impossible to verify,
 * skip" — which is what axe-core's color-contrast rule actually does).
 * Neither is a real answer for a page whose whole look is built from
 * gradients.
 *
 * So this samples the REAL RENDERED PIXELS from a screenshot instead: for
 * each visible piece of text, screenshot just its own bounding box, exclude
 * the pixels that are close to the text's own CSS color (the glyphs) and
 * average what's left (the background actually behind it, gradient or not),
 * then compute the standard WCAG relative-luminance contrast ratio between
 * the text color and that measured background.
 */

export interface ContrastViolation {
  selector: string
  text: string
  textColor: string
  backgroundColor: string
  ratio: number
  required: number
  fontSizePx: number
  fontWeight: number
  rect: { x: number; y: number; width: number; height: number }
}

interface Candidate {
  selector: string
  text: string
  color: [number, number, number]
  fontSizePx: number
  fontWeight: number
  rect: { x: number; y: number; width: number; height: number }
}

const GLYPH_COLOR_DISTANCE = 60 // Euclidean RGB distance below which a pixel counts as "text ink", not background.
const MIN_BACKGROUND_SAMPLE_RATIO = 0.05 // If fewer than 5% of pixels look like background, the box is unreliable — widen it.

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const chan = (c: number) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

function requiredRatio(fontSizePx: number, fontWeight: number): number {
  // WCAG 2.1 SC 1.4.3: large text (>=24px, or >=18.66px and bold) needs 3:1; everything else needs 4.5:1.
  const isLarge = fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700)
  return isLarge ? 3.0 : 4.5
}

/** Collects every visible, directly-text-bearing element on the current page. */
async function collectCandidates(page: Page): Promise<Candidate[]> {
  return page.evaluate(() => {
    function cssSelector(el: Element): string {
      if (el.id) return `#${el.id}`
      const tag = el.tagName.toLowerCase()
      const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''
      return tag + cls
    }

    function parseRgb(value: string): [number, number, number] | null {
      const m = value.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/)
      if (!m) return null
      const alpha = m[4] === undefined ? 1 : Number(m[4])
      if (alpha === 0) return null // fully transparent text is not a contrast concern
      return [Number(m[1]), Number(m[2]), Number(m[3])]
    }

    const out: Candidate[] = []
    const all = document.body.querySelectorAll('*')
    for (const el of Array.from(all)) {
      let directText = ''
      for (const node of Array.from(el.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) directText += node.textContent ?? ''
      }
      directText = directText.trim()
      if (!directText) continue

      const htmlEl = el as HTMLElement
      // checkOpacity catches an element mid-fade-in (Framer Motion's transient
      // opacity:0 state) as correctly invisible, rather than measuring its
      // (currently blank) rendered pixels as a contrast failure.
      // @ts-expect-error checkVisibility is supported in current Chromium, not yet in TS DOM lib
      if (typeof htmlEl.checkVisibility === 'function' && !htmlEl.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue
      if (htmlEl.closest('[aria-hidden="true"]')) continue

      const rect = htmlEl.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) continue
      // Require the FULL box inside the viewport, not just "some overlap" —
      // a box straddling the edge (e.g. top: -12px) would otherwise get its
      // screenshot clip silently clamped to a different region than the
      // element itself, sampling the wrong pixels entirely as "background".
      // Safe to require full containment: the caller re-scans at every
      // viewport-height scroll offset, so a normal (shorter-than-viewport)
      // text element is fully in-frame at some offset regardless.
      if (rect.top < 0 || rect.left < 0 || rect.bottom > window.innerHeight || rect.right > window.innerWidth) continue

      // Occlusion guard: something else drawn on top (a fixed banner, an open
      // dropdown/modal, a FIXED HEADER that content scrolls underneath) means
      // some of the pixels we'd screenshot aren't this element at all —
      // measuring them would blame this element for an overlay's colors. A
      // fixed header is the common case in practice: it occupies the same
      // screen rows on every scroll stop, so an element whose top edge
      // happens to land just under it at some stop is occluded there even
      // though its CENTER is well clear of the header. So hit-test several
      // points across the box, not just the center — the four corners are
      // exactly where a partial top/bottom/side overlap would show up first.
      const points: [number, number][] = [
        [rect.left + rect.width / 2, rect.top + rect.height / 2],
        [rect.left + 1, rect.top + 1],
        [rect.right - 1, rect.top + 1],
        [rect.left + 1, rect.bottom - 1],
        [rect.right - 1, rect.bottom - 1],
      ]
      const occluded = points.some(([px, py]) => {
        const topEl = document.elementFromPoint(px, py)
        return !topEl || (!htmlEl.contains(topEl) && !topEl.contains(htmlEl))
      })
      if (occluded) continue

      const cs = getComputedStyle(htmlEl)
      // A gradient/pattern-filled heading (`.gradient-text`: background-clip:
      // text + -webkit-text-fill-color: transparent) renders its glyphs from
      // that background layer, not from `color` — `color` is left at
      // whatever it inherited (often black) and is never actually painted.
      // Checking THAT value against the page background would measure a
      // color that's never on screen. Rather than mismeasure it, skip it —
      // a known, honest gap, not a false "it's fine."
      const fillColor = (cs as unknown as { webkitTextFillColor?: string }).webkitTextFillColor
      if (fillColor && /^rgba\(\s*[\d.]+,\s*[\d.]+,\s*[\d.]+,\s*0\s*\)$/.test(fillColor.trim())) continue

      const color = parseRgb(cs.color)
      if (!color) continue

      out.push({
        selector: cssSelector(htmlEl),
        text: directText.slice(0, 60),
        color,
        fontSizePx: parseFloat(cs.fontSize) || 16,
        fontWeight: parseInt(cs.fontWeight, 10) || 400,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      })
    }
    return out
  })
}

/** Screenshots `rect` and returns the average "background" color, excluding pixels close to `textColor`. */
async function sampleBackground(page: Page, rect: Candidate['rect'], textColor: [number, number, number]): Promise<[number, number, number] | null> {
  const clip = {
    x: Math.max(0, Math.floor(rect.x)),
    y: Math.max(0, Math.floor(rect.y)),
    width: Math.max(1, Math.ceil(rect.width)),
    height: Math.max(1, Math.ceil(rect.height)),
  }
  let buf: Buffer
  try {
    buf = await page.screenshot({ clip })
  } catch {
    return null // element scrolled out / clip off the rendered page — skip rather than false-fail
  }
  const png = PNG.sync.read(buf)

  const sumFrom = (predicate: (r: number, g: number, b: number) => boolean) => {
    let r = 0, g = 0, b = 0, n = 0
    for (let i = 0; i < png.data.length; i += 4) {
      const pr = png.data[i], pg = png.data[i + 1], pb = png.data[i + 2]
      if (predicate(pr, pg, pb)) {
        r += pr; g += pg; b += pb; n++
      }
    }
    return n > 0 ? ([r / n, g / n, b / n] as [number, number, number]) : null
  }

  const isGlyph = (r: number, g: number, b: number) => {
    const dr = r - textColor[0], dg = g - textColor[1], db = b - textColor[2]
    return Math.sqrt(dr * dr + dg * dg + db * db) < GLYPH_COLOR_DISTANCE
  }

  const totalPixels = png.data.length / 4
  const backgroundCount = (() => {
    let n = 0
    for (let i = 0; i < png.data.length; i += 4) {
      if (!isGlyph(png.data[i], png.data[i + 1], png.data[i + 2])) n++
    }
    return n
  })()

  if (backgroundCount / totalPixels >= MIN_BACKGROUND_SAMPLE_RATIO) {
    return sumFrom((r, g, b) => !isGlyph(r, g, b))
  }
  // Box is nearly all "glyph-colored" pixels (e.g. a bold heading that fills its
  // own tight box) — fall back to every pixel, unfiltered, as the best estimate.
  return sumFrom(() => true)
}

/**
 * Checks every visible text element on the CURRENT page (scroll position and
 * all) for WCAG-adequate contrast against its actually-rendered background.
 * Call once per scroll position to cover a full page (see contrast.spec.ts).
 */
export async function checkVisibleTextContrast(page: Page): Promise<ContrastViolation[]> {
  const candidates = await collectCandidates(page)
  const violations: ContrastViolation[] = []

  for (const c of candidates) {
    const bg = await sampleBackground(page, c.rect, c.color)
    if (!bg) continue
    const ratio = contrastRatio(c.color, bg)
    const required = requiredRatio(c.fontSizePx, c.fontWeight)
    if (ratio < required) {
      violations.push({
        selector: c.selector,
        text: c.text,
        textColor: `rgb(${c.color.join(', ')})`,
        backgroundColor: `rgb(${bg.map((v) => Math.round(v)).join(', ')})`,
        ratio: Math.round(ratio * 100) / 100,
        required,
        fontSizePx: c.fontSizePx,
        fontWeight: c.fontWeight,
        rect: c.rect,
      })
    }
  }
  return violations
}

/**
 * Scans the WHOLE page (not just the initial viewport) by scrolling through
 * it in viewport-height increments and running {@link checkVisibleTextContrast}
 * at each stop. Waits after each scroll for Framer Motion's scroll-triggered
 * fade-ins (this site's longest is `duration: 0.8, delay: 0.7`, ~1.5s total)
 * to finish, so elements aren't measured mid-transition.
 */
export async function scanEntirePageTextContrast(page: Page): Promise<ContrastViolation[]> {
  await page.evaluate(() => window.scrollTo(0, 0))
  const { pageHeight, viewportHeight } = await page.evaluate(() => ({
    pageHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
  }))

  const seen = new Set<string>()
  const violations: ContrastViolation[] = []
  let offset = 0
  // Step by 70% of the viewport (30% overlap between consecutive stops) so an
  // element that would straddle one stop's boundary — and so be excluded
  // there as "not fully in viewport" (see collectCandidates) — is still fully
  // contained at the next stop instead of silently never being checked.
  const step = Math.max(1, Math.floor(viewportHeight * 0.7))
  do {
    await page.evaluate((y) => window.scrollTo(0, y), offset)
    await page.waitForTimeout(1500)
    for (const v of await checkVisibleTextContrast(page)) {
      const key = `${v.selector}|${v.text}|${Math.round(v.rect.x)}|${Math.round(v.rect.y)}`
      if (seen.has(key)) continue
      seen.add(key)
      violations.push(v)
    }
    offset += step
  } while (offset < pageHeight)

  return violations
}
