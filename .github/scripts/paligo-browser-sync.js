/**
 * paligo-browser-sync.js
 * Syncs MDX content back to Paligo by automating the Paligo web UI via Playwright.
 * Used as the primary sync method (REST API requires special plan/auth).
 *
 * Required env vars (GitHub Secrets):
 *   PALIGO_INSTANCE   — Paligo subdomain, e.g. "smartbear"
 *   PALIGO_USERNAME   — Paligo login email
 *   PALIGO_PASSWORD   — Paligo login password
 *   CHANGED_FILES     — comma-separated list of changed MDX paths (set by workflow)
 *
 * Screenshots of each step are saved to /tmp/paligo-screenshots/ and uploaded
 * as a GitHub Actions artifact so you can see exactly what happened.
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { convertMdxToDocbook } from './mdx-to-docbook.js';

// ── Config ────────────────────────────────────────────────────────────────────

const INSTANCE = process.env.PALIGO_INSTANCE;
const EMAIL    = process.env.PALIGO_USERNAME;
const PASSWORD = process.env.PALIGO_PASSWORD;
const BASE_URL = `https://${INSTANCE}.paligoapp.com`;
const SS_DIR   = '/tmp/paligo-screenshots';

if (!INSTANCE || !EMAIL || !PASSWORD) {
  console.error('Missing required env vars: PALIGO_INSTANCE, PALIGO_USERNAME, PALIGO_PASSWORD');
  process.exit(1);
}

fs.mkdirSync(SS_DIR, { recursive: true });

// ── Helpers ───────────────────────────────────────────────────────────────────

async function shot(page, name) {
  const file = path.join(SS_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`   📸 ${file}`);
  return file;
}

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

// ── Login ─────────────────────────────────────────────────────────────────────

async function login(page) {
  console.log(`\n🔑 Logging in to ${BASE_URL}...`);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  await shot(page, '01-landing');

  const url = page.url();
  console.log(`   Landing URL: ${url}`);

  // Handle SSO redirect (Okta, Microsoft, Google)
  if (url.includes('okta.com') || url.includes('microsoftonline.com') || url.includes('google.com')) {
    console.log('   SSO detected — filling SSO form...');
    await page.locator('input[type="email"], input[name="identifier"], input[name="username"]').first().fill(EMAIL);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
    await shot(page, '02-sso-email');
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    await page.keyboard.press('Enter');
    await page.waitForLoadState('networkidle', { timeout: 30000 });
    await shot(page, '03-sso-after-submit');
  } else {
    // Standard Paligo login form
    const emailSel = page.locator('input[type="email"], input[name="email"], input[name="username"], #email, #username').first();
    const passSel  = page.locator('input[type="password"], input[name="password"], #password').first();

    await emailSel.waitFor({ timeout: 10000 });
    await emailSel.fill(EMAIL);
    await passSel.fill(PASSWORD);
    await shot(page, '02-filled-login');

    // Click submit or press Enter
    const submitBtn = page.locator('button[type="submit"], input[type="submit"], button:has-text("Sign in"), button:has-text("Log in")').first();
    if (await submitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await submitBtn.click();
    } else {
      await page.keyboard.press('Enter');
    }
    await page.waitForLoadState('networkidle', { timeout: 30000 });
    await shot(page, '03-after-login');
  }

  const finalUrl = page.url();
  if (finalUrl.includes('login') || finalUrl.includes('signin') || finalUrl.includes('okta')) {
    // Might need MFA — take screenshot and fail with clear message
    await shot(page, '03-login-stuck');
    throw new Error(
      `Login appears stuck — still on auth page: ${finalUrl}\n` +
      `Check the screenshot. If MFA is required, set up a service account without MFA.`
    );
  }
  console.log(`   ✅ Logged in. URL: ${finalUrl}`);
}

// ── Navigate and sync one topic ───────────────────────────────────────────────

async function syncTopic(page, paligoId, xmlContent, title) {
  // Write XML to a temp file (for file-upload approaches)
  const xmlFile = `/tmp/topic-${paligoId}.xml`;
  fs.writeFileSync(xmlFile, xmlContent, 'utf8');

  console.log(`\n   Navigating to topic ${paligoId}...`);

  // Try URL patterns Paligo uses for direct topic navigation
  const urlCandidates = [
    `${BASE_URL}/app/#/document/${paligoId}`,
    `${BASE_URL}/app/#/resource/${paligoId}`,
    `${BASE_URL}/app/editor/${paligoId}`,
  ];

  let loaded = false;
  for (const url of urlCandidates) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(3000);
      loaded = true;
      console.log(`   Loaded: ${url}`);
      break;
    } catch {
      console.log(`   URL not found: ${url}`);
    }
  }

  if (!loaded) {
    // Fall back to the main app and search
    await page.goto(`${BASE_URL}/app/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
  }

  await shot(page, `topic-${paligoId}-01-opened`);

  // ── Strategy 1: Look for a "Source" / "XML" / "Edit source" button in toolbar ──
  const sourceSelectors = [
    'button:has-text("Source")',
    'button:has-text("XML")',
    '[title*="Source"]',
    '[title*="source"]',
    '[aria-label*="Source"]',
    '[data-icon="source"]',
    '.source-button',
    'button:has-text("Edit XML")',
    'button:has-text("View source")',
  ];

  for (const sel of sourceSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
      console.log(`   Found source button: ${sel}`);
      await btn.click();
      await page.waitForTimeout(2000);
      await shot(page, `topic-${paligoId}-02-source-view`);

      // Try to replace content in the source editor (CodeMirror, Monaco, or textarea)
      const editorSelectors = [
        '.CodeMirror textarea',
        '.cm-content',
        '.monaco-editor textarea',
        '.source-editor textarea',
        'textarea[class*="xml"]',
        'textarea[class*="source"]',
      ];

      for (const edSel of editorSelectors) {
        const ed = page.locator(edSel).first();
        if (await ed.isVisible({ timeout: 1500 }).catch(() => false)) {
          await ed.click();
          await page.keyboard.press('Control+A');
          await ed.fill(xmlContent);
          await page.keyboard.press('Control+S');
          await page.waitForTimeout(2000);
          await shot(page, `topic-${paligoId}-03-saved`);
          console.log(`   ✅ Content replaced via source editor.`);
          return;
        }
      }
      // Editor not found in source view — screenshot and continue to next strategy
      await shot(page, `topic-${paligoId}-source-editor-not-found`);
      break;
    }
  }

  // ── Strategy 2: Look for "Replace" / "Import" / "Upload" in a context menu ──
  // Right-click on the topic title in the document tree
  const topicNodeSelectors = [
    `[data-id="${paligoId}"]`,
    `[data-resource-id="${paligoId}"]`,
    `.document-tree-item:has-text("${title}")`,
    `.tree-item:has-text("${title}")`,
  ];

  for (const sel of topicNodeSelectors) {
    const node = page.locator(sel).first();
    if (await node.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log(`   Found topic node: ${sel}, right-clicking...`);
      await node.click({ button: 'right' });
      await page.waitForTimeout(1000);
      await shot(page, `topic-${paligoId}-02-context-menu`);

      // Click "Replace content" / "Import" in context menu
      const menuItemSelectors = [
        'li:has-text("Replace")',
        'li:has-text("Import")',
        'li:has-text("Upload")',
        '[role="menuitem"]:has-text("Replace")',
        '[role="menuitem"]:has-text("Import")',
      ];

      for (const menuSel of menuItemSelectors) {
        const menuItem = page.locator(menuSel).first();
        if (await menuItem.isVisible({ timeout: 1500 }).catch(() => false)) {
          await menuItem.click();
          await page.waitForTimeout(1500);
          await shot(page, `topic-${paligoId}-03-import-dialog`);

          // Handle file upload dialog
          const fileInput = page.locator('input[type="file"]').first();
          if (await fileInput.isVisible({ timeout: 3000 }).catch(() => false)) {
            await fileInput.setInputFiles(xmlFile);
            await page.waitForTimeout(1000);
            // Click confirm/upload button
            const confirmBtn = page.locator('button:has-text("Upload"), button:has-text("Import"), button:has-text("OK"), button:has-text("Confirm")').first();
            if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
              await confirmBtn.click();
            }
            await page.waitForLoadState('networkidle', { timeout: 20000 });
            await shot(page, `topic-${paligoId}-04-upload-done`);
            console.log(`   ✅ Content replaced via file upload.`);
            return;
          }
          break;
        }
      }
      break;
    }
  }

  // ── No strategy worked — save screenshot for manual diagnosis ──────────────
  await shot(page, `topic-${paligoId}-FAILED-needs-manual-check`);
  throw new Error(
    `Could not find XML edit UI for topic ${paligoId} ("${title}").\n` +
    `Check the screenshots in the GitHub Actions artifact "paligo-screenshots".\n` +
    `The selectors may need adjusting for your Paligo instance's UI.`
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

const changedFiles = (process.env.CHANGED_FILES || '')
  .split(',').map(f => f.trim()).filter(Boolean);

if (!changedFiles.length) {
  console.log('No changed MDX files to process.');
  process.exit(0);
}

console.log(`Processing ${changedFiles.length} file(s)...\n`);

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({
  viewport: { width: 1400, height: 900 },
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
});
const page = await context.newPage();

// Log console errors from the page
page.on('console', msg => {
  if (msg.type() === 'error') console.log(`   [browser error] ${msg.text()}`);
});

let success = 0, failed = 0;

try {
  await login(page);

  for (const filePath of changedFiles) {
    try {
      const mdxContent = fs.readFileSync(filePath, 'utf8');
      const { paligoId, title } = parseFrontmatter(mdxContent);

      if (!paligoId) {
        console.warn(`⚠  Skipping ${filePath} — no paligoId in frontmatter.`);
        continue;
      }

      console.log(`\n📄 ${filePath}`);
      console.log(`   Title:     ${title}`);
      console.log(`   Paligo ID: ${paligoId}`);

      const xml = await convertMdxToDocbook(mdxContent, { topicTitle: title, topicId: paligoId });
      await syncTopic(page, paligoId, xml, title);
      success++;
    } catch (err) {
      console.error(`   ❌ Failed: ${err.message}\n`);
      failed++;
    }
  }
} finally {
  await browser.close();
}

console.log(`\n────────────────────────────────────`);
console.log(`Sync complete: ${success} succeeded, ${failed} failed.`);
console.log(`Screenshots saved in GitHub Actions artifact "paligo-screenshots".`);

if (failed > 0) process.exit(1);
