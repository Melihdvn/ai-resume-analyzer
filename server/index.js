import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { marked } from 'marked';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const PROVIDER = (process.env.PROVIDER || (process.env.OPENAI_API_KEY ? 'openai' : (process.env.GEMINI_API_KEY ? 'gemini' : 'mock'))).toLowerCase();
const openai = PROVIDER === 'openai' ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const gemini = PROVIDER === 'gemini' ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

// Serve static frontend
app.use(express.static(path.join(__dirname, '..', 'public')));

// Serve README for quick docs linking from the UI
app.get('/readme', async (req, res) => {
  try {
    const readmePath = path.join(__dirname, '..', 'README.md');
    const md = await fs.readFile(readmePath, 'utf8');
    const html = marked.parse(md);
    res.type('text/html').send(`<!doctype html><html lang="tr"><head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>README</title>
      <style>
        body{font-family:system-ui,Arial,sans-serif;line-height:1.6;margin:0;padding:24px;background:#0b0b0b0a;color:inherit}
        main{max-width:860px;margin:0 auto;background:transparent}
        pre,code{background:#00000010;padding:2px 4px;border-radius:4px}
        pre{padding:12px;overflow:auto}
        h1,h2,h3{margin-top:1.2em}
        a{color:#1677ff;text-decoration:none}
        a:hover{text-decoration:underline}
        ul{padding-left:1.2em}
      </style>
    </head><body><main>${html}</main></body></html>`);
  } catch (e) {
    res.status(500).type('text/plain').send('README yüklenemedi.');
  }
});

app.post('/api/analyze', async (req, res) => {
  try {
    const { text, role } = req.body || {};
    if (!text || typeof text !== 'string' || text.trim().length < 50) {
      return res.status(400).json({ error: 'Yetersiz metin. En az 50 karakter sağlayın.' });
    }

    const today = new Date();
    const todayISO = today.toISOString().slice(0, 10);
    const dateCheck = analyzeDates(text, today);

    const system = `You are an expert resume reviewer. Produce thorough yet crisp Turkish output that STRICTLY follows the exact template below. Do NOT output HTML entities; write plain characters (use ' and " quotes directly). Do NOT use Markdown. Don't talk about date. Bugün: ${todayISO}. Gelecek tarihler bugün tarihine göre değerlendirilmelidir.

Zorunlu Biçim (Başlıklar birebir aynı ve tek satırda olmalı):
Kısa Genel Değerlendirme
<2-4 cümlelik kısa özet; başlık satırına cümle ekleme>

Güçlü Yönler
- <kısa, eyleme dönük madde>
- <kısa, eyleme dönük madde>
- <en az 6 madde üret>

Gelişmeye Açık Alanlar
- <kısa, eyleme dönük madde>
- <en az 6 madde üret>

Eklenebilecek Yönler
- <doğrudan eylem fiiliyle başlayan öneri>
- <en az 6 madde üret>

Kesin Kurallar:
- Yalnızca düz metin kullan; Markdown, ###, *, •, numara vb. kullanma. Madde işareti olarak sadece '-' kullan.
- Başlık satırlarında içerik yazma; içerik bir alt satırdan başlasın.
- Her madde tek satır, somut ve mümkünse metinden kanıt içerir.
- Bir bölümde içerik azsa, alan genel geçer en iyi uygulamalardan yola çıkarak öneri üret; bölümü boş bırakma.
- Dört başlığın DIŞINDA BAŞLIK verme.
- 'İlgi Alanları', 'Hobiler' gibi hobi/merak listeleri ile medeni durum, doğum tarihi, adres, fotoğraf vb. kişisel bilgileri ASLA yazma.

Kapsam Kontrol Listesi (mümkün olduğunca kapsa ve örnekle):
- Teknik/Alan: yazılım, veri, ürün, tasarım, pazarlama, satış, finans, HR, operasyon, eğitim, sağlık, hukuk vb. hangi alana uygunsa.
- Deneyim/Etki: metriklerle sonuçlar (%, süre, maliyet), kapsam (kullanıcı/istek hacmi), ekip rolü (liderlik/mentorluk), süreç (Agile/Scrum), domain bilgisi.
- İçerik kalitesi: netlik, tekrar, tarih/gap tutarlılığı, ATS uygunluğu (anahtar kelime ve sade biçim), yazım/dil tutarlılığı.
- Eksikler: güncel olmayan teknoloji/araçlar, ölçek/versiyon detaylarının eksikliği, ölçülebilir çıktı eksikliği, link/portföy eksikliği, sertifika/başarı eksikliği, erişilebilirlik/güvenlik/izleme izleri.`;

    const prompt = `
Aşağıda bir özgeçmiş metni var. ${
      role ? `Hedef rol: ${role}. ` : ""
    }Metni değerlendir ve talimatlara göre çıktı ver.
---
${text}
---`;

    if (PROVIDER === 'openai') {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt }
        ]
      });
      const raw = completion.choices?.[0]?.message?.content || '';
      const content = decodeHtmlEntities(normalizeEntities(raw));
      return res.json({ analysis: content, provider: 'openai' });
    }

    if (PROVIDER === 'gemini') {
      const preferred = process.env.GEMINI_MODEL || "gemini-2.5-flash-latest";
      const fallbacks = [preferred];
      let lastErr = null;
      for (const id of fallbacks) {
        try {
          const model = gemini.getGenerativeModel({ model: id, systemInstruction: system });
          const r = await model.generateContent(prompt);
          const raw = r?.response?.text?.() || '';
          const content = decodeHtmlEntities(normalizeEntities(raw));
          return res.json({ analysis: content, provider: 'gemini', model: id });
        } catch (e) {
          lastErr = e;
          if (e?.status === 404 || e?.status === 400 || e?.status === 403) continue;
        }
      }
      throw lastErr || new Error('Gemini isteği başarısız.');
    }

    // MOCK
    const content = mockAnalyze(text, role, { today, dateCheck });
    return res.json({ analysis: content, provider: 'mock' });
  } catch (err) {
    console.error(err);
    const code = err?.status || 500;
    res.status(code).json({ error: 'Analiz sırasında bir hata oluştu.' });
  }
});

