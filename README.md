AI Resume Analyzer

### Proje Açıklaması

AI Resume Analyzer, özgeçmiş (PDF veya metin) içeriğini değerlendirir ve iş odaklı, eyleme dönük bir rapor üretir. Çıktı dört sabit başlıktan oluşur:

## AI Resume Analyzer

**Kısa Genel Değerlendirme: 2–4 cümlelik kısa özet.**

**Güçlü Yönler: Rol/alan ile ilişkili güçlü yetkinlikler.**

**Gelişmeye Açık Alanlar: İyileştirilmesi gereken başlıklar.**

**Eklenebilecek Yönler: Doğrudan eylem fiiliyle öneriler.**

### Kurulum

Repoyu klonlayın, bağımlılıkları kurun ve başlatın:

```
npm install
npm start
```

Ardından tarayıcıda şu adresi açın: http://localhost:8787

### Ortam Değişkenleri (.env)

Proje kökünde `.env.example` bulunur. Bunu `.env` olarak kopyalayın ve sağlayıcınızı seçin:

```
# Bir sağlayıcı seçin: openai | gemini | mock
PROVIDER=gemini

# OpenAI anahtarı (OpenAI kullanacaksanız zorunlu)
OPENAI_API_KEY=

# Gemini anahtarı (Gemini kullanacaksanız zorunlu)
GEMINI_API_KEY=
# (İsteğe bağlı) Model — önerilen varsayılan
GEMINI_MODEL=gemini-1.5-flash-latest

# (İsteğe bağlı) Sunucu portu
PORT=8787
```

- `PROVIDER=mock` ile anahtarsız kurallı (LLM’siz) analiz çalışır.
- `PROVIDER=openai` için `OPENAI_API_KEY` gerekir.
- `PROVIDER=gemini` için `GEMINI_API_KEY` gerekir; model boşsa önerilen varsayılan ve yedekleme zinciri kullanılır.

Öneri: Google AI Studio (Gemini Free Tier)
- Hızlı başlamak için Google AI Studio’nun ücretsiz katmanını kullanabilirsiniz.
- Adımlar:
  1) Google hesabınızla giriş yapın: https://aistudio.google.com/
  2) API Key oluşturun: https://aistudio.google.com/app/apikey
  3) Anahtarı `.env` dosyasındaki `GEMINI_API_KEY` alanına ekleyin ve `PROVIDER=gemini` ayarlayın.

### Kullanım

- PDF veya .txt dosyasını yükleyin (sürükle-bırak destekli).
- Hedef rolü (opsiyonel) girin.
- “Analiz Et” ile raporu üretin.

Not: PDF yalnızca metin çıkarmak için kullanılır; amaç CV analizi üretmektir.

### Özellikler

- Yapılandırılmış çıktı ve sıkı biçim kuralları (başlıklar sabit, her bölümde en az 6 madde)
- Tarih tutarlılığı kontrolü (gelecekte görünen tarih aralıklarını saptayıp uyarır)
- İçerik temizliği ve tutarlılık (HTML entity normalizasyonu; hobi/kişisel bilgiler dışarıda)
- Sağlayıcılar: OpenAI, Google Gemini; anahtarsız kullanım için Mock
- Profesyonel arayüz: React + Ant Design (açık/koyu tema)

### Bağımlılıklar

- Node.js (18+)
- React 18 (CDN UMD)
- Ant Design 5 (CDN UMD)
- pdfjs-dist (PDF metin çıkarımı)
- Express, CORS, dotenv

### Sağlayıcı Seçenekleri

- OpenAI: `.env` içine `OPENAI_API_KEY` girin, `PROVIDER=openai`
- Gemini (Google): `.env` içine `GEMINI_API_KEY` girin, `PROVIDER=gemini` (varsayılan model: `gemini-1.5-flash-latest`, değiştirilebilir: `GEMINI_MODEL`)
- Mock (anahtarsız): `PROVIDER=mock` — kurallı, LLM’siz analiz

### Varsayılan Sağlayıcı Mantığı

- `OPENAI_API_KEY` varsa: `openai`
- yoksa ve `GEMINI_API_KEY` varsa: `gemini`
- aksi halde: `mock`

### Destek

Sorunlar ve geliştirme talepleri için GitHub Issues bölümünü kullanın.

### İletişim

- [Melih Divan](https://www.linkedin.com/in/melihdivan/)
