/**
 * paligo-api.js
 * Thin wrapper around the Paligo REST API for updating topics.
 *
 * Paligo API base: https://{instance}.paligoapp.com/api/v1
 * Auth: Bearer token (set as PALIGO_API_TOKEN secret in GitHub)
 *
 * Docs: https://paligo.net/docs/en/api-reference.html
 */

const PALIGO_INSTANCE = process.env.PALIGO_INSTANCE;
const PALIGO_API_TOKEN = process.env.PALIGO_API_TOKEN;
const PALIGO_USERNAME = process.env.PALIGO_USERNAME;

if (!PALIGO_INSTANCE || !PALIGO_API_TOKEN || !PALIGO_USERNAME) {
  throw new Error(
    'Missing required environment variables: PALIGO_INSTANCE, PALIGO_USERNAME and PALIGO_API_TOKEN must all be set.'
  );
}

const BASE_URL = `https://${PALIGO_INSTANCE}.paligoapp.com/api/v1`;

// Paligo uses HTTP Basic Auth: username (email) + API token
const basicAuth = Buffer.from(`${PALIGO_USERNAME}:${PALIGO_API_TOKEN}`).toString('base64');

const headers = {
  'Authorization': `Basic ${basicAuth}`,
  'Content-Type': 'application/xml',
  'Accept': 'application/json',
};

// ── Push XML content to an existing Paligo topic ─────────────────────────────

/**
 * Updates a Paligo topic's content with new DocBook XML.
 *
 * @param {object} params
 * @param {string} params.paligoId    - Paligo document/topic ID (numeric string)
 * @param {string} params.xmlContent  - Full DocBook 5 XML string
 * @param {string} params.label       - Optional label for the update (audit trail)
 */
export async function pushToPaligo({ paligoId, xmlContent, label }) {
  const url = `${BASE_URL}/documents/${paligoId}/content`;

  console.log(`   → PUT ${url}`);

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      ...headers,
      'X-Paligo-Label': label || 'GitHub sync',
    },
    body: xmlContent,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Paligo API error ${response.status} for topic ${paligoId}: ${errorText}`
    );
  }

  const result = await response.json().catch(() => ({}));
  return result;
}

// ── Fetch current content of a Paligo topic (useful for diffing/debugging) ───

/**
 * @param {string} paligoId
 * @returns {string} Raw XML content of the topic
 */
export async function fetchPaligoTopic(paligoId) {
  const url = `${BASE_URL}/documents/${paligoId}/content`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${PALIGO_API_TOKEN}`,
      'Accept': 'application/xml',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to fetch topic ${paligoId}: ${response.status} — ${errorText}`
    );
  }

  return response.text();
}