const port = process.env.PORT || 8787;
app.listen(port, () => {
  console.log(`AI Resume Analyzer running on http://localhost:${port}`);
  console.log(`Provider: ${PROVIDER}`);
});

function mockAnalyze(text, role, context = {}) {
  const t = String(text || '').toLowerCase();

  // 1) Lightweight domain detection (generic, multi-industry)
  const domains = {
    software: ['javascript','typescript','react','java','python','node','c#','dotnet','php','go','docker','kubernetes','aws','azure','gcp','sql','nosql'],
    data: ['data','sql','excel','tableau','power bi','pandas','numpy','statistics','analytics','model','ml','ai','spark','hadoop','python','r'],
    product: ['product','roadmap','backlog','discovery','requirements','stakeholder','mvp','kpi','prio','go to market'],
    design: ['ux','ui','figma','sketch','wireframe','prototype','usability','a/b','visual','design system'],
    marketing: ['seo','sem','google ads','meta ads','campaign','crm','hubspot','mailchimp','content','brand','roi','kpi','cac','ltv','ga4'],
    sales: ['sales','pipeline','crm','leads','quota','negotiation','closing','prospecting','b2b','b2c','salesforce'],
    hr: ['recruit','talent','onboarding','payroll','benefits','people ops','interview','hris'],
    finance: ['finance','accounting','budget','forecast','p&l','cash flow','gaap','ifrs','audit','tax','sap','oracle'],
    operations: ['operations','supply','logistics','inventory','warehouse','lean','six sigma','process','sla'],
    education: ['teacher','instructor','curriculum','lesson','student','pedagogy','assessment','research','publication'],
    healthcare: ['clinic','patient','hospital','nurse','physician','medical','emr','ehr','hipaa','treatment','care'],
    legal: ['law','legal','contract','compliance','case','litigation','ip','gdpr','privacy'],
    customer: ['support','customer success','ticket','sla','csat','nps','zendesk','intercom'],
    project: ['project manager','program','pmo','timeline','scope','budget','risk','gantt','agile','waterfall']
  };
  const domainScores = Object.fromEntries(Object.entries(domains).map(([k, arr]) => [k, arr.reduce((n, kw)=> n + (t.includes(kw) ? 1 : 0), 0)]));
  const topDomains = Object.entries(domainScores).sort((a,b)=>b[1]-a[1]).filter(([,v])=>v>0).slice(0,2).map(([k])=>k);

  // 2) Generic evidence signals
  const hasMetrics = /(\b\d+%\b|\b\d+\s*(ay|yil|year|month)\b|\b\d+\s*(k|m|mn|milyon|million)\b|\b(?:gelir|revenue|cost|maliyet)\b)/i.test(text);
  const hasProjects = /(project|proje|case study|vaka|portfolio|portfoy)/i.test(text);
  const hasLeadership = /(lead|lider|managed|manager|mentored|directed|y[oe]net|koordine)/i.test(t);
  const hasAwards = /(award|odul|basari|recognition|publication|yay[ıi]n)/i.test(t);
  const hasEducation = /(lisans|yuksek lisans|bsc|msc|phd|universite|degree|master|bachelor)/i.test(t);
  const hasCerts = /(certificate|certification|pmp|cfa|cpa|scrum|psm|aws certified|ga4|ielts|toefl)/i.test(t);
  const hasLanguages = /(english|turkish|turkce|german|french|spanish|italian|arabic)/i.test(t);

  // 3) Summary
  const roleLine = role ? `Hedef rol: ${role}. ` : '';
  const domainLine = topDomains.length ? `Olası alan(lar): ${topDomains.join(', ')}. ` : '';
  const summary = `${roleLine}${domainLine}Metin, rol/spesifik yetkinlikler, nicel etki ve genel yetkinlikler açısından kurallı olarak tarandı. Aşağıdaki maddeler yaklaşık değerlendirmedir.`;

  // 4) Strengths (generic)
  const strong = [];
  if (topDomains.length) strong.push(`Domain sinyalleri: ${topDomains.join(', ')} alan(lar)ına dair anahtar kelimeler mevcut.`);
  if (hasMetrics) strong.push('Nicel etki/sonuç ifadeleri bulunuyor (%, süre, adet, gelir/maliyet).');
  if (hasProjects) strong.push('Proje/portföy veya vaka çalışması izleri var.');
  if (hasLeadership) strong.push('Liderlik/koordinasyon veya mentorluk deneyimi sinyali var.');
  if (hasAwards) strong.push('Ödül/başarı/ yayın gibi ayırt edici unsurlar mevcut.');
  if (hasEducation) strong.push('Eğitim geçmişi veya dereceler belirtilmiş.');
  if (hasCerts) strong.push('İlgili sertifikalar/ruhsatlar yer alıyor.');
  if (hasLanguages) strong.push('Yabancı dil bilgisi belirtilmiş.');

  // 5) Weaknesses (generic, cross-domain)
  const weak = [];
  if (!topDomains.length) weak.push('Rol/alan odağı net değil; anahtar kelimeler zayıf.');
  if (!hasMetrics) weak.push('Ölçülebilir sonuçlar zayıf; yüzde/süre/adet/gelir-maliyet ile güçlendirin.');
  if (!hasProjects) weak.push('Somut proje/çalışma örnekleri veya portföy bağlantıları eksik.');
  if (!hasLeadership) weak.push('Liderlik/koordinasyon veya ekip katkısı örnekleri sınırlı.');
  if (!hasAwards) weak.push('Ödül/başarı/ yayın gibi ayırt ediciler yer almıyor.');
  if (!hasEducation) weak.push('Eğitim/sertifika/ruhsat bilgilerinin kapsamı net değil.');
  if (!hasCerts) weak.push('İlgili sertifikalar/ruhsatlar belirtilmemiş.');
  if (!hasLanguages) weak.push('Yabancı dil yeterliliği belirtilmemiş.');

  // 6) Date consistency (future ranges)
  try {
    const dc = context?.dateCheck || analyzeDates(text, context?.today || new Date());
    if (dc.futureRanges.length) weak.push(`Gelecekte görünen tarih aralıkları: ${dc.futureRanges.slice(0,3).join(' | ')}. Geçmişte tamamlandıysa güncelleyiniz.`);
    if (dc.malformed.length) weak.push(`Anlaşılamayan/bozuk tarih ifadeleri: ${dc.malformed.slice(0,3).join(' | ')}. Biçimi netleştiriniz (örn. 07/2023-08/2023).`);
  } catch {}

  // 7) Actionable adds
  const adds = [];
  if (!hasMetrics) adds.push('Başarıları nicelleştirin: % değişim, süre, adet, gelir/maliyet.');
  if (!hasProjects) adds.push('Portföy/case study bağlantıları ekleyin; kapsam-rol-teknik/araç ve etkiyi 1-2 satırda özetleyin.');
  if (!hasCerts) adds.push('Alanla ilgili sertifika/ruhsatları belirtin (ör. PMP/CPA/CFA/GA4 vb.).');
  if (!hasLeadership) adds.push('Liderlik/mentorluk ve ekip içi işbirliği örnekleri ekleyin.');
  if (!hasLanguages) adds.push('Yabancı dil düzeyini (CEFR/puan) ve kullanım bağlamını ekleyin.');
  adds.push('ATS uyumu için sade biçim, net başlıklar ve uygun anahtar kelimeler kullanın.');

  // En az 6 madde kuralını garanti altına al
  const pad = (arr, pool) => {
    const copy = [...arr];
    for (const p of pool) if (copy.length < 6) copy.push(p);
    return copy.slice(0, Math.max(6, copy.length));
  };
  const strongPool = [
    'Net, kısa ve sonuç odaklı anlatım.',
    'İlgili araç ve yöntemlere aşinalık.',
    'Takım çalışması ve iletişim vurgusu.',
    'Sorumluluk almaya ve öğrenmeye açıklık.',
    'Proaktif problem çözme yaklaşımı.',
    'Temiz ve tutarlı biçimlendirme.'
  ];
  const weakPool = [
    'Ölçülebilir sonuçları rakamlarla vurgulayın.',
    'Rol ve kapsamı her projede netleştirin.',
    'Kullanılan araç/süreçleri sürüm ve kapsamla detaylandırın.',
    'Link ve referansları (portföy, GitHub, yayın) ekleyin.',
    'Eğitim/sertifika/ruhsat bilgilerini düzenleyin.',
    'Yazım ve biçim tutarlılığını gözden geçirin.'
  ];
  const addsPool = [
    'Öne çıkan 2-3 projeyi kısa vaka şeklinde ekleyin.',
    'Başarıları yüzde/süre/adet/gelir-maliyet ile nicelleştirin.',
    'Anahtar kelimeleri hedef role uygun olacak şekilde güncelleyin.',
    'Yetkinlikleri güncel versiyon/araç isimleriyle netleştirin.',
    'Sertifika/ödül/ yayın gibi ayırt edicileri ekleyin.',
    'ATS uyumlu, sade ve taranabilir bir düzen kullanın.'
  ];

  const strongOut = pad(strong, strongPool);
  const weakOut = pad(weak, weakPool);
  const addsOut = pad(adds, addsPool);

  return [
    'Kısa Genel Değerlendirme',
    summary,
    '',
    'Güçlü Yönler',
    ...strongOut.map(s => `- ${s}`),
    '',
    'Gelişmeye Açık Alanlar',
    ...weakOut.map(s => `- ${s}`),
    '',
    'Eklenebilecek Yönler',
    ...addsOut.map(s => `- ${s}`)
  ].join('\n');
}

