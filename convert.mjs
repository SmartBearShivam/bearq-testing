import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';

// ─────────────────────────────────────────────────────────────────────────────
// Paths — turnkey: drop a Paligo export in "_Paligo In", get an Astro project
// in "_Astro Out".
// ─────────────────────────────────────────────────────────────────────────────
// Usage:
//   node convert.mjs                              (uses ./_Paligo In → ./_Astro Out)
//   node convert.mjs <paligoExportDir> <astroOut> (explicit paths)
// or env: PALIGO_EXPORT_DIR=… ASTRO_PROJECT_DIR=… node convert.mjs
//
// The input folder may contain the export files directly (resource-<id>.xml +
// assets/) OR the whole exported sub-folder dropped in unchanged — both work.
// The output folder is scaffolded as a fresh Astro Starlight project if empty.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.join(HERE, 'template');
const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));

const IN_DIR = path.resolve(args[0] || process.env.PALIGO_EXPORT_DIR || path.join(HERE, '_Paligo In'));
const OUT = path.resolve(args[1] || process.env.ASTRO_PROJECT_DIR || path.join(HERE, '_Astro Out'));

// Find the resource XML (Paligo names it resource-<id>.xml) directly in `dir`.
function findResourceXml(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
  const files = fs.readdirSync(dir);
  const preferred = files.find((f) => /^resource-\d+\.xml$/i.test(f));
  if (preferred) return path.join(dir, preferred);
  const anyXml = files.find((f) => f.toLowerCase().endsWith('.xml'));
  return anyXml ? path.join(dir, anyXml) : null;
}
// …or one level down, if the whole export sub-folder was dropped in.
function locateExport(inDir) {
  let xml = findResourceXml(inDir);
  if (xml) return xml;
  if (!fs.existsSync(inDir)) return null;
  for (const entry of fs.readdirSync(inDir)) {
    const sub = path.join(inDir, entry);
    if (fs.statSync(sub).isDirectory()) {
      xml = findResourceXml(sub);
      if (xml) return xml;
    }
  }
  return null;
}

const XML_PATH = locateExport(IN_DIR);
if (!XML_PATH) {
  console.error(`✗ No Paligo export found in: ${IN_DIR}`);
  console.error('  Drop the unzipped Paligo DocBook export there (a resource-<id>.xml plus an assets/ folder) and re-run.');
  process.exit(1);
}
const SRC_DIR = path.dirname(XML_PATH);           // export root (where assets/ lives)
const ASSETS_DIR = path.join(SRC_DIR, 'assets');
const DOCS_DIR = path.join(OUT, 'src/content/docs');
const ASSETS_OUT = path.join(OUT, 'src/assets');
const CONFIG_PATH = path.join(OUT, 'astro.config.mjs');

// ─────────────────────────────────────────────────────────────────────────────
// Scaffold the output Astro project if it doesn't exist yet
// ─────────────────────────────────────────────────────────────────────────────
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}
let scaffolded = false;
if (!fs.existsSync(CONFIG_PATH)) {
  if (!fs.existsSync(path.join(TEMPLATE_DIR, 'astro.config.mjs'))) {
    console.error(`✗ Project template missing at ${TEMPLATE_DIR}`);
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });
  copyDir(TEMPLATE_DIR, OUT);
  scaffolded = true;
}

console.log(`Paligo export : ${SRC_DIR}`);
console.log(`Source XML    : ${path.basename(XML_PATH)}`);
console.log(`Astro project : ${OUT}${scaffolded ? ' (scaffolded fresh)' : ''}\n`);

// This script is destructive-by-design and fully idempotent: every run wipes the
// generated content (src/content/docs) and images (src/assets) and rewrites the
// sidebar + title from scratch, so re-running can never duplicate or append.

// ─────────────────────────────────────────────────────────────────────────────
// Load XML
// ─────────────────────────────────────────────────────────────────────────────
const xml = fs.readFileSync(XML_PATH, 'utf8');
const $ = cheerio.load(xml, { xmlMode: true, decodeEntities: true });

// ─────────────────────────────────────────────────────────────────────────────
// Resource indexing
// ─────────────────────────────────────────────────────────────────────────────
const textNodeMap = new Map();     // text resource id -> e:content node
const componentByUuid = new Map(); // content uuid -> docbook root element (section/article)
const idToUuid = new Map();        // resource id -> uuid
const uuidToId = new Map();        // uuid -> resource id
const imageByUuid = new Map();     // image uuid -> { filename, src }
const varById = new Map();         // var id -> text value

function elemChildren(node) {
  return (node.children || []).filter((c) => c.type === 'tag');
}
function firstChildNamed(node, name) {
  return (node.children || []).find((c) => c.type === 'tag' && c.name === name);
}

// Walk the whole tree collecting e:resource elements
function collect(node, name, acc) {
  if (!node) return acc;
  if (node.type === 'tag' && node.name === name) acc.push(node);
  for (const c of node.children || []) collect(c, name, acc);
  return acc;
}

const rootNode = $.root()[0];
const resources = collect(rootNode, 'e:resource', []);

