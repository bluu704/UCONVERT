// DocModel → 각 형식 파일
import { htmlToBlocks, blocksToText, runsText, escapeHtml, dataUrlToBytes, toEmbeddable, sniffImageMime } from './blocks.js';
import { MIME } from '../../formats.js';

const allHtml = (doc) => doc.chapters.map(c => c.html).join('\n');
const allBlocks = (doc) => doc.chapters.flatMap((c, i) => (i ? [{ type: 'break' }] : []).concat(htmlToBlocks(c.html)));

export async function writeDoc(doc, target, opts, progress) {
  switch (target) {
    case 'html': return new Blob([htmlPage(doc)], { type: MIME.html });
    case 'txt': return new Blob([blocksToText(allBlocks(doc))], { type: MIME.txt });
    case 'md': {
      const TurndownService = (await import('turndown')).default;
      const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
      td.remove(['script', 'style']);
      // 큰 data: 이미지는 마크다운에 넣지 않는다
      td.addRule('img', { filter: 'img', replacement: (_, n) => { const s = n.getAttribute('src') || ''; return /^data:/.test(s) ? (n.getAttribute('alt') ? `*[그림: ${n.getAttribute('alt')}]*` : '') : `![${n.getAttribute('alt') || ''}](${s})`; } });
      return new Blob([doc.chapters.map(c => td.turndown(c.html)).join('\n\n---\n\n') + '\n'], { type: MIME.md });
    }
    case 'docx': return writeDocx(doc, progress);
    case 'rtf': return new Blob([writeRtf(allBlocks(doc))], { type: MIME.rtf });
    case 'odt': return writeOdt(doc);
    case 'epub': return writeEpub(doc, progress);
    case 'pdf': return (await import('./pdf.js')).writePdf(doc, opts, progress);
  }
  throw new Error('이 형식으로는 저장할 수 없어요');
}

