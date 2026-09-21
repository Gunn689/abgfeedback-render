// language: JavaScript, file: index.js, runtime: Node >=18, deps: none
// Render: bind to process.env.PORT, listen on 0.0.0.0
const http = require('http');
const https = require('https');

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const CHAT_ID = process.env.CHAT_ID || '';
const MAX_BODY = Number(process.env.MAX_BODY_BYTES || 30 * 1024 * 1024);

function sendJson(res, code, data) {
    const body = JSON.stringify(data);
    res.writeHead(code, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body)
    });
    res.end(body);
}

function parseBody(buf, contentType) {
    const text = buf.toString('utf8');
    if (contentType && contentType.includes('application/x-www-form-urlencoded')) {
        const p = new URLSearchParams(text);
        return {
            base64_image: p.get('base64_image') || '',
            caption: p.get('caption') || ''
        };
    }
    return { base64_image: text, caption: '' };
}

function sendTelegramPhoto(image, caption) {
    return new Promise((resolve, reject) => {
        if (!BOT_TOKEN || !CHAT_ID) {
            return reject(new Error('BOT_TOKEN or CHAT_ID is not configured'));
        }
        const boundary = '----AutoFeedback' + Math.random().toString(16).slice(2);
        const chunks = [];
        const field = (name, value) => chunks.push(Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
        ));
        field('chat_id', CHAT_ID);
        if (caption) field('caption', caption);
        field('parse_mode', 'HTML');
        chunks.push(Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="feedback.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`
        ));
        chunks.push(image);
        chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
        const form = Buffer.concat(chunks);
        const req = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${BOT_TOKEN}/sendPhoto`,
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': form.length
            },
            timeout: 60000
        }, response => {
            let data = '';
            response.setEncoding('utf8');
            response.on('data', c => data += c);
            response.on('end', () => {
                let result;
                try { result = JSON.parse(data); }
                catch { result = { ok: false, description: data.slice(0, 500) }; }
                if (response.statusCode >= 200 && response.statusCode < 300 && result.ok) resolve(result);
                else reject(new Error(result.description || `Telegram HTTP ${response.statusCode}`));
            });
        });
        req.on('timeout', () => req.destroy(new Error('Telegram request timeout')));
        req.on('error', reject);
        req.end(form);
    });
}

function decodeImage(raw) {
    let b64 = (raw || '').trim();
    const comma = b64.indexOf(',');
    if (b64.startsWith('data:') && comma !== -1) b64 = b64.slice(comma + 1);
    b64 = b64.replace(/\s+/g, '').replace(/%2B/gi, '+').replace(/%2F/gi, '/').replace(/%3D/gi, '=');
    return Buffer.from(b64, 'base64');
}

const server = http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
        return sendJson(res, 200, {
            status: true,
            service: 'AutoFeedback Server',
            telegram_configured: Boolean(BOT_TOKEN && CHAT_ID)
        });
    }
    if (req.method !== 'POST' || (req.url !== '/' && req.url !== '/upload')) {
        return sendJson(res, 404, { status: false, error: 'Not found' });
    }
    let size = 0;
    const chunks = [];
    let tooLarge = false;
    req.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_BODY) { tooLarge = true; return; }
        chunks.push(chunk);
    });
    req.on('end', async () => {
        if (tooLarge) return sendJson(res, 413, { status: false, error: 'Request too large' });
        try {
            const { base64_image, caption } = parseBody(
                Buffer.concat(chunks),
                req.headers['content-type']
            );
            if (!base64_image) {
                return sendJson(res, 400, { status: false, error: 'base64_image is required' });
            }
            const image = decodeImage(base64_image);
            if (!image.length) {
                return sendJson(res, 400, { status: false, error: 'Decoded image is empty' });
            }
            if (image.length > 20 * 1024 * 1024) {
                return sendJson(res, 413, { status: false, error: 'Image is too large' });
            }
            const result = await sendTelegramPhoto(image, caption);
            return sendJson(res, 200, {
                status: true,
                telegram_message_id: result.result && result.result.message_id
            });
        } catch (e) {
            console.error('[AutoFeedback]', e.message);
            return sendJson(res, 500, { status: false, error: e.message || 'Server error' });
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`AutoFeedback server listening on ${PORT}`);
    console.log(`Telegram configured: ${Boolean(BOT_TOKEN && CHAT_ID)}`);
});
