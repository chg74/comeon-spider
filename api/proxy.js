export default async function handler(req, res) {
  // CORS headers عشان المتصفح يقبل الاستجابة
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Missing url parameter');

  try {
    // هيدرز بنقلد بيها متصفح حقيقي عشان بعض السيرفرات تسمح
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': targetUrl,
    };

    // مهم جداً للفيديو: تمرير Range header
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const response = await fetch(targetUrl, { headers });

    if (!response.ok && response.status !== 206) {
      throw new Error('Upstream: ' + response.status);
    }

    const contentType = response.headers.get('content-type') || '';
    const isM3u8 = contentType.includes('mpegurl') || /\.m3u8(\?|#|$)/i.test(targetUrl);

    // ============ لو ملف m3u8 (قائمة تشغيل) ============
    if (isM3u8) {
      let playlist = await response.text();
      const urlObj = new URL(targetUrl);
      const baseUrl = urlObj.origin + urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1);

      playlist = playlist.split('\n').map(function(line) {
        const trimmed = line.trim();
        if (!trimmed) return line;

        // معالجة التاجات اللي فيها URI= (زي #EXT-X-KEY و #EXT-X-MAP للتشفير)
        if (trimmed.startsWith('#')) {
          return line.replace(/URI="([^"]+)"/g, function(m, uri) {
            let fullUrl = uri;
            if (!/^https?:\/\//i.test(uri)) {
              fullUrl = new URL(uri, baseUrl).href;
            }
            return 'URI="/api/proxy?url=' + encodeURIComponent(fullUrl) + '"';
          });
        }

        // سطر عادي فيه رابط (segment .ts أو m3u8 فرعي)
        let fullUrl = trimmed;
        if (!/^https?:\/\//i.test(trimmed)) {
          fullUrl = new URL(trimmed, baseUrl).href;
        }
        return '/api/proxy?url=' + encodeURIComponent(fullUrl);
      }).join('\n');

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache');
      return res.status(200).send(playlist);
    }

    // ============ للملفات الفعلية (.ts, .mp4, .aac) ============
    const buffer = await response.arrayBuffer();
    res.setHeader('Content-Type', contentType || 'video/mp2t');
    res.setHeader('Content-Length', buffer.byteLength);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=30');
    return res.status(200).send(Buffer.from(buffer));

  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).send('Proxy error: ' + error.message);
  }
}
