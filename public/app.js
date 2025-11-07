// PDF.js worker ayarı (CDN)
if (window['pdfjsLib']) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
}

const els = {
  file: document.getElementById('file-input'),
  role: document.getElementById('role'),
  analyze: document.getElementById('analyze-btn'),
  themeToggle: document.getElementById('theme-toggle'),
  clearBtn: document.getElementById('clear-btn'),
  pdfPreview: document.getElementById('pdf-preview'),
  resultRoot: document.getElementById('result-root')
};

let extractedText = '';
let latestFileType = 'text';
let extractToken = 0;

function maskPII(input) {
  if (!input) return '';
  let out = input;
  // E-posta maskeleme
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]');
  // Telefon maskeleme (esnek)
  out = out.replace(/(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{2,4}/g, (m) => m.length >= 7 ? '[phone]' : m);
  // LinkedIn URL maskeleme
  out = out.replace(/https?:\/\/(?:www\.)?linkedin\.com\/[A-Za-z0-9_\-./]+/gi, '[linkedin]');
  // Fazla boşlukları sadeleştir
  out = out.replace(/[\t ]+/g, ' ');
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

function updatePreview() {
  const raw = els.raw.value || '';
  const show = els.filters.checked ? maskPII(raw) : raw;
  els.preview.textContent = show;
  latestText = show;
}

// Dosya okuma (txt veya pdf)
els.file.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    latestFileType = 'pdf';
    // PDF önizlemeyi hemen başlat, metin çıkarımı arkada çalışsın
    renderPdfPreview(file).catch(console.error);
    const myToken = ++extractToken;
    showExtractStatus('PDF metne dönüştürülüyor...');
    // Arka planda, UI’ı bloklamadan
    setTimeout(() => {
      extractPdfText(file, (p, total) => {
        if (myToken !== extractToken) return;
        showExtractStatus(`PDF metne dönüştürülüyor... (${p}/${total})`);
      }).then(text => {
        if (myToken !== extractToken) return;
        extractedText = text;
        showExtractStatus('PDF metne dönüştürüldü.');
        setTimeout(() => { if (myToken === extractToken) showExtractStatus(''); }, 1500);
      }).catch(err => {
        if (myToken !== extractToken) return;
        console.error(err);
        showExtractStatus('PDF metne dönüştürme sırasında hata.');
      });
    }, 0);
  } else {
    latestFileType = 'text';
    const reader = new FileReader();
    reader.onload = () => {
      extractedText = String(reader.result || '');
      showExtractStatus('Metin dosyası yüklendi.');
      setTimeout(() => showExtractStatus(''), 1000);
    };
    reader.readAsText(file);
  }
});

async function extractPdfText(file, onProgress) {
  if (!window['pdfjsLib']) {
    alert('PDF desteği için PDF.js yüklenemedi.');
    return '';
  }
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const parts = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(it => it.str).join(' ');
    parts.push(pageText);
    if (onProgress) onProgress(i, doc.numPages);
  }
  return parts.join('\n');
}

async function renderPdfPreview(file) {
  els.pdfPreview.innerHTML = '';
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const maxPages = Math.min(doc.numPages, 6);
  for (let i = 1; i <= maxPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 0.8 });
    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-canvas';
    const ctx = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    els.pdfPreview.appendChild(canvas);
    await page.render({ canvasContext: ctx, viewport }).promise;
  }
}

async function analyze() {
  const text = extractedText;
  const role = els.role.value.trim();
  if (!text || text.length < 50) {
    alert('Lütfen en az 50 karakterlik metin sağlayın.');
    return;
  }
  els.analyze.disabled = true;
  appActions.showLoading();
  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, role })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'İstek başarısız');
    appActions.renderAnalysis(String(data.analysis || ''));
  } catch (err) {
    console.error(err);
    appActions.showError('Hata: ' + (err?.message || 'Bilinmeyen hata'));
  } finally {
    els.analyze.disabled = false;
  }
}

els.analyze.addEventListener('click', analyze);

