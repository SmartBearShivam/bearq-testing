/**
 * sync.js
 * Reads changed MDX files, extracts paligoId from frontmatter,
 * converts to DocBook XML, and pushes to Paligo automatically.
 *
 * No manifest file needed — each MDX file carries its own mapping
 * via a `paligoId` field in the frontmatter:
 *
 *   ---
 *   title: "Overview"
 *   description: "..."
 *   paligoId: "3740300"
 *   ---
 *
 * Environment variables (set as GitHub Secrets):
 *   PALIGO_API_TOKEN  — your Paligo API token
 *   PALIGO_INSTANCE   — your Paligo subdomain (e.g. "smartbear")
 *   CHANGED_FILES     — comma-separated list of changed file paths (set by workflow)
 */

import fs from 'fs';
import { convertMdxToDocbook } from './mdx-to-docbook.js';
import { pushToPaligo } from './paligo-api.js';

// ── Frontmatter parser ────────────────────────────────────────────────────────

/**
 * Extracts fields from YAML frontmatter without external dependencies.
 * Handles simple key: "value" and key: value formats.
 * @param {string} content - Raw MDX file content
 * @returns {{ title?: string, paligoId?: string, description?: string }}
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const fields = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*"?([^"]*)"?\s*$/);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return fields;
}

// ── Process changed files ─────────────────────────────────────────────────────

const changedFiles = (process.env.CHANGED_FILES || '')
  .split(',')
  .map(f => f.trim())
  .filter(Boolean);

if (changedFiles.length === 0) {
  console.log('No changed MDX files to process.');
  process.exit(0);
}

console.log(`Processing ${changedFiles.length} file(s)...\n`);

let successCount = 0;
let failCount = 0;

for (const filePath of changedFiles) {
  const normalizedPath = filePath.replace(/\\/g, '/');

  try {
    // Read MDX source
    const mdxContent = fs.readFileSync(normalizedPath, 'utf8');

    // Extract paligoId and title from frontmatter
    const { paligoId, title } = parseFrontmatter(mdxContent);

    if (!paligoId) {
      console.warn(`⚠️  Skipping ${normalizedPath} — no paligoId found in frontmatter.`);
      console.warn(`   Add this to the file's frontmatter: paligoId: "YOUR_TOPIC_ID"\n`);
      continue;
    }

    if (!title) {
      console.warn(`⚠️  Skipping ${normalizedPath} — no title found in frontmatter.\n`);
      continue;
    }

    console.log(`📄 ${normalizedPath}`);
    console.log(`   Title:     ${title}`);
    console.log(`   Paligo ID: ${paligoId}`);

    // Convert MDX → DocBook XML
    const docbookXml = await convertMdxToDocbook(mdxContent, {
      topicTitle: title,
      topicId: paligoId,
    });

    // Push to Paligo
    await pushToPaligo({
      paligoId,
      xmlContent: docbookXml,
      label: `Auto-synced from GitHub — ${new Date().toISOString()}`,
    });

    console.log(`   ✅ Pushed to Paligo successfully.\n`);
    successCount++;

  } catch (err) {
    console.error(`   ❌ Failed: ${normalizedPath} — ${err.message}\n`);
    failCount++;
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`────────────────────────────────────`);
console.log(`Sync complete: ${successCount} succeeded, ${failCount} failed.`);

if (failCount > 0) process.exit(1);