// Basit tarih analizi: metinden ay/yıl aralıklarını çıkarır ve bugüne göre gelecekte bitenleri işaretler
function analyzeDates(text, today = new Date()) {
  const monthMap = new Map([
    ['ocak',1],['subat',2],['mart',3],['nisan',4],['mayis',5],['haziran',6],['temmuz',7],['agustos',8],['eylul',9],['ekim',10],['kasim',11],['aralik',12],
    ['jan',1],['january',1],['feb',2],['february',2],['mar',3],['march',3],['apr',4],['april',4],['may',5],['jun',6],['june',6],['jul',7],['july',7],['aug',8],['august',8],['sep',9],['september',9],['oct',10],['october',10],['nov',11],['november',11],['dec',12],['december',12]
  ]);

  const tokens = [];
  const malformed = [];
  const addToken = (raw, y, m) => tokens.push({ raw, y: Number(y), m: Number(m) });

  const reMy = /(\b(0?[1-9]|1[0-2])\s*[\/\.\-]\s*(\d{4})\b)/gi;
  const reYm = /(\b(\d{4})\s*[\/\.\-]\s*(0?[1-9]|1[0-2])\b)/gi;
  const monthAlternation = Array.from(monthMap.keys()).join('|');
  const reMonthYear = new RegExp(`\\b(${monthAlternation})\\s+(\\d{4})\\b`, 'gi');

  for (const m of text.matchAll(reMy)) addToken(m[1], m[3], m[2]);
  for (const m of text.matchAll(reYm)) addToken(m[1], m[2], m[3]);
  for (const m of text.matchAll(reMonthYear)) {
    const raw = m[0];
    const mon = String(m[1] || '').toLowerCase();
    const yr = m[2];
    const mm = monthMap.get(mon);
    if (mm) addToken(raw, yr, mm); else malformed.push(raw);
  }

  const hyphen = /-|\u2013|\u2014/;
  const ranges = [];
  const lines = text.split(/\n+/);
  for (const line of lines) {
    const parts = line.split(hyphen);
    if (parts.length >= 2) {
      const lhs = parts[0];
      const rhs = parts.slice(1).join('-');
      const start = findNearestToken(lhs, tokens);
      const end = isPresent(rhs) ? { present: true } : findNearestToken(rhs, tokens);
      if (start && (end || isPresent(rhs))) ranges.push({ start, end, raw: `${lhs} - ${rhs}` });
    }
  }

  const nowYM = today.getFullYear() * 100 + (today.getMonth() + 1);
  const futureRanges = [];
  for (const r of ranges) {
    const eYM = r.end?.present ? nowYM : (r.end?.y * 100 + r.end?.m);
    if (eYM && eYM > nowYM) futureRanges.push(r.raw.trim());
  }

  const summary = futureRanges.length ? `Gelecek tarih aralığı saptandı (${futureRanges.length}).` : 'Gelecek tarih aralığı saptanmadı.';
  return { tokens, ranges, futureRanges, malformed, summary };

  function findNearestToken(fragment, tokenList) {
    let best = null;
    for (const t of tokenList) if (fragment.includes(t.raw)) best = t;
    return best;
  }
  function isPresent(str) { return /(present|current|devam|devam ediyor|halen|güncel|guncel)/i.test(str || ''); }
}

// Server-side normalization utilities
function normalizeEntities(str) {
  return String(str || '').replace(/&([^;]{1,30});/g, (m, body) => `&${body.replace(/\s+/g, '')};`);
}

function decodeHtmlEntities(str) {
  let s = String(str || '');
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
    nbsp: ' ', nbsp2: ' '
  };
  s = s.replace(/&([a-zA-Z]+);/g, (m, n) => named[n] ?? m);
  s = s.replace(/&#(\d+);/g, (m, d) => String.fromCharCode(parseInt(d, 10)));
  s = s.replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
  return s;
}