// Component-like Result Panel (Preact + htm)
const { h, render } = preact;
const html = htm.bind(h);

const store = { status: 'idle', summary: '', pros: [], cons: [], adds: [], raw: '' };
function updateStore(patch) { Object.assign(store, patch); rerender(); }

function ResultView({ s }) {
  const hidden = s.status === 'idle';
  const loading = s.status === 'loading';
  const showContent = s.status === 'done' || s.status === 'error';
  return html`
    <div class="result ${hidden ? 'hidden' : ''}">
      ${loading && html`
        <div class="skeleton">
          <div class="skeleton-line lg"></div>
          <div class="columns">
            <div class="col"><div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div></div>
            <div class="col"><div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div></div>
            <div class="col"><div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div></div>
          </div>
        </div>`}
      ${showContent && html`
        <div class="result-content">
          <div class="summary">${sanitizeText(s.summary)}</div>
          <div class="columns">
            <div class="col col-pros">
              <h3>Güçlü Yönler</h3>
              <ul class="bullet-list pros">
                ${s.pros.map(item => html`<li>${raw(iconSVG('pros'))}<span>${sanitizeText(stripBullet(item))}</span></li>`) }
              </ul>
            </div>
            <div class="col col-cons">
              <h3>Gelişmeye Açık Alanlar</h3>
              <ul class="bullet-list cons">
                ${s.cons.map(item => html`<li>${raw(iconSVG('cons'))}<span>${sanitizeText(stripBullet(item))}</span></li>`) }
              </ul>
            </div>
            <div class="col col-adds">
              <h3>Eklenebilecek Yönler</h3>
              <ul class="bullet-list adds">
                ${s.adds.map(item => html`<li>${raw(iconSVG('adds'))}<span>${sanitizeText(stripBullet(item))}</span></li>`) }
              </ul>
            </div>
          </div>
          ${(!s.summary && !s.pros.length && !s.cons.length && !s.adds.length && s.raw) && html`<div class="pre">${decodeEntities(normalizeEntities(s.raw))}</div>`}
        </div>`}
    </div>
  `;
}

function raw(htmlString) { return html([htmlString]); }
function stripBullet(s){ return String(s||'').replace(/^[-•*]\s*/, '').trim(); }
function rerender(){ render(h(ResultView, { s: store }), els.resultRoot); }

const appActions = {
  showLoading(){ updateStore({ status: 'loading', summary: 'Analiz ediliyor...', pros: [], cons: [], adds: [], raw: '' }); },
  showError(msg){ updateStore({ status: 'error', summary: msg, pros: [], cons: [], adds: [], raw: '' }); },
  renderAnalysis(text){
    const parsed = parseAnalysis(text);
    if (!parsed.summary && !parsed.pros.length && !parsed.cons.length && !parsed.adds.length) {
      updateStore({ status: 'done', summary: '', pros: [], cons: [], adds: [], raw: text });
    } else {
      updateStore({ status: 'done', summary: parsed.summary, pros: parsed.pros, cons: parsed.cons, adds: parsed.adds, raw: '' });
    }
  }
};

