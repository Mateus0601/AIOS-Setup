# PDF Generation

> Scope: When the task requires generating a PDF (report, apostila, document, invoice, slide export, certificate). Always prefer the HTML -> Playwright path over PDF libraries that draw text glyph-by-glyph.

## Core Principles
- The browser is the most reliable PDF renderer available — it already handles fonts, Unicode, emoji, flexbox, grid, and every modern CSS feature
- Author the document as HTML+CSS, then "print to PDF" via a headless Chromium — what you see in the browser is what lands in the PDF
- NEVER use `fpdf`/`fpdf2`/`reportlab`-by-hand for rich documents: they fail on emoji and non-Latin glyphs, require manual font registration, and break on any layout beyond plain text
- Deterministic output: same HTML in, same PDF out. No fragile coordinate math
- The reusable generator lives at `~/.claude/aios/lib/html2pdf.js` — use it, do not reinvent

## DO (Mandatory Practices)

### The Canonical Pipeline
1. Build a self-contained HTML string or `.html` file with full CSS (inline `<style>` is fine, web fonts via `@font-face` or Google Fonts link work)
2. Use native Unicode/emoji directly in the markup (✅ 🔍 — the browser renders them; no font registration needed)
3. Render via Playwright Chromium headless and call `page.pdf({ path, format: 'A4', printBackground: true })`
4. `printBackground: true` is REQUIRED whenever you use background colors/images (cards, headers, highlights) — without it backgrounds are dropped

### Using the AIOS generator (preferred)
```js
const { htmlToPdf } = require('/c/Users/mateu/.claude/aios/lib/html2pdf.js');

// from an inline string
await htmlToPdf({ html: '<h1>Relatório ✅</h1>', output: '/tmp/out.pdf' });

// from a file (resolves relative images/css via file://)
await htmlToPdf({ htmlPath: '/tmp/doc.html', output: '/tmp/out.pdf', format: 'A4' });
```
Options: `format` (default 'A4'), `landscape`, `printBackground` (default true), `margin` (default 15mm all sides), `scale`, `waitUntil`, `timeoutMs`.

### Raw Playwright (when you need full control)
```js
const { chromium } = require('playwright');
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'], // lower memory footprint
});
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'networkidle' });
await page.emulateMedia({ media: 'screen' }); // fidelity to what's seen on screen
await page.pdf({ path: out, format: 'A4', printBackground: true, margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' } });
await browser.close();
```

### Typography & Layout (carries the apostila feedback)
- Body text 12–13pt, line-height 1.6–1.7 for long A4 documents (11pt EB Garamond was too small/tiring)
- Serif options for long reading: Crimson Pro, Source Serif, Charter, EB Garamond at 12pt+
- Use `@page { size: A4; margin: 15mm; }` in CSS for explicit page geometry
- Page breaks: `page-break-after`, `break-inside: avoid` to keep cards/tables from splitting
- All pt-BR text MUST carry correct accents (ç, ã, õ, á...) — the browser renders them natively, no excuse to drop them

### ABNT (academic work: apostila, monografia, relatório acadêmico)
- **Capa** carries: instituição, nome do aluno, título, cidade, ano. It is its own page.
- **Folha de rosto** carries: nome do aluno, título, a **nota de apresentação** (e.g. "Trabalho apresentado à disciplina X como requisito...") and the **professor/orientador**, then cidade + ano.
- **Capa and folha de rosto do NOT duplicate** the student name/date redundantly — the folha de rosto adds the nota de apresentação + professor that the capa does NOT have; it is not a copy of the capa.
- Each front-matter element on its own page: use `page-break-after: always` (or a `.page` wrapper with `break-after: page`) between capa, folha de rosto, sumário and body.
- ABNT body defaults: serif (Times-like / a reading serif), corpo 12pt, line-height ≈1.5, margins 3cm left/top and 2cm right/bottom (`@page { margin: 3cm 2cm 2cm 3cm; }`).

### Memory awareness (8GB RAM machine)
- Chromium is heavy but runs; pass `--disable-dev-shm-usage --disable-gpu` to reduce footprint
- ALWAYS `await browser.close()` in a `finally` block to free memory even on error
- For very large documents, render in one pass — do not spawn multiple browsers in parallel

## DON'T (Anti-Patterns)
- **fpdf / fpdf2 / reportlab manual drawing:** no emoji, no glyph fallback, manual font registration, breaks on accents and non-Latin scripts. Banned for rich documents
- **Coordinate-based layout** (x/y text placement): fragile, unmaintainable, breaks on content length changes
- **Forgetting `printBackground: true`:** background colors/images silently vanish from the PDF
- **Leaving the browser open:** leaks memory — always close in `finally`
- **Inlining gigantic base64 images** when a `file://` reference works — bloats memory
- **Assuming a font is installed:** embed via `@font-face` / Google Fonts link, or stick to system + web-safe fonts

## When to Use What
| Situation | Approach |
|-----------|----------|
| Report, apostila, invoice, certificate, any rich/styled PDF | HTML + `html2pdf.js` (Playwright) |
| Export an existing rendered page/slide to PDF | Playwright `page.pdf()` directly |
| Plain ASCII-only text dump, no styling, no accents/emoji | a simple text lib is acceptable, but HTML path still preferred for consistency |
| Anything with emoji, accents, non-Latin, or real layout | HTML + Playwright — NEVER fpdf |

## Pre-Delivery Checklist
- [ ] Document authored as HTML+CSS, not coordinate-drawn
- [ ] `printBackground: true` when backgrounds are used
- [ ] Emoji and pt-BR accents render correctly (visually confirmed if Chromium ran)
- [ ] `format: 'A4'` and explicit margins set
- [ ] Body typography 12–13pt with 1.6–1.7 line-height for long documents
- [ ] If ABNT: capa and folha de rosto are distinct pages — folha de rosto adds nota de apresentação + professor, does NOT just duplicate the capa
- [ ] Browser closed in a `finally` block
- [ ] Output file exists and starts with the `%PDF` magic header
- [ ] If Chromium could not run (memory), documented that the test was skipped and why
