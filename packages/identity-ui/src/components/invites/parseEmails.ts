import Papa from 'papaparse'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface ParsedEmail {
  email: string
  valid: boolean
}

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim())
}

/** Parse newline/comma/semicolon-separated emails from a textarea blob. */
export function parseEmailText(text: string): ParsedEmail[] {
  const tokens = text
    .split(/[\n,;]+/)
    .map((t) => t.trim())
    .filter(Boolean)
  return dedupe(tokens)
}

/**
 * Parse a CSV file/string into emails. Detects an `email` column (case-insensitive)
 * and otherwise falls back to the first column of each row. Handles quoted fields,
 * CRLF, and BOM via PapaParse.
 */
export function parseCsv(content: string): ParsedEmail[] {
  const result = Papa.parse<string[]>(content.replace(/^﻿/, ''), {
    skipEmptyLines: true,
  })
  const rows = (result.data as unknown as string[][]) ?? []
  if (rows.length === 0) return []

  // Detect header row containing an "email" column.
  const header = rows[0].map((c) => String(c).trim().toLowerCase())
  const emailIdx = header.indexOf('email')
  let dataRows = rows
  let colIdx = 0
  if (emailIdx !== -1) {
    colIdx = emailIdx
    dataRows = rows.slice(1)
  } else if (header.some((c) => c === 'role' || c === 'name')) {
    // Header present but no email column — take first column of body rows.
    dataRows = rows.slice(1)
  }

  const tokens = dataRows
    .map((row) => String(row[colIdx] ?? '').trim())
    .filter(Boolean)
  return dedupe(tokens)
}

function dedupe(tokens: string[]): ParsedEmail[] {
  const seen = new Set<string>()
  const out: ParsedEmail[] = []
  for (const raw of tokens) {
    const email = raw.toLowerCase()
    if (seen.has(email)) continue
    seen.add(email)
    out.push({ email: raw, valid: isValidEmail(raw) })
  }
  return out
}
