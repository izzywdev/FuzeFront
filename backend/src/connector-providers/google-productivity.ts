import axios from 'axios'
import type { ConnectorDefinition, ConnectorActionContext } from '../connector-platform'

const googleOAuth = {
  authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
  clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
  authorizationParameters: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
}

const identityScopes = ['openid', 'email', 'profile']

async function identity(accessToken: string): Promise<string> {
  const response = await axios.get('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` }, timeout: 10000,
  })
  const email = response.data?.email
  if (typeof email !== 'string' || !email || response.data?.email_verified !== true) {
    throw new Error('Google account identity is unavailable or unverified')
  }
  return email
}

function resourceId(input: unknown, label: string): string {
  if (typeof input !== 'string' || !/^[A-Za-z0-9_-]{10,256}$/.test(input)) {
    throw new Error(`${label} must be a Google resource ID`)
  }
  return input
}

function sheetRange(input: unknown): string {
  if (typeof input !== 'string' || input.length < 1 || input.length > 256 ||
      Array.from(input).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    throw new Error('range must be a bounded A1 notation range')
  }
  return input
}

async function read(url: string, { accessToken }: ConnectorActionContext, params?: Record<string, unknown>): Promise<unknown> {
  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${accessToken}` }, params, timeout: 15000,
    maxContentLength: 5 * 1024 * 1024,
  })
  return response.data
}

/** Read-only, separately authorized credentials; resource IDs are supplied by the caller. */
export const googleProductivityProviders: ConnectorDefinition[] = [
  {
    ...googleOAuth,
    id: 'google-sheets',
    name: 'Google Sheets',
    description: 'Read spreadsheet metadata and cell values',
    identity,
    redirectUriEnv: 'GOOGLE_SHEETS_OAUTH_REDIRECT_URI',
    scopes: [...identityScopes, 'https://www.googleapis.com/auth/spreadsheets.readonly'],
    actions: {
      spreadsheet: context => read(
        `https://sheets.googleapis.com/v4/spreadsheets/${resourceId(context.query.spreadsheet_id, 'spreadsheet_id')}`,
        context, { fields: 'spreadsheetId,spreadsheetUrl,properties(title,locale,timeZone),sheets(properties(sheetId,title,index,gridProperties))' },
      ),
      values: context => read(
        `https://sheets.googleapis.com/v4/spreadsheets/${resourceId(context.query.spreadsheet_id, 'spreadsheet_id')}/values/${encodeURIComponent(sheetRange(context.query.range))}`,
        context, { valueRenderOption: 'FORMATTED_VALUE', majorDimension: 'ROWS' },
      ),
    },
  },
  {
    ...googleOAuth,
    id: 'google-docs',
    name: 'Google Docs',
    description: 'Read document text and structure',
    identity,
    redirectUriEnv: 'GOOGLE_DOCS_OAUTH_REDIRECT_URI',
    scopes: [...identityScopes, 'https://www.googleapis.com/auth/documents.readonly'],
    actions: {
      document: context => read(
        `https://docs.googleapis.com/v1/documents/${resourceId(context.query.document_id, 'document_id')}`,
        context, { includeTabsContent: true, fields: 'documentId,title,tabs(tabProperties,documentTab(body(content)))' },
      ),
    },
  },
]
