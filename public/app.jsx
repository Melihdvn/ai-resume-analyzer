/* global pdfjsLib, React, ReactDOM, antd, icons */
const { useState, useEffect, useMemo } = React;
const { ConfigProvider, theme, Layout, Typography, Space, Card, Upload, message, Button, Input, Row, Col, List, Skeleton, Progress, Switch, Divider, Alert, Tag, App: AntApp } = antd;
const { Header, Content, Footer } = Layout;
const { Title, Text } = Typography;
const { InboxOutlined, FilePdfOutlined, FileTextOutlined, ThunderboltOutlined, BulbOutlined, CheckCircleTwoTone, CloseCircleTwoTone, PlusCircleTwoTone } = icons;

if (window['pdfjsLib']) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
}

function normalizeEntities(str) {
  return String(str || '').replace(/&([^;]{1,30});/g, (m, body) => `&${body.replace(/\s+/g, '')};`);
}
function decodeEntities(str) {
  try { const ta = document.createElement('textarea'); ta.innerHTML = String(str || ''); return ta.value; } catch { return String(str || ''); }
}
function stripBullet(s){ return String(s||'').replace(/^[-•*]\s*/, '').trim(); }

async function extractPdfText(file, onProgress) {
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const parts = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(it => it.str).join(' ');
    parts.push(pageText);
    onProgress?.(i, doc.numPages);
  }
  return parts.join('\n');
}