function htmlPage(doc) {
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(doc.title)}</title>
<style>body{max-width:44em;margin:2em auto;padding:0 1em;font:17px/1.75 "Noto Serif KR","Nanum Myeongjo",serif;color:#1b1b1b}
img{max-width:100%;height:auto}h1,h2,h3{line-height:1.3}pre{white-space:pre-wrap;background:#f4f4f4;padding:1em}
table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:.3em .6em}.chapter{break-before:page}</style>
</head><body>
${doc.chapters.map((c, i) => `<section class="${i ? 'chapter' : ''}">${c.html}</section>`).join('\n')}
</body></html>`;
}

/* ---------- DOCX ---------- */
async function writeDocx(doc, progress) {
  const D = await import('docx');
  const blocks = allBlocks(doc);
  const children = [];
  const runs = (rs, extra = {}) => rs.map(r => r.br ? new D.TextRun({ break: 1 }) : new D.TextRun({ text: r.text, bold: r.b || extra.b, italics: r.i || extra.i, underline: r.u ? {} : undefined, font: extra.font }));
  const H = [D.HeadingLevel.HEADING_1, D.HeadingLevel.HEADING_2, D.HeadingLevel.HEADING_3, D.HeadingLevel.HEADING_4, D.HeadingLevel.HEADING_5, D.HeadingLevel.HEADING_6];
  let n = 0;
  for (const b of blocks) {
    n++;
    if (n % 50 === 0) progress?.(0.6 + 0.3 * n / blocks.length);
    if (b.type === 'h') children.push(new D.Paragraph({ heading: H[b.level - 1], children: runs(b.runs) }));
    else if (b.type === 'p') {
      const indent = b.indent ? { left: 360 * b.indent } : undefined;
      const pre = b.bullet ? [new D.TextRun({ text: b.bullet + ' ' })] : [];
      children.push(new D.Paragraph({ indent, spacing: { after: 120 }, children: pre.concat(runs(b.runs, { i: b.quote })) }));
    }
    else if (b.type === 'pre') children.push(new D.Paragraph({ children: b.text.split('\n').flatMap((l, i) => [...(i ? [new D.TextRun({ break: 1 })] : []), new D.TextRun({ text: l, font: 'Consolas', size: 19 })]) }));
    else if (b.type === 'hr') children.push(new D.Paragraph({ border: { bottom: { style: D.BorderStyle.SINGLE, size: 6, color: 'BBBBBB', space: 1 } }, children: [] }));
    else if (b.type === 'break') children.push(new D.Paragraph({ children: [new D.PageBreak()] }));
    else if (b.type === 'img') {
      const e = await toEmbeddable(b.src);
      if (!e) continue;
      const maxW = 600, sc = Math.min(1, maxW / e.width);
      children.push(new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.ImageRun({ type: e.kind === 'png' ? 'png' : 'jpg', data: e.bytes, transformation: { width: Math.round(e.width * sc), height: Math.round(e.height * sc) } })] }));
    }
    else if (b.type === 'table') {
      const cols = Math.max(...b.rows.map(r => r.length));
      children.push(new D.Table({
        width: { size: 100, type: D.WidthType.PERCENTAGE },
        rows: b.rows.map(r => new D.TableRow({ children: Array.from({ length: cols }, (_, i) => new D.TableCell({ children: [new D.Paragraph({ children: runs(r[i] || [{ text: '' }]) })] })) })),
      }));
    }
  }
  const document = new D.Document({
    creator: 'UCONVERT', title: doc.title,
    styles: { default: { document: { run: { font: '맑은 고딕', size: 22 } } } },
    sections: [{ children }],
  });
  return D.Packer.toBlob(document);
}

/* ---------- RTF ---------- */
function rtfEsc(s) {
  let o = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === '\\' || ch === '{' || ch === '}') o += '\\' + ch;
    else if (ch === '\n') o += '\\line ';
    else if (c < 128) o += ch;
    else if (c > 0xffff) { const s2 = String.fromCodePoint(c); for (let k = 0; k < 2; k++) { let u = s2.charCodeAt(k); if (u > 32767) u -= 65536; o += `\\u${u}?`; } }
    else { let u = c; if (u > 32767) u -= 65536; o += `\\u${u}?`; }
  }
  return o;
}
function writeRtf(blocks) {
  let o = '{\\rtf1\\ansi\\ansicpg949\\deff0{\\fonttbl{\\f0\\fnil\\fcharset129 Malgun Gothic;}{\\f1\\fmodern Consolas;}}\\uc1\\f0\\fs22\n';
  const r = (rs) => rs.map(x => x.br ? '\\line ' : (x.b ? '{\\b ' : '') + (x.i ? '{\\i ' : '') + rtfEsc(x.text) + (x.i ? '}' : '') + (x.b ? '}' : '')).join('');
  for (const b of blocks) {
    if (b.type === 'h') o += `{\\pard\\sb240\\sa120\\b\\fs${[40, 34, 30, 26, 24, 22][b.level - 1]} ${r(b.runs)}\\par}\n`;
    else if (b.type === 'p') o += `{\\pard\\sa120\\li${(b.indent || 0) * 360} ${b.bullet ? rtfEsc(b.bullet + ' ') : ''}${r(b.runs)}\\par}\n`;
    else if (b.type === 'pre') o += `{\\pard\\f1\\fs19 ${rtfEsc(b.text)}\\par}\n`;
    else if (b.type === 'table') for (const row of b.rows) o += `{\\pard ${row.map(c => rtfEsc(runsText(c))).join('\\tab ')}\\par}\n`;
    else if (b.type === 'break') o += '\\page\n';
  }
  return o + '}';
}

/* ---------- ODT ---------- */
async function writeOdt(doc) {
  const JSZip = (await import('jszip')).default;
  const x = (s) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const r = (rs) => rs.map(t => t.br ? '<text:line-break/>' : (t.b ? `<text:span text:style-name="B">${x(t.text)}</text:span>` : x(t.text))).join('');
  let body = '';
  for (const b of allBlocks(doc)) {
    if (b.type === 'h') body += `<text:h text:outline-level="${b.level}">${r(b.runs)}</text:h>`;
    else if (b.type === 'p') body += `<text:p>${b.bullet ? x(b.bullet + ' ') : ''}${r(b.runs)}</text:p>`;
    else if (b.type === 'pre') body += b.text.split('\n').map(l => `<text:p text:style-name="Pre">${x(l)}</text:p>`).join('');
    else if (b.type === 'table') body += b.rows.map(row => `<text:p>${x(row.map(c => runsText(c)).join('  |  '))}</text:p>`).join('');
    else if (b.type === 'break') body += '<text:p text:style-name="Break"/>';
  }
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.3">
<office:automatic-styles>
<style:style style:name="B" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>
<style:style style:name="Pre" style:family="paragraph"><style:text-properties style:font-name="Consolas" fo:font-size="9.5pt"/></style:style>
<style:style style:name="Break" style:family="paragraph"><style:paragraph-properties fo:break-before="page"/></style:style>
</office:automatic-styles>
<office:body><office:text>${body}</office:text></office:body></office:document-content>`;
  const zip = new JSZip();
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' });
  zip.file('content.xml', content);
  zip.file('META-INF/manifest.xml', `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>
<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`);
  return zip.generateAsync({ type: 'blob', mimeType: MIME.odt, compression: 'DEFLATE' });
}

