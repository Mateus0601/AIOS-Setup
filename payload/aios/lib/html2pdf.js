#!/usr/bin/env node
/**
 * html2pdf.js — Gerador de PDF deterministico do AIOS (HTML -> Playwright -> PDF)
 *
 * POR QUE: a geracao via fpdf falha em emoji/glyphs Unicode e e fragil com
 * layout/CSS. Renderizar HTML num Chromium headless e imprimir via
 * page.pdf() resolve isso: o browser ja sabe renderizar fontes, emoji,
 * Unicode, flexbox, grid, e qualquer CSS moderno. O resultado e identico
 * ao que o usuario veria ao imprimir a pagina no navegador.
 *
 * USO COMO MODULO:
 *   const { htmlToPdf } = require('~/.claude/aios/lib/html2pdf.js');
 *   await htmlToPdf({ html: '<h1>Ola</h1>', output: '/tmp/out.pdf' });
 *   await htmlToPdf({ htmlPath: '/tmp/in.html', output: '/tmp/out.pdf' });
 *
 * USO VIA CLI:
 *   node html2pdf.js <input.html> <output.pdf> [--format A4] [--landscape]
 *
 * OPCOES (htmlToPdf):
 *   html        string  HTML inline (mutuamente exclusivo com htmlPath)
 *   htmlPath    string  caminho de um arquivo .html a renderizar
 *   output      string  caminho do PDF de saida (OBRIGATORIO)
 *   format      string  formato de pagina (default 'A4')
 *   landscape   bool    orientacao paisagem (default false)
 *   printBackground bool imprimir cores/imagens de fundo (default true)
 *   margin      object  { top, right, bottom, left } ex: '15mm' (default 15mm)
 *   scale       number  escala de renderizacao 0.1..2 (default 1)
 *   waitUntil   string  evento de carregamento ('networkidle'|'load'|'domcontentloaded')
 *   timeoutMs   number  timeout de navegacao/carregamento (default 30000)
 *
 * RETORNA: { ok: true, output, bytes } ou lanca Error com mensagem clara.
 */

const fs = require('fs');
const path = require('path');

// Resolve o pacote playwright de onde estiver (global npm ou node_modules local).
// Em 8GB RAM o Chromium e pesado mas roda; o erro e tratado com mensagem clara.
function loadPlaywright() {
  const candidates = ['playwright', 'playwright-core'];
  for (const name of candidates) {
    try {
      // require padrao (resolve a partir deste arquivo / node_modules ancestrais)
      return require(name);
    } catch (_) {
      // tenta o diretorio global de npm (Windows: %APPDATA%\npm\node_modules)
      try {
        const globalRoot = require('child_process')
          .execSync('npm root -g', { encoding: 'utf-8' })
          .trim();
        return require(path.join(globalRoot, name));
      } catch (_2) {
        // tenta o proximo candidato
      }
    }
  }
  throw new Error(
    'Playwright nao encontrado. Instale com: npm i -g playwright && npx playwright install chromium'
  );
}

async function htmlToPdf(opts = {}) {
  const {
    html = null,
    htmlPath = null,
    output,
    format = 'A4',
    landscape = false,
    printBackground = true,
    margin = { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
    scale = 1,
    waitUntil = 'networkidle',
    timeoutMs = 30000,
  } = opts;

  // ── Validacao de entrada ──
  if (!output || typeof output !== 'string') {
    throw new Error('html2pdf: parametro "output" (caminho do PDF) e obrigatorio.');
  }
  if (!html && !htmlPath) {
    throw new Error('html2pdf: forneca "html" (string) OU "htmlPath" (arquivo).');
  }
  if (html && htmlPath) {
    throw new Error('html2pdf: forneca apenas UM de "html" ou "htmlPath", nao ambos.');
  }

  // Resolve o conteudo HTML
  let htmlContent;
  let baseUrl = null;
  if (htmlPath) {
    if (!fs.existsSync(htmlPath)) {
      throw new Error(`html2pdf: arquivo HTML nao encontrado: ${htmlPath}`);
    }
    htmlContent = fs.readFileSync(htmlPath, 'utf-8');
    // base file:// para resolver assets relativos (imagens/css locais)
    baseUrl = 'file://' + path.resolve(htmlPath);
  } else {
    htmlContent = html;
  }

  // Garante que o diretorio de saida existe
  const outDir = path.dirname(path.resolve(output));
  fs.mkdirSync(outDir, { recursive: true });

  const playwright = loadPlaywright();

  let browser = null;
  try {
    browser = await playwright.chromium.launch({
      headless: true,
      // flags que reduzem footprint de memoria (relevante em 8GB RAM)
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });

    const page = await browser.newPage();

    // Carrega o HTML. Se veio de arquivo, navega via file:// para resolver assets;
    // senao injeta o conteudo via setContent.
    if (baseUrl) {
      await page.goto(baseUrl, { waitUntil, timeout: timeoutMs });
    } else {
      await page.setContent(htmlContent, { waitUntil, timeout: timeoutMs });
    }

    // Emula media 'screen' por padrao do print? Nao — print e o correto para PDF,
    // mas emulamos 'screen' so se o usuario quiser. Default: usar o CSS print do doc.
    // Para fidelidade com o que se ve na tela, emulamos screen:
    await page.emulateMedia({ media: 'screen' });

    await page.pdf({
      path: output,
      format,
      landscape,
      printBackground,
      margin,
      scale,
    });

    const bytes = fs.statSync(output).size;
    return { ok: true, output: path.resolve(output), bytes };
  } catch (err) {
    throw new Error(`html2pdf: falha ao gerar PDF — ${err.message}`);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (_) {
        /* ignore close errors */
      }
    }
  }
}

// ── CLI ──
async function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 2 || argv.includes('--help') || argv.includes('-h')) {
    console.log(
      'Uso: node html2pdf.js <input.html> <output.pdf> [--format A4] [--landscape]'
    );
    process.exit(argv.length < 2 ? 1 : 0);
  }

  const inputHtml = argv[0];
  const outputPdf = argv[1];
  const format = argv.includes('--format')
    ? argv[argv.indexOf('--format') + 1]
    : 'A4';
  const landscape = argv.includes('--landscape');

  try {
    const res = await htmlToPdf({
      htmlPath: inputHtml,
      output: outputPdf,
      format,
      landscape,
    });
    console.log(`OK: PDF gerado em ${res.output} (${res.bytes} bytes)`);
    process.exit(0);
  } catch (err) {
    console.error(`ERRO: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { htmlToPdf };