async function buildPdfPreviews(file, maxPages = 6, scale = 0.9) {
  const images = [];
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const pages = Math.min(doc.numPages, maxPages);
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;
    images.push(canvas.toDataURL('image/png'));
  }
  return images;
}

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
  for (const l0 of lines) {
    const l = l0.replace(/^[#>*\s]+/, '');
    const m = l.match(headingRe);
    if (m && l.toLowerCase().startsWith(m[1].toLowerCase())) {
      section = whichSection(m[1]);
      const rest = l.slice(m[1].length).trim();
      if (rest) {
        if (section === 'summary') data.summary += (data.summary ? '\n' : '') + rest.replace(/^[-•*]\s*/, '');
        else data[section].push('- ' + rest.replace(/^[-•*]\s*/, ''));
      }
      continue;
    }
    if (section === 'summary') {
      if (data.summary.split(/\n/).length < 4) data.summary += (data.summary ? '\n' : '') + l.replace(/^[-•*]\s*/, '');
    } else {
      const item = l.replace(/^[-•*]\s*/, ''); if (item) data[section].push('- ' + item);
    }
  }
  const banned = /(ilgi alanlar[ıi]|hobi(ler)?|kişisel bilgiler|kisisel bilgiler|medeni durum|doğum tarihi|dogum tarihi|adres|fotoğraf|fotograf)/i;
  data.pros = data.pros.filter(s => !banned.test(s));
  data.cons = data.cons.filter(s => !banned.test(s));
  data.adds = data.adds.filter(s => !banned.test(s));
  if (!data.adds.length && data.cons.length) data.adds = data.cons.slice(0,6).map(s => '- ' + stripBullet(s));
  return data;
}

function SectionCard({ title, items, color, icon }) {
  return (
    <Card size="small" title={<Space>{icon}<Text strong>{title}</Text></Space>} bordered>
      <List
        dataSource={items}
        locale={{ emptyText: '—' }}
        renderItem={(it) => (
          <List.Item style={{ padding: '6px 0' }}>
            <Space align="start">
              {icon}
              <Text>{stripBullet(it)}</Text>
            </Space>
          </List.Item>
        )}
      />
    </Card>
  );
}

function AppShell() {
  const [isDark, setIsDark] = useState(false);
  const [file, setFile] = useState(null);
  const [previews, setPreviews] = useState([]);
  const [extract, setExtract] = useState({ text: '', current: 0, total: 0, status: '' });
  const [role, setRole] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState({ summary: '', pros: [], cons: [], adds: [] });
  const [provider, setProvider] = useState('');
  const [hasRequested, setHasRequested] = useState(false);
  const resultRef = React.useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!file) { setPreviews([]); setExtract({ text: '', current: 0, total: 0, status: '' }); return; }
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      // PDF preview immediately
      buildPdfPreviews(file).then(setPreviews).catch(() => setPreviews([]));
      // Background text extraction
      setExtract(e => ({ ...e, status: 'PDF metne dönüştürülüyor...' }));
      extractPdfText(file, (p,total)=> setExtract(e=>({ ...e, current:p, total })))
        .then(text => setExtract({ text, current: extract.total || 0, total: extract.total || 0, status: 'PDF metne dönüştürüldü.' }))
        .catch(()=> setExtract(e=>({ ...e, status: 'PDF metne dönüştürme hatası.' })));
    } else {
      const reader = new FileReader();
      reader.onload = () => setExtract({ text: String(reader.result||''), current: 1, total: 1, status: 'Metin dosyası yüklendi.' });
      reader.readAsText(file);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  const handleAnalyze = async () => {
    setError('');
    if (!extract.text || extract.text.length < 50) { message.warning('Lütfen PDF/txt yükleyin (min 50 karakter).'); return; }
    setHasRequested(true);
    setLoading(true);
    try {
      const res = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: extract.text, role: role.trim() }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'İstek başarısız');
      const parsed = parseAnalysis(data.analysis || '');
      setProvider(String(data.provider || ''));
      setResult(parsed);
    } catch (e) {
      setError(String(e?.message || 'Bilinmeyen hata'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!loading && hasRequested && (result.summary || result.pros.length || result.cons.length || result.adds.length)) {
      // Sonuç eklendi; aşağıya kaydır
      setTimeout(() => { resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 200);
    }
  }, [loading, hasRequested, result]);

  const uploadProps = {
    name: 'file', multiple: false, maxCount: 1, accept: '.pdf,.txt,.text', showUploadList: true,
    beforeUpload: (f) => { setFile(f); return false; },
    onRemove: () => { setFile(null); setResult({ summary:'', pros:[], cons:[], adds:[] }); }
  };

  return (
    <ConfigProvider theme={{ algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm }}>
      <AntApp>
        <Layout style={{ minHeight: '100vh' }}>
          <Header style={{ background: 'transparent' }}>
            <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
              <Space>
                <ThunderboltOutlined />
                <Title level={4} style={{ margin: 0 }}>AI Resume Analyzer</Title>
              </Space>
              <Space>
                <BulbOutlined />
                <Switch checkedChildren="Dark" unCheckedChildren="Light" checked={isDark} onChange={setIsDark} />
              </Space>
            </Space>
          </Header>
          <Content style={{ padding: 0 }}>
            {!hasRequested ? (
              <div className="center-wrap">
                <Col xs={24} md={16} lg={10}>
                  <Card title={<Space><ThunderboltOutlined /><Text strong>AI Resume Analyzer</Text></Space>}>
                    <Space direction="vertical" size="large" style={{ width: '100%' }}>
                      <Text type="secondary">CV’nizi yükleyin, güçlü ve gelişime açık yönleri analiz edelim.</Text>
                      <Upload.Dragger {...uploadProps} style={{ padding: 12 }}>
                        <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                        <p className="ant-upload-text">Dosyayı sürükleyip bırakın veya tıklayın</p>
                        <p className="ant-upload-hint">.pdf veya .txt dosyaları desteklenir</p>
                      </Upload.Dragger>
                      <Input allowClear value={role} onChange={e=>setRole(e.target.value)} placeholder="Hedef Rol (opsiyonel) — örn: Frontend Developer" />
                      <Button type="primary" block icon={<ThunderboltOutlined />} loading={loading} onClick={handleAnalyze}>Analiz Et</Button>
                      {extract.status && (
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Text type="secondary">{extract.status}</Text>
                          {extract.total > 0 && <Progress percent={Math.round((extract.current/extract.total)*100)} />}
                        </Space>
                      )}
                    </Space>
                  </Card>
                </Col>
              </div>
            ) : (
              <div className="stack-wrap">
                {/* Yükleme kartı üstte kalsın */}
                <Row gutter={[16,16]}>
                  <Col xs={24} lg={12}>
                    <Card title="Yükleme" extra={<Text type="secondary">PDF veya .txt</Text>}>
                      <Space direction="vertical" size="large" style={{ width: '100%' }}>
                        <Upload.Dragger {...uploadProps} style={{ padding: 12 }}>
                          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                          <p className="ant-upload-text">Dosyayı sürükleyip bırakın veya tıklayın</p>
                          <p className="ant-upload-hint">.pdf veya .txt dosyaları desteklenir</p>
                        </Upload.Dragger>
                        <Input allowClear value={role} onChange={e=>setRole(e.target.value)} placeholder="Hedef Rol (opsiyonel) — örn: Frontend Developer" />
                        <Button type="primary" icon={<ThunderboltOutlined />} loading={loading} onClick={handleAnalyze}>Analiz Et</Button>
                        {extract.status && (
                          <Space direction="vertical" style={{ width: '100%' }}>
                            <Text type="secondary">{extract.status}</Text>
                            {extract.total > 0 && <Progress percent={Math.round((extract.current/extract.total)*100)} />}
                          </Space>
                        )}
                      </Space>
                    </Card>
                  </Col>
                  <Col xs={24} lg={12}>
                    <Card title="PDF Önizleme" extra={<FilePdfOutlined />}>
                      {previews.length ? (
                        <Row gutter={[8,8]}>
                          {previews.map((src, i) => (
                            <Col span={12} key={i}><img src={src} alt={`p${i+1}`} className="pdf-thumb"/></Col>
                          ))}
                        </Row>
                      ) : (
                        <Alert type="info" message="Önizleme için PDF yükleyin" showIcon />
                      )}
                    </Card>
                  </Col>
                </Row>

                {/* Yükleniyor bölümü */}
                {loading && (
                  <Card title="Analiz Hazırlanıyor" style={{ marginTop: 16 }}>
                    <Skeleton active paragraph={{ rows: 2 }} />
                    <Row gutter={[12,12]} style={{ marginTop: 12 }}>
                      <Col xs={24} md={8}><Skeleton active paragraph={{ rows: 5 }} /></Col>
                      <Col xs={24} md={8}><Skeleton active paragraph={{ rows: 5 }} /></Col>
                      <Col xs={24} md={8}><Skeleton active paragraph={{ rows: 5 }} /></Col>
                    </Row>
                  </Card>
                )}

                {/* Sonuç bölümü en altta */}
                {!loading && (result.summary || result.pros.length || result.cons.length || result.adds.length) && (
                  <div ref={resultRef} style={{ scrollMarginTop: 24 }}>
                    <Card title="Analiz Sonucu" style={{ marginTop: 16 }}>
                      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 12 }} />}
                      {provider === 'mock' && (
                        <Alert
                          type="warning"
                          showIcon
                          style={{ marginBottom: 12 }}
                          message="Şu anda herhangi bir dil modeli kullanmıyorsunuz."
                          description={<span>Gerçek bir modelle çalışmak için API anahtarı ekleme adımları için README’ye göz atın. <a href="/readme" target="_blank" rel="noopener noreferrer">README’yi aç</a></span>}
                        />
                      )}
                      <Card size="small" type="inner" title="Kısa Genel Değerlendirme" style={{ marginBottom: 12 }}>
                        <Text>{result.summary || '—'}</Text>
                      </Card>
                      <Row gutter={[12,12]}>
                        <Col xs={24} md={8}>
                          <SectionCard title="Güçlü Yönler" items={result.pros} color="green" icon={<CheckCircleTwoTone twoToneColor="#52c41a"/>} />
                        </Col>
                        <Col xs={24} md={8}>
                          <SectionCard title="Gelişmeye Açık Alanlar" items={result.cons} color="red" icon={<CloseCircleTwoTone twoToneColor="#ff4d4f"/>} />
                        </Col>
                        <Col xs={24} md={8}>
                          <SectionCard title="Eklenebilecek Yönler" items={result.adds} color="blue" icon={<PlusCircleTwoTone twoToneColor="#1677ff"/>} />
                        </Col>
                      </Row>
                    </Card>
                  </div>
                )}
              </div>
            )}
          </Content>
          <Footer style={{ textAlign: 'center' }}>
            <Text type="secondary">Tüm Hakları Saklıdır • Melih Divan • {new Date().getFullYear()}</Text>
          </Footer>
        </Layout>
      </AntApp>
    </ConfigProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<AppShell />);