for (const res of resources) {
  const a = res.attribs || {};
  const id = a.id;
  const uuid = a.uuid;
  const type = a.type;
  if (id && uuid) { idToUuid.set(id, uuid); uuidToId.set(uuid, id); }

  // pick english e:content (or first)
  const contents = (res.children || []).filter((c) => c.type === 'tag' && c.name === 'e:content');
  const content = contents.find((c) => (c.attribs || {}).lang === 'en') || contents[0];

  if (type === 'text') {
    if (id && content) textNodeMap.set(id, content);
  } else if (type === 'component') {
    if (content) {
      const docRoot = elemChildren(content)[0];
      if (docRoot && uuid) componentByUuid.set(uuid, docRoot);
    }
  } else if (type === 'image') {
    if (uuid) imageByUuid.set(uuid, { filename: a.filename || path.basename(a.src || ''), src: a.src || '' });
  } else if (type === 'varset' && content) {
    const varsetEl = elemChildren(content)[0];
    if (varsetEl) {
      for (const v of elemChildren(varsetEl)) {
        if (v.name === 'var' && v.attribs && v.attribs.id) {
          varById.set(v.attribs.id, textContent(v).trim());
        }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Variable resolution (rebrand → Zephyr Essential)
// ─────────────────────────────────────────────────────────────────────────────
// Variables 34 and 35 are the product-name variables used throughout this
// publication. Per the migration decision we resolve the product name to its
// rebranded value.
const PRODUCT_VARS = new Set(['34', '35']);
function resolveVariable(id) {
  if (PRODUCT_VARS.has(id)) return 'Zephyr Essential';
  return varById.get(id) || '';
}

// Rebrand hardcoded strings in body text.
function rebrand(s) {
  return s
    .replace(/Zephyr Squad Server\/Data Center/g, 'Zephyr Essential DC')
    .replace(/Zephyr Squad Server/g, 'Zephyr Essential DC')
    .replace(/Zephyr Squad Data Center/g, 'Zephyr Essential DC')
    .replace(/Zephyr Squad/g, 'Zephyr Essential');
}

// ─────────────────────────────────────────────────────────────────────────────
// Slug helpers
// ─────────────────────────────────────────────────────────────────────────────
function normalizeSlugSegment(seg) {
  return seg
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ─────────────────────────────────────────────────────────────────────────────
// Build publication page tree from <e:structure>
// ─────────────────────────────────────────────────────────────────────────────
const structureEl = collect(rootNode, 'e:structure', [])[0];
const publicationEl = firstChildNamed(structureEl, 'e:publication');
const SITE_TITLE = rebrand(((publicationEl && publicationEl.attribs && publicationEl.attribs.title) || 'Documentation').trim());

const usedSlugs = new Set();
function uniqueSlug(slug) {
  let s = slug;
  let n = 2;
  while (usedSlugs.has(s)) { s = `${slug}-${n++}`; }
  usedSlugs.add(s);
  return s;
}

const pages = [];               // flat list { title, uuid, slug, children:[] }
const slugByResourceId = new Map();
const slugByUuid = new Map();

function buildTree(compEl, parentParts) {
  const a = compEl.attribs || {};
  const title = a.title || 'Untitled';
  const origin = a.origin;           // uuid of the content component
  let seg = normalizeSlugSegment(title);
  if (!seg) seg = 'page';
  const parts = [...parentParts, seg];
  const slug = uniqueSlug(parts.join('/'));

  const rid = origin ? uuidToId.get(origin) : null;
  const page = { title, uuid: origin, slug, resourceId: rid || null, children: [] };
  pages.push(page);
  if (origin) slugByUuid.set(origin, slug);
  if (rid) slugByResourceId.set(rid, slug);

  for (const child of elemChildren(compEl)) {
    if (child.name === 'e:component') {
      page.children.push(buildTree(child, parts));
    }
  }
  return page;
}

const rootPages = [];
for (const child of elemChildren(publicationEl)) {
  if (child.name === 'e:component') rootPages.push(buildTree(child, []));
}

// ─────────────────────────────────────────────────────────────────────────────
// Serialization helpers
// ─────────────────────────────────────────────────────────────────────────────
const missingImages = new Set();
// Image usage: asset filename -> Set of page slugs that reference it.
// Layout: single-use images live under src/assets/<page-slug>/ (mirroring the
// docs tree); images shared by >1 page live in src/assets/_shared/.
const imageUsage = new Map();
let sharedImages = new Set(); // populated after a discovery pass
function recordImage(pageSlug, filename) {
  if (!pageSlug || !filename) return;
  if (!imageUsage.has(filename)) imageUsage.set(filename, new Set());
  imageUsage.get(filename).add(pageSlug);
}
function assetDirFor(pageSlug, filename) {
  return sharedImages.has(filename) ? '_shared' : pageSlug;
}
// Relative path from a page's .mdx (src/content/docs/<slug>.mdx) to its asset.
function assetRelPath(pageSlug, filename) {
  const mdxDir = 'src/content/docs/' + (pageSlug.includes('/') ? pageSlug.slice(0, pageSlug.lastIndexOf('/')) : '');
  const assetFile = 'src/assets/' + assetDirFor(pageSlug, filename) + '/' + filename;
  let rel = path.posix.relative(mdxDir, assetFile);
  if (!rel.startsWith('.')) rel = './' + rel;
  return /[()\s]/.test(rel) ? `<${rel}>` : rel;
}

function textContent(node) {
  if (node.type === 'text') return node.data || '';
  if (node.type === 'tag') return (node.children || []).map(textContent).join('');
  return '';
}

// children to render: resolve xinfo:text reference if present
function childrenFor(node) {
  const a = node.attribs || {};
  if (a['xinfo:text'] && textNodeMap.has(a['xinfo:text'])) {
    return textNodeMap.get(a['xinfo:text']).children || [];
  }
  return node.children || [];
}

function escapeText(s) {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/</g, '&lt;')
    .replace(/{/g, '&#123;')
    .replace(/}/g, '&#125;');
}

function collapseWs(s) {
  return s.replace(/\s+/g, ' ');
}

// ── Inline rendering ─────────────────────────────────────────────────────────
function renderInline(nodes, ctx) {
  let out = '';
  for (const n of nodes) out += renderInlineNode(n, ctx);
  return out;
}

function wrap(marker, inner) {
  const m = inner.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const lead = m ? m[1] : '';
  const core = m ? m[2] : inner;
  const trail = m ? m[3] : '';
  if (!core) return inner;
  return `${lead}${marker}${core}${marker}${trail}`;
}

function renderInlineNode(node, ctx) {
  if (node.type === 'text') {
    return escapeText(rebrand(node.data || ''));
  }
  if (node.type === 'cdata') {
    return escapeText(textContent(node));
  }
  if (node.type !== 'tag') return '';
  const a = node.attribs || {};
  const name = node.name;
  const kids = () => childrenFor(node);

  switch (name) {
    case 'emphasis': {
      const inner = renderInline(kids(), ctx);
      const role = a.role || '';
      if (role === 'bold' || role === 'strong') return wrap('**', inner);
      if (role === 'underline') return inner;
      return wrap('*', inner);
    }
    case 'code':
    case 'literal':
    case 'command':
    case 'filename':
    case 'computeroutput':
    case 'varname':
    case 'option':
    case 'parameter':
    case 'systemitem':
    case 'classname':
    case 'function': {
      const t = rebrand(textContent(node)).replace(/`/g, '');
      return t ? '`' + collapseWs(t) + '`' : '';
    }
    case 'guilabel':
    case 'guibutton':
    case 'guimenu':
    case 'guisubmenu':
    case 'guiicon':
    case 'uicontrol': {
      const inner = renderInline(kids(), ctx).trim();
      return inner ? wrap('**', inner) : '';
    }
    case 'menuchoice': {
      const labels = elemChildren(node)
        .map((c) => renderInline(childrenFor(c), ctx).trim())
        .filter(Boolean);
      return labels.length ? wrap('**', labels.join(' > ')) : '';
    }
    case 'keycap':
    case 'keycombo':
    case 'shortcut': {
      const t = textContent(node).trim();
      return t ? '`' + collapseWs(t) + '`' : '';
    }
    case 'phrase': {
      if (a['xinfo:variable']) return resolveVariable(a['xinfo:variable']);
      return renderInline(kids(), ctx);
    }
    case 'link':
      return renderLink(node, ctx);
    case 'inlinemediaobject': {
      // Inline icon: wrap in `.not-content` so Starlight's content styles don't
      // force the image onto its own line (keeps it inline with the text).
      const md = renderInlineImage(node, ctx);
      return md ? `<span class="not-content">${md}</span>` : '';
    }
    case 'mediaobject':
      // A block image encountered in inline context (e.g. a screenshot wrapped
      // in <para><link><mediaobject>…). Emit it as a normal image.
      return renderInlineImage(node, ctx);
    case 'imageobject':
    case 'imagedata':
      return renderInlineImage(node, ctx);
    case 'superscript':
      return '<sup>' + renderInline(kids(), ctx) + '</sup>';
    case 'subscript':
      return '<sub>' + renderInline(kids(), ctx) + '</sub>';
    case 'citetitle':
      return wrap('*', renderInline(kids(), ctx));
    case 'br':
      return '<br />';
    default:
      // Unknown inline element: unwrap
      return renderInline(kids(), ctx);
  }
}

function renderLink(node, ctx) {
  const a = node.attribs || {};
  let text = renderInline(childrenFor(node), ctx).trim();
  const href = a['xlink:href'] || '';
  const linkend = a.linkend;

  if (href.startsWith('urn:resource:')) {
    // urn:resource:component:1234 or urn:resource:fork:1234 (optionally #anchor)
    const hashIdx = href.indexOf('#');
    const base = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
    const anchor = hashIdx >= 0 ? href.slice(hashIdx + 1) : '';
    const m = base.match(/(\d+)\s*$/);
    const rid = m ? m[1] : null;
    let slug = rid ? slugByResourceId.get(rid) : null;
    if (!slug && rid) {
      const uuid = idToUuid.get(rid);
      if (uuid) slug = slugByUuid.get(uuid);
    }
    if (slug) {
      const url = '/' + slug + '/' + (anchor ? '#' + anchor : '');
      if (!text) text = 'link';
      return `[${text}](${url})`;
    }
    return text || '';
  }
  if (/^https?:\/\//.test(href) || href.startsWith('mailto:')) {
    if (!text) text = href;
    return `[${text}](${href})`;
  }
  if (href.startsWith('#')) {
    if (!text) text = 'link';
    return `[${text}](${href})`;
  }
  if (linkend) {
    // Links to the published-site index (a Paligo artifact) have no target here.
    if (/filepaligo|outputwebsite/i.test(linkend)) return text || '';
    if (!text) text = 'link';
    return `[${text}](#${linkend})`;
  }
  return text || '';
}

function imageAlt(mediaNode, filename) {
  // try <alt> or <textobject><phrase>
  const altEl = collect(mediaNode, 'alt', [])[0];
  if (altEl) {
    const t = textContent(altEl).trim();
    if (t) return t;
  }
  const base = filename ? path.basename(filename, path.extname(filename)) : 'image';
  return base.replace(/[_-]+/g, ' ').trim();
}

function resolveImage(dataNode, ctx) {
  const a = dataNode.attribs || {};
  const ref = a.fileref || '';
  const slug = ctx && ctx.pageSlug;
  // Skip Paligo UI chrome (go.gif arrows, note collapse toggles, etc.) — these
  // are decorative widgets from the published HTML theme, not real content.
  if (/^images\/commonImages\//.test(a.remap || '')) return null;
  if (/^https?:\/\//.test(ref)) return { src: ref, filename: null, external: true };
  const img = imageByUuid.get(ref);
  if (img && img.filename) {
    recordImage(slug, img.filename);
    return { src: assetRelPath(slug, img.filename), filename: img.filename };
  }
  // maybe ref is already a filename
  if (ref) {
    const fn = path.basename(ref);
    missingImages.add(ref);
    recordImage(slug, fn);
    return { src: assetRelPath(slug, fn), filename: fn };
  }
  return null;
}

function renderInlineImage(node, ctx) {
  const dataNode = collect(node, 'imagedata', [])[0];
  if (!dataNode) return '';
  const img = resolveImage(dataNode, ctx);
  if (!img) return '';
  const alt = imageAlt(node, img.filename);
  return `![${alt.replace(/]/g, '')}](${img.src})`;
}

// ── Block rendering ──────────────────────────────────────────────────────────
function renderBlocks(nodes, ctx) {
  const out = [];
  for (const n of nodes) {
    if (n.type !== 'tag') continue;
    const md = renderBlock(n, ctx);
    if (md && md.trim()) out.push(md.trim());
  }
  return out.join('\n\n');
}

function heading(level, text) {
  const l = Math.min(Math.max(level, 1), 6);
  return '#'.repeat(l) + ' ' + text;
}

function renderBlock(node, ctx) {
  const name = node.name;
  switch (name) {
    case 'section':
    case 'simplesect':
      return renderNestedSection(node, ctx);
    case 'title':
      return heading(ctx.level, renderInline(childrenFor(node), ctx).trim());
    case 'subtitle':
    case 'bridgehead': {
      const t = renderInline(childrenFor(node), ctx).trim();
      return t ? wrap('**', t) : '';
    }
    case 'para':
    case 'simpara':
    case 'formalpara': {
      const inner = renderInline(childrenFor(node), ctx).trim();
      return inner;
    }
    case 'itemizedlist':
      return renderList(node, ctx, false);
    case 'orderedlist':
      return renderList(node, ctx, true);
    case 'procedure':
      return renderSteps(node, ctx);
    case 'substeps':
      return renderSteps(node, ctx);
    case 'variablelist':
      return renderVariableList(node, ctx);
    case 'note':
    case 'tip':
    case 'important':
    case 'warning':
    case 'caution':
      return renderAside(node, ctx);
    case 'sidebar':
      return renderSidebar(node, ctx);
    case 'informaltable':
    case 'table':
      return renderTable(node, ctx);
    case 'mediaobject':
    case 'figure':
    case 'informalfigure':
      return renderMedia(node, ctx);
    case 'programlisting':
    case 'screen':
    case 'literallayout':
      return renderCode(node);
    case 'blockquote':
      return renderBlockquote(node, ctx);
    case 'example':
    case 'informalexample':
      return renderBlocks(elemChildren(node), ctx);
    case 'xi:include':
      return renderInclude(node, ctx);
    case 'info':
    case 'indexterm':
    case 'titleabbrev':
      return '';
    default:
      // Unknown block: render children as blocks
      return renderBlocks(elemChildren(node), ctx);
  }
}

function renderNestedSection(node, ctx) {
  const titleEl = firstChildNamed(node, 'title');
  const parts = [];
  if (titleEl) {
    const t = renderInline(childrenFor(titleEl), ctx).trim();
    if (t) parts.push(heading(ctx.level, t));
  }
  const rest = elemChildren(node).filter((c) => c !== titleEl && c.name !== 'info' && c.name !== 'titleabbrev');
  const body = renderBlocks(rest, { ...ctx, level: ctx.level + 1 });
  if (body) parts.push(body);
  return parts.join('\n\n');
}

function indentItem(md, firstPrefix, contPrefix) {
  const lines = md.split('\n');
  return lines
    .map((line, i) => {
      if (i === 0) return firstPrefix + line;
      if (line.trim() === '') return '';
      return contPrefix + line;
    })
    .join('\n');
}

function renderList(node, ctx, ordered) {
  const items = elemChildren(node).filter((c) => c.name === 'listitem');
  const lines = [];
  let i = 1;
  for (const li of items) {
    const marker = ordered ? `${i}. ` : '- ';
    const cont = ' '.repeat(marker.length);
    const blocks = elemChildren(li).filter((c) => c.name !== 'info');
    const md = renderBlocks(blocks, { ...ctx, level: ctx.level });
    lines.push(indentItem(md || '', marker, cont));
    i++;
  }
  return lines.join('\n');
}

function renderSteps(node, ctx) {
  const items = elemChildren(node).filter((c) => c.name === 'step');
  if (!items.length) return renderList(node, ctx, true);
  const lines = [];
  let i = 1;
  for (const step of items) {
    const marker = `${i}. `;
    const cont = ' '.repeat(marker.length);
    const blocks = elemChildren(step).filter((c) => c.name !== 'info');
    const md = renderBlocks(blocks, { ...ctx, level: ctx.level });
    lines.push(indentItem(md || '', marker, cont));
    i++;
  }
  return lines.join('\n');
}

function renderVariableList(node, ctx) {
  const entries = elemChildren(node).filter((c) => c.name === 'varlistentry');
  const out = [];
  for (const e of entries) {
    const terms = elemChildren(e).filter((c) => c.name === 'term');
    const listitem = firstChildNamed(e, 'listitem');
    const term = terms.map((t) => renderInline(childrenFor(t), ctx).trim()).join(', ');
    const body = listitem ? renderBlocks(elemChildren(listitem), ctx) : '';
    out.push(`- ${wrap('**', term)}: ${body.replace(/\n+/g, ' ').trim()}`);
  }
  return out.join('\n');
}

const ASIDE_MAP = {
  note: { type: 'note', title: '' },
  tip: { type: 'tip', title: '' },
  important: { type: 'note', title: 'Important' },
  warning: { type: 'caution', title: '' },
  caution: { type: 'caution', title: '' },
};

function renderAside(node, ctx) {
  const conf = ASIDE_MAP[node.name] || { type: 'note', title: '' };
  const titleEl = firstChildNamed(node, 'title');
  let title = conf.title;
  let rest = elemChildren(node);
  if (titleEl) {
    title = renderInline(childrenFor(titleEl), ctx).trim();
    rest = rest.filter((c) => c !== titleEl);
  }
  const body = renderBlocks(rest, ctx);
  const head = title ? `:::${conf.type}[${title}]` : `:::${conf.type}`;
  return `${head}\n${body}\n:::`;
}

function renderSidebar(node, ctx) {
  const titleEl = firstChildNamed(node, 'title');
  let title = 'Note';
  let rest = elemChildren(node);
  if (titleEl) {
    title = renderInline(childrenFor(titleEl), ctx).trim() || 'Note';
    rest = rest.filter((c) => c !== titleEl);
  }
  const body = renderBlocks(rest, ctx);
  return `:::note[${title}]\n${body}\n:::`;
}

function renderBlockquote(node, ctx) {
  const body = renderBlocks(elemChildren(node).filter((c) => c.name !== 'attribution'), ctx);
  return body.split('\n').map((l) => (l.trim() ? '> ' + l : '>')).join('\n');
}

function renderCode(node) {
  const a = node.attribs || {};
  const lang = a.language || '';
  const code = textContent(node).replace(/\n+$/, '');
  return '```' + lang + '\n' + code + '\n```';
}

// ── Tables ───────────────────────────────────────────────────────────────────
function cellInline(cell, ctx) {
  const blocks = elemChildren(cell);
  const parts = [];
  for (const b of blocks) {
    if (b.name === 'para' || b.name === 'simpara') {
      const t = renderInline(childrenFor(b), ctx).trim();
      if (t) parts.push(t);
    } else if (b.name === 'itemizedlist' || b.name === 'orderedlist') {
      const items = elemChildren(b).filter((c) => c.name === 'listitem');
      for (const li of items) {
        const t = renderInline(childrenFor(firstChildNamed(li, 'para') || li), ctx).trim();
        if (t) parts.push('• ' + t);
      }
    } else if (b.name === 'mediaobject' || b.name === 'inlinemediaobject') {
      const dataNode = collect(b, 'imagedata', [])[0];
      if (dataNode) {
        const img = resolveImage(dataNode, ctx);
        if (img) parts.push(`![${imageAlt(b, img.filename).replace(/]/g, '')}](${img.src})`);
      }
    } else {
      const t = renderInline(childrenFor(b), ctx).trim();
      if (t) parts.push(t);
    }
  }
  if (!parts.length) {
    const t = renderInline(cell.children || [], ctx).trim();
    if (t) parts.push(t);
  }
  return parts.join('<br />').replace(/\|/g, '\\|').replace(/\n+/g, ' ');
}

function rowCells(tr) {
  return elemChildren(tr).filter((c) => c.name === 'td' || c.name === 'th');
}

// Paligo represents admonitions (Note/Tip/Warning…) as a 2-column, single-row
// table: a label/icon cell + a content cell. Detect that shape and render a real
// Starlight aside instead of a broken table.
const NOTE_LABELS = {
  note: 'note', tip: 'tip', important: 'note', warning: 'caution',
  caution: 'caution', information: 'note', info: 'note',
};
function noteAsideFromTable(node, ctx) {
  if (collect(node, 'thead', [])[0]) return null;
  const trs = collect(node, 'tr', []);
  if (trs.length !== 1) return null;
  const cells = rowCells(trs[0]);
  if (cells.length !== 2) return null;

  const c0text = plainResolved(cells[0]).trim().replace(/:$/, '');
  let type = NOTE_LABELS[c0text.toLowerCase()];
  let bodyCell = cells[1];
  if (!type) {
    // icon-only label cell (e.g. a "pay-attention" gif) with no text
    const c0img = collect(cells[0], 'imagedata', []).length > 0;
    if (!c0text && c0img) type = 'note';
    else return null;
  }
  const body = renderBlocks(elemChildren(bodyCell), ctx);
  if (!body.trim()) return null;
  const label = type === 'note' && /^important$/i.test(c0text) ? '[Important]' : '';
  return `:::${type}${label}\n${body}\n:::`;
}

function renderTable(node, ctx) {
  const aside = noteAsideFromTable(node, ctx);
  if (aside) return aside;

  const thead = collect(node, 'thead', [])[0];
  const tbody = collect(node, 'tbody', [])[0];
  let headerRow = null;
  let bodyRows = [];

  const allTrs = collect(node, 'tr', []);
  if (thead) {
    const htrs = elemChildren(thead).filter((c) => c.name === 'tr');
    headerRow = htrs[0] || null;
  }
  if (tbody) {
    bodyRows = elemChildren(tbody).filter((c) => c.name === 'tr');
  } else {
    bodyRows = allTrs.filter((t) => t !== headerRow);
  }
  if (!headerRow && bodyRows.length) {
    headerRow = bodyRows.shift();
  }
  if (!headerRow) return '';

  // determine column count
  let colCount = 0;
  for (const c of rowCells(headerRow)) colCount += parseInt(c.attribs?.colspan || '1', 10);
  for (const tr of bodyRows) {
    let n = 0;
    for (const c of rowCells(tr)) n += parseInt(c.attribs?.colspan || '1', 10);
    if (n > colCount) colCount = n;
  }
  if (colCount === 0) return '';

  function expandRow(tr) {
    const cells = [];
    for (const c of rowCells(tr)) {
      const span = parseInt(c.attribs?.colspan || '1', 10);
      cells.push(cellInline(c, ctx));
      for (let k = 1; k < span; k++) cells.push('');
    }
    while (cells.length < colCount) cells.push('');
    return cells.slice(0, colCount);
  }

  const lines = [];
  lines.push('| ' + expandRow(headerRow).join(' | ') + ' |');
  lines.push('| ' + Array(colCount).fill('---').join(' | ') + ' |');
  for (const tr of bodyRows) {
    lines.push('| ' + expandRow(tr).join(' | ') + ' |');
  }
  return lines.join('\n');
}

// ── Media ──────────────────────────────────────────────────────────────────
function renderMedia(node, ctx) {
  // figure may wrap a mediaobject + title
  const titleEl = firstChildNamed(node, 'title');
  let caption = titleEl ? renderInline(childrenFor(titleEl), ctx).trim() : '';

  const videoData = collect(node, 'videodata', [])[0];
  if (videoData) {
    const src = (videoData.attribs || {}).fileref || '';
    if (src) {
      return `<iframe src="${src}" title="Video" style={{border: 0, width: '100%', aspectRatio: '16/9'}} allow="fullscreen" allowfullscreen></iframe>`;
    }
    return '';
  }

  const imgData = collect(node, 'imagedata', [])[0];
  if (imgData) {
    const img = resolveImage(imgData, ctx);
    if (!img) return '';
    const alt = caption || imageAlt(node, img.filename);
    return `![${alt.replace(/]/g, '')}](${img.src})`;
  }
  return '';
}

// ── XInclude (content reuse) ──────────────────────────────────────────────────
function renderInclude(node, ctx) {
  const href = (node.attribs || {}).href || '';
  const uuid = href;
  if (ctx.includeStack && ctx.includeStack.has(uuid)) return '';
  const comp = componentByUuid.get(uuid);
  if (!comp) {
    return ''; // fallback content omitted
  }
  const nextStack = new Set(ctx.includeStack || []);
  nextStack.add(uuid);
  return renderNestedSection(comp, { ...ctx, includeStack: nextStack });
}

// ─────────────────────────────────────────────────────────────────────────────
// Topic rendering → MDX
// ─────────────────────────────────────────────────────────────────────────────
function escapeYaml(str) {
  const s = (str || '').replace(/\s+/g, ' ').trim();
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function firstParaText(sectionNode) {
  const paras = collect(sectionNode, 'para', []);
  for (const p of paras) {
    const t = collapseWs(textContent({ type: 'tag', children: childrenFor(p) })).trim();
    // resolve simple text incl variables
    const resolved = rebrand(plainResolved(p));
    if (/^Reusing topic #/.test(resolved)) continue; // xi:fallback placeholder
    if (resolved && resolved.length > 20) {
      return resolved.length > 160 ? resolved.slice(0, 157) + '...' : resolved;
    }
  }
  return '';
}

function plainResolved(node) {
  // plain text with variables resolved, no markdown
  let out = '';
  for (const c of childrenFor(node)) {
    if (c.type === 'text') out += c.data || '';
    else if (c.type === 'tag') {
      if (c.name === 'phrase' && c.attribs && c.attribs['xinfo:variable']) out += resolveVariable(c.attribs['xinfo:variable']);
      else out += plainResolved(c);
    }
  }
  return collapseWs(out).trim();
}

function renderTopic(page) {
  const section = componentByUuid.get(page.uuid);
  if (!section) return null;

  // title: prefer structure title (already rebranded by var? structure titles are static) → rebrand
  const titleEl = firstChildNamed(section, 'title');
  let title = page.title;
  if (titleEl) {
    const t = renderInline(childrenFor(titleEl), { level: 2 }).trim();
    if (t) title = t;
  }
  title = rebrand(title).replace(/[*`]/g, '');

  const bodyNodes = elemChildren(section).filter(
    (c) => c !== titleEl && c.name !== 'info' && c.name !== 'titleabbrev' && c.name !== 'subtitle'
  );
  const body = renderBlocks(bodyNodes, { level: 2, includeStack: new Set([page.uuid]), pageSlug: page.slug });

  const desc = firstParaText(section);
  let fm = `---\ntitle: ${escapeYaml(title)}\n`;
  if (desc) fm += `description: ${escapeYaml(desc)}\n`;
  if (page.resourceId) fm += `paligoId: "${page.resourceId}"\n`;
  fm += '---\n\n';

  let md = body.replace(/\n{3,}/g, '\n\n').trim();
  return fm + md + '\n';
}

// ─────────────────────────────────────────────────────────────────────────────
// Write pages
// ─────────────────────────────────────────────────────────────────────────────
// Pass 1 (discovery): render every topic to learn which images are shared across
// pages. Output is discarded; only image-usage side effects are kept.
for (const page of pages) renderTopic(page);
sharedImages = new Set([...imageUsage].filter(([, slugs]) => slugs.size > 1).map(([f]) => f));
imageUsage.clear(); // repopulated with correct data during pass 2

// Pass 2 (emit): render for real, now that asset paths know what is shared.
fs.rmSync(DOCS_DIR, { recursive: true, force: true });
fs.mkdirSync(DOCS_DIR, { recursive: true });

let written = 0, skipped = 0;
for (const page of pages) {
  const mdx = renderTopic(page);
  if (mdx === null) { console.warn('  ⚠ no content for:', page.slug, page.uuid); skipped++; continue; }
  const outPath = path.join(DOCS_DIR, page.slug + '.mdx');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, mdx, 'utf8');
  written++;
}
console.log(`Pages written: ${written}, skipped: ${skipped}`);

// ─────────────────────────────────────────────────────────────────────────────
// Splash landing page
// ─────────────────────────────────────────────────────────────────────────────
function findPageBySlug(slug) {
  return pages.find((p) => p.slug === slug);
}
const cardCandidates = [
  { slug: 'get-started', icon: 'rocket', desc: 'Install Zephyr Essential and learn the core concepts.' },
  { slug: 'writing-tests', icon: 'pencil', desc: 'Create, import, and organize your test cases.' },
  { slug: 'executing-tests', icon: 'approve-check', desc: 'Run tests ad-hoc or inside test cycles.' },
  { slug: 'tracking-test-progress', icon: 'bars', desc: 'Track progress with metrics, reports, and boards.' },
  { slug: 'administration', icon: 'setting', desc: 'Configure and customize Zephyr Essential.' },
  { slug: 'zephyr-squad-server-rest-api', icon: 'seti:json', desc: 'Automate Zephyr Essential with the REST API.' },
];
const cards = cardCandidates
  .map((c) => ({ ...c, page: findPageBySlug(c.slug) }))
  .filter((c) => c.page)
  .map((c) => `  <Card title="${rebrand(c.page.title).replace(/"/g, '')}" icon="${c.icon}">\n    ${c.desc} [Read more](/${c.slug}/)\n  </Card>`)
  .join('\n');

const getStarted = findPageBySlug('get-started');
const welcome = findPageBySlug('welcome');
const heroActions = [];
if (getStarted) heroActions.push(`    - text: Get Started\n      link: /${getStarted.slug}/\n      icon: right-arrow`);
if (welcome) heroActions.push(`    - text: What's New\n      link: /${welcome.slug}/\n      variant: minimal`);

const actionsBlock = heroActions.length
  ? `  actions:\n${heroActions.join('\n')}`
  : `  actions: []`;
const indexMdx = `---
title: Zephyr Essential DC Documentation
description: Plan, create, execute, and track your software testing directly inside Jira with Zephyr Essential.
template: splash
hero:
  tagline: Native test management for Jira — plan, execute, and track your testing in one place.
${actionsBlock}
---

import { Card, CardGrid } from '@astrojs/starlight/components';

<CardGrid>
${cards}
</CardGrid>
`;
fs.writeFileSync(path.join(DOCS_DIR, 'index.mdx'), indexMdx, 'utf8');
console.log('Landing page index.mdx written');

// ─────────────────────────────────────────────────────────────────────────────
// Copy images into src/assets/<page-slug>/, mirroring the docs structure.
// Shared images are duplicated into each referencing page's folder so every
// folder is self-contained. Any source asset never referenced is preserved
// under src/assets/_unused/.
// ─────────────────────────────────────────────────────────────────────────────
fs.rmSync(ASSETS_OUT, { recursive: true, force: true });
fs.mkdirSync(ASSETS_OUT, { recursive: true });

let imgCopied = 0, imgMissing = 0;
const referencedFiles = new Set();
function copyAsset(filename, destDir) {
  referencedFiles.add(filename);
  const src = path.join(ASSETS_DIR, filename);
  const dest = path.join(destDir, filename);
  if (fs.existsSync(src)) {
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(src, dest);
    imgCopied++;
  } else {
    console.warn('  ⚠ image file not found in assets:', filename);
    imgMissing++;
  }
}
for (const [filename, slugs] of imageUsage) {
  if (sharedImages.has(filename)) {
    copyAsset(filename, path.join(ASSETS_OUT, '_shared')); // once, for all referencing pages
  } else {
    copyAsset(filename, path.join(ASSETS_OUT, [...slugs][0]));
  }
}

// Preserve orphaned source assets (not referenced by any page).
const allAssets = fs.readdirSync(ASSETS_DIR).filter((f) => fs.statSync(path.join(ASSETS_DIR, f)).isFile());
const orphans = allAssets.filter((f) => !referencedFiles.has(f));
if (orphans.length) {
  const unusedDir = path.join(ASSETS_OUT, '_unused');
  fs.mkdirSync(unusedDir, { recursive: true });
  for (const f of orphans) fs.copyFileSync(path.join(ASSETS_DIR, f), path.join(unusedDir, f));
}
console.log(`Image files written: ${imgCopied}, missing: ${imgMissing}`);
console.log(`Distinct referenced: ${referencedFiles.size} (shared → _shared: ${sharedImages.size}), orphaned → _unused: ${orphans.length}`);
if (missingImages.size) console.log(`  Unresolved image refs: ${missingImages.size}`);

// ─────────────────────────────────────────────────────────────────────────────
// Build sidebar + landing page
// ─────────────────────────────────────────────────────────────────────────────
function sidebarEntry(page) {
  if (page.children && page.children.length) {
    const items = [{ label: 'Overview', slug: page.slug }, ...page.children.map(sidebarEntry)];
    return { label: page.title, items };
  }
  return { label: page.title, slug: page.slug };
}
const sidebar = rootPages.map(sidebarEntry);

function sidebarToJs(entries, depth) {
  const pad = '\t'.repeat(depth + 4);
  return entries
    .map((e) => {
      const label = rebrand(e.label).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      if (e.items) {
        const inner = sidebarToJs(e.items, depth + 1);
        return `${pad}{\n${pad}\tlabel: '${label}',\n${pad}\titems: [\n${inner}\n${pad}\t],\n${pad}}`;
      }
      return `${pad}{ label: '${label}', slug: '${e.slug}' }`;
    })
    .join(',\n');
}

let config = fs.readFileSync(CONFIG_PATH, 'utf8');
const startMarker = 'sidebar: [';
const markerIdx = config.indexOf(startMarker);
let i = markerIdx + 'sidebar: '.length;
let depth = 0;
while (i < config.length) {
  const ch = config[i];
  if (ch === '[' || ch === '{') depth++;
  else if (ch === ']' || ch === '}') { depth--; if (depth === 0) { i++; break; } }
  i++;
}
const newSidebar = `sidebar: [\n${sidebarToJs(sidebar, 0)}\n\t\t\t]`;
config = config.slice(0, markerIdx) + newSidebar + config.slice(i);
// Set the Starlight site title from the publication title (only touches the
// scaffold placeholder, so an existing project's custom title is left alone).
config = config.replace('__SITE_TITLE__', SITE_TITLE.replace(/'/g, "\\'"));
fs.writeFileSync(CONFIG_PATH, config, 'utf8');
console.log(`Sidebar + title ("${SITE_TITLE}") written to astro.config.mjs`);

console.log('\nDone.');
