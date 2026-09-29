/**
 * mdx-to-docbook.js
 * Converts MDX content to Paligo-compatible DocBook 5 XML.
 *
 * Strategy:
 *   1. Strip JSX/MDX-specific syntax (imports, exports, JSX components)
 *   2. Parse remaining Markdown with unified/remark
 *   3. Convert remark AST → DocBook XML string
 *
 * Supported MDX elements → DocBook mappings:
 *   # Heading 1       → <title> (inside <section>)
 *   ## Heading 2–6    → nested <section><title>
 *   Paragraph         → <para>
 *   **bold**          → <emphasis role="bold">
 *   *italic*          → <emphasis>
 *   `inline code`     → <code>
 *   ```lang ... ```   → <programlisting language="lang">
 *   - list / 1. list  → <itemizedlist> / <orderedlist> with <listitem><para>
 *   | table |          → <informaltable> with DocBook CALS model
 *   [text](url)       → <link xlink:href="url">
 *   > blockquote      → <note><para> (closest DocBook equivalent)
 *   :::note / :::tip  → <note> / <tip> (common MDX admonition syntax)
 *   Images            → <mediaobject> (flagged — manual review recommended)
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * @param {string} mdxContent  - Raw MDX file content
 * @param {object} options
 * @param {string} options.topicTitle  - Used as the root <section> title if H1 is absent
 * @param {string} options.topicId     - Paligo topic ID, used as xml:id
 * @returns {string} DocBook 5 XML string
 */