/* ---------- EPUB ---------- */
async function writeEpub(doc, progress) {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  const x = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const manifest = [], spine = [], nav = [];
  const imgMap = new Map();
  let imgN = 0;
  const extOfMime = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
  const ser = new XMLSerializer();

  doc.chapters.forEach((c, i) => {
    const d = document.implementation.createHTMLDocument('');
    d.body.innerHTML = c.html;
    d.body.querySelectorAll('script,style,iframe,object,embed,form,input,button').forEach(e => e.remove());
    for (const img of d.body.querySelectorAll('img')) {
      const src = img.getAttribute('src') || '';
      if (!/^data:/.test(src)) { img.remove(); continue; }
      if (!imgMap.has(src)) {
        const dd = dataUrlToBytes(src);
        const mime = sniffImageMime(dd.bytes) || dd.mime;
        const ext = extOfMime[mime];
        if (!ext) { img.remove(); continue; }
        const name = `images/img${++imgN}.${ext}`;
        zip.file('OEBPS/' + name, dd.bytes);
        manifest.push(`<item id="img${imgN}" href="${name}" media-type="${mime}"/>`);
        imgMap.set(src, name);
      }
      img.setAttribute('src', '../' + imgMap.get(src));
      if (!img.hasAttribute('alt')) img.setAttribute('alt', '');
    }
    let inner = ser.serializeToString(d.body).replace(/^<body[^>]*>/, '').replace(/<\/body>$/, '');
    const name = `text/ch${String(i + 1).padStart(3, '0')}.xhtml`;
    const t = c.title || `${i + 1}`;
    zip.file('OEBPS/' + name, `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ko" lang="ko"><head><title>${x(t)}</title><link rel="stylesheet" type="text/css" href="../style.css"/></head><body>${inner}</body></html>`);
    manifest.push(`<item id="ch${i + 1}" href="${name}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="ch${i + 1}"/>`);
    if (!doc.imagesOnly || i === 0) nav.push(`<li><a href="${name}">${x(doc.imagesOnly ? doc.title : t)}</a></li>`);
    progress?.(0.6 + 0.35 * (i + 1) / doc.chapters.length);
  });

  zip.file('OEBPS/style.css', 'body{font-family:serif;line-height:1.7;margin:0 .5em}img{max-width:100%;height:auto;display:block;margin:0 auto}h1,h2,h3{line-height:1.3}pre{white-space:pre-wrap}');
  zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ko"><head><title>목차</title></head><body><nav epub:type="toc" id="toc"><h1>목차</h1><ol>${nav.join('')}</ol></nav></body></html>`);
  const uid = 'urn:uuid:' + (crypto.randomUUID?.() || Date.now());
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="ko">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">${uid}</dc:identifier><dc:title>${x(doc.title)}</dc:title><dc:language>ko</dc:language><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/>${manifest.join('')}</manifest>
<spine>${spine.join('')}</spine></package>`);
  return zip.generateAsync({ type: 'blob', mimeType: MIME.epub, compression: 'DEFLATE' });
}