function parseAnalysis(text) {
  const cleanedText = decodeEntities(normalizeEntities(String(text || '')));
  const rawLines = cleanedText.split(/\r?\n/);
  const lines = rawLines.map(l => l.replace(/^\s+|\s+$/g, '')).filter(Boolean);
  let section = 'summary';
  const data = { summary: '', pros: [], cons: [], adds: [] };
  const headingRe = /(k[ıi]sa genel de[ğg]erlendirme|genel de[ğg]erlendirme|g[üu]çl[üu] y[öo]nler|geli[şs]meye a[çc][ıi]k alanlar|zay[ıi]f y[öo]nler|eklenebilecek y[öo]nler)/i;
  const whichSection = (h) => {
    if (/g[üu]çl[üu] y[öo]nler/i.test(h)) return 'pros';
    if (/(geli[şs]meye a[çc][ıi]k alanlar|zay[ıi]f y[öo]nler)/i.test(h)) return 'cons';
    if (/eklenebilecek y[öo]nler/i.test(h)) return 'adds';
    return 'summary';
  };

  for (let l of lines) {
    const cleaned = l.replace(/^[#>*\s]+/, '');
    const m = cleaned.match(headingRe);
    if (m && cleaned.toLowerCase().startsWith(m[1].toLowerCase())) {
      section = whichSection(m[1]);
      const rest = cleaned.slice(m[1].length).trim();
      if (rest) {
        if (section === 'summary') {
          data.summary += (data.summary ? '\n' : '') + rest.replace(/^[-•*]\s*/, '');
        } else {
          const item = rest.replace(/^[-•*]\s*/, '');
          if (item) data[section].push('- ' + item);
        }
      }
      continue;
    }

    if (section === 'summary') {
      if (data.summary.split(/\n/).length < 4) {
        data.summary += (data.summary ? '\n' : '') + cleaned.replace(/^[-•*]\s*/, '');
      }
    } else {
      const item = cleaned.replace(/^[-•*]\s*/, '');
      if (item) data[section].push('- ' + item);
    }
  }
  
  // If adds missing, synthesize from cons
  if (!data.adds.length && data.cons.length) {
    data.adds = data.cons.slice(0, 6).map(s => toActionable(s));
  }
  return data;
}

function toActionable(s) {
  let t = s.replace(/^[-•*]\s*/, '').trim();
  t = t
    .replace(/eklenebilir/gi, 'ekleyin')
    .replace(/netleştirilebilir/gi, 'netleştirin')
    .replace(/örneklendirilebilir/gi, 'örneklendirin')
    .replace(/belirtilebilir/gi, 'belirtin')
    .replace(/gösterilebilir/gi, 'gösterin')
    .replace(/iyileştirilebilir/gi, 'iyileştirin')
    .replace(/art(t)?ırılabilir/gi, 'arttırın')
    .replace(/sınırlı/gi, 'güncelleyin')
    .replace(/yok/gi, 'ekleyin');
  if (!/[.!?]$/.test(t)) t += '.';
  if (!/^(Ekleyin|Netleştirin|Örneklendirin|Belirtin|Gösterin|İyileştirin|Arttırın|Güncelleyin|Geliştirin)/i.test(t)) {
    t = 'Geliştirin: ' + t;
  }
  return '- ' + t;
}

// Removed legacy DOM togglers; Preact view handles states

function iconSVG(type) {
  const base = {
    pros: '<svg class="ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
    cons: '<svg class="ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>',
    adds: '<svg class="ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 13H13v6h-2v-6H5v-2h6V5h2v6h6z"/></svg>'
  };
  return base[type] || '';
}

function showExtractStatus(msg) {
  const el = document.getElementById('text-extract-status');
  if (el) el.textContent = msg || '';
}

function escapeHtml(str) {
  return str
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// Decode HTML entities and then escape for safe insertion
function decodeEntities(str) {
  try {
    const ta = document.createElement('textarea');
    ta.innerHTML = String(str || '');
    return ta.value;
  } catch {
    return String(str || '');
  }
}

function sanitizeText(s) {
  return escapeHtml(decodeEntities(normalizeEntities(String(s || ''))));
}

function normalizeEntities(str) {
  // Collapse whitespace inside HTML entities: & q u o t ; -> &quot;
  return String(str || '').replace(/&([^;]{1,30});/g, (m, body) => {
    const compact = body.replace(/\s+/g, '');
    return `&${compact};`;
  });
}

// Tema toggle
function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved);
  els.themeToggle?.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  });
}

// Temizle
els.clearBtn?.addEventListener('click', (e) => {
  e.preventDefault();
  els.file.value = '';
  els.pdfPreview.innerHTML = '';
  extractedText = '';
  latestFileType = 'text';
  updateStore({ status: 'idle', summary: '', pros: [], cons: [], adds: [], raw: '' });
});

// İlk render
rerender();
initTheme();