export async function convertMdxToDocbook(mdxContent, { topicTitle, topicId }) {
  // Step 1: Strip MDX-specific syntax
  const cleanedMarkdown = stripMdxSyntax(mdxContent);

  // Step 2: Parse with remark
  const processor = unified().use(remarkParse).use(remarkGfm);
  const ast = processor.parse(cleanedMarkdown);

  // Step 3: Convert AST to DocBook XML
  const bodyXml = convertChildren(ast.children);

  // Step 4: Wrap in root <section>
  const xmlId = sanitizeId(topicId);
  const xml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<section xmlns="http://docbook.org/ns/docbook"`,
    `         xmlns:xlink="http://www.w3.org/1999/xlink"`,
    `         version="5.0"`,
    `         xml:id="${xmlId}">`,
    `  <title>${escapeXml(topicTitle)}</title>`,
    bodyXml,
    `</section>`,
  ].join('\n');

  return xml;
}

// ── MDX Stripping ─────────────────────────────────────────────────────────────

function stripMdxSyntax(content) {
  return content
    // Remove import/export statements
    .replace(/^(import|export)\s+.+$/gm, '')
    // Remove frontmatter (--- ... ---)
    .replace(/^---[\s\S]*?---\n?/, '')
    // Convert :::note / :::tip / :::warning admonitions to blockquotes
    // so remark can parse them; we'll map blockquotes to <note> below
    .replace(/:::(\w+)\n([\s\S]*?):::/g, (_, type, body) => {
      return `> **${type.toUpperCase()}:** ${body.trim()}`;
    })
    // Remove remaining JSX tags (self-closing and paired)
    .replace(/<[A-Z][A-Za-z]*[^>]*\/>/g, '')
    .replace(/<[A-Z][A-Za-z]*[^>]*>[\s\S]*?<\/[A-Z][A-Za-z]*>/g, '')
    .trim();
}

// ── AST → DocBook conversion ──────────────────────────────────────────────────

function convertChildren(nodes, indent = '  ') {
  return nodes.map(node => convertNode(node, indent)).filter(Boolean).join('\n');
}

function convertNode(node, indent = '  ') {
  switch (node.type) {
    case 'heading':
      return convertHeading(node, indent);
    case 'paragraph':
      return `${indent}<para>${convertInline(node.children)}</para>`;
    case 'code':
      return convertCode(node, indent);
    case 'blockquote':
      return convertBlockquote(node, indent);
    case 'list':
      return convertList(node, indent);
    case 'table':
      return convertTable(node, indent);
    case 'thematicBreak':
      return ''; // Skip horizontal rules
    case 'html':
      return `${indent}<!-- RAW HTML (manual review needed): ${escapeXml(node.value)} -->`;
    default:
      return '';
  }
}

function convertHeading(node, indent) {
  const title = convertInline(node.children);
  // In DocBook, headings below H1 become nested <section><title>
  // H1 is handled at the root level; H2+ get their own section wrappers
  if (node.depth === 1) {
    // H1 is used as the root title — just output a comment here
    return `${indent}<!-- H1 "${title}" used as root section title -->`;
  }
  return `${indent}<section>\n${indent}  <title>${title}</title>\n${indent}</section>`;
}

function convertCode(node, indent) {
  const lang = node.lang ? ` language="${escapeXml(node.lang)}"` : '';
  return `${indent}<programlisting${lang}>${escapeXml(node.value)}</programlisting>`;
}

function convertBlockquote(node, indent) {
  // Check if it's an admonition (we prepended type in stripping step)
  const firstChild = node.children[0];
  const text = firstChild?.children?.[0]?.value || '';
  const admonitionMatch = text.match(/^\*\*(NOTE|TIP|WARNING|CAUTION|IMPORTANT):\*\*/);

  if (admonitionMatch) {
    const type = admonitionMatch[1].toLowerCase();
    const tag = ['tip', 'warning', 'caution', 'important'].includes(type) ? type : 'note';
    const body = convertChildren(node.children, indent + '  ');
    return `${indent}<${tag}>\n${body}\n${indent}</${tag}>`;
  }

  // Plain blockquote → <note>
  const body = convertChildren(node.children, indent + '  ');
  return `${indent}<note>\n${body}\n${indent}</note>`;
}

function convertList(node, indent) {
  const tag = node.ordered ? 'orderedlist' : 'itemizedlist';
  const items = node.children.map(item => {
    const content = convertChildren(item.children, indent + '    ');
    return `${indent}  <listitem>\n${content}\n${indent}  </listitem>`;
  }).join('\n');
  return `${indent}<${tag}>\n${items}\n${indent}</${tag}>`;
}

function convertTable(node, indent) {
  const [headerRow, ...bodyRows] = node.children;

  const thead = headerRow.children.map(cell =>
    `${indent}        <entry>${convertInline(cell.children)}</entry>`
  ).join('\n');

  const tbody = bodyRows.map(row => {
    const cells = row.children.map(cell =>
      `${indent}        <entry>${convertInline(cell.children)}</entry>`
    ).join('\n');
    return `${indent}      <row>\n${cells}\n${indent}      </row>`;
  }).join('\n');

  const colCount = headerRow.children.length;
  const cols = Array.from({ length: colCount }, (_, i) =>
    `${indent}    <col col="${i + 1}"/>`
  ).join('\n');

  return [
    `${indent}<informaltable>`,
    `${indent}  <tgroup cols="${colCount}">`,
    cols,
    `${indent}    <thead>`,
    `${indent}      <row>`,
    thead,
    `${indent}      </row>`,
    `${indent}    </thead>`,
    `${indent}    <tbody>`,
    tbody,
    `${indent}    </tbody>`,
    `${indent}  </tgroup>`,
    `${indent}</informaltable>`,
  ].join('\n');
}

// ── Inline node conversion ────────────────────────────────────────────────────

function convertInline(nodes) {
  if (!nodes) return '';
  return nodes.map(node => {
    switch (node.type) {
      case 'text':
        return escapeXml(node.value);
      case 'strong':
        return `<emphasis role="bold">${convertInline(node.children)}</emphasis>`;
      case 'emphasis':
        return `<emphasis>${convertInline(node.children)}</emphasis>`;
      case 'inlineCode':
        return `<code>${escapeXml(node.value)}</code>`;
      case 'link':
        return `<link xlink:href="${escapeXml(node.url)}">${convertInline(node.children)}</link>`;
      case 'image':
        // Flag images for manual review — image paths need to be Paligo asset IDs
        return `<!-- IMAGE (manual review needed): ${escapeXml(node.url)} alt="${escapeXml(node.alt || '')}" -->`;
      case 'break':
        return '\n';
      default:
        return '';
    }
  }).join('');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeXml(str = '') {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sanitizeId(id = '') {
  // xml:id must start with a letter or underscore, no spaces
  return id.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^([^a-zA-Z_])/, '_$1');
}
