// language: JavaScript, file: worker.js, runtime: Cloudflare Workers (V8)
// Cloudflare Workers version — no Node modules, uses fetch + Request/Response

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // health check
        if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
            return json(200, {
                status: true,
                service: 'AutoFeedback Server',
                runtime: 'cloudflare-workers',
                telegram_configured: Boolean(env.BOT_TOKEN && env.CHAT_ID)
            });
        }

        // only POST / or /upload
        if (request.method !== 'POST' || (url.pathname !== '/' && url.pathname !== '/upload')) {
            return json(404, { status: false, error: 'Not found' });
        }

        if (!env.BOT_TOKEN || !env.CHAT_ID) {
            return json(500, { status: false, error: 'BOT_TOKEN or CHAT_ID is not configured' });
        }

        try {
            const contentType = request.headers.get('content-type') || '';
            let base64_image = '';
            let caption = '';

            if (contentType.includes('application/x-www-form-urlencoded')) {
                const text = await request.text();
                const params = new URLSearchParams(text);
                base64_image = params.get('base64_image') || '';
                caption = params.get('caption') || '';
            } else {
                base64_image = await request.text();
            }

            if (!base64_image) {
                return json(400, { status: false, error: 'base64_image is required' });
            }

            // sanitize base64
            let b64 = base64_image.trim();
            const comma = b64.indexOf(',');
            if (b64.startsWith('data:') && comma !== -1) b64 = b64.slice(comma + 1);
            b64 = b64.replace(/\s+/g, '').replace(/%2B/gi, '+').replace(/%2F/gi, '/').replace(/%3D/gi, '=');

            // decode base64 -> Uint8Array
            let imageBytes;
            try {
                const binary = atob(b64);
                imageBytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) imageBytes[i] = binary.charCodeAt(i);
            } catch (e) {
                return json(400, { status: false, error: 'Invalid base64 image' });
            }

            if (imageBytes.length === 0) {
                return json(400, { status: false, error: 'Decoded image is empty' });
            }
            if (imageBytes.length > 20 * 1024 * 1024) {
                return json(413, { status: false, error: 'Image is too large' });
            }

            // build multipart for Telegram
            const boundary = '----AutoFeedback' + Math.random().toString(16).slice(2);
            const parts = [];

            const addField = (name, value) => {
                parts.push(new TextEncoder().encode(
                    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
                ));
            };

            addField('chat_id', env.CHAT_ID);
            if (caption) addField('caption', caption);
            addField('parse_mode', 'HTML');

            parts.push(new TextEncoder().encode(
                `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="feedback.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`
            ));
            parts.push(imageBytes);
            parts.push(new TextEncoder().encode(`\r\n--${boundary}--\r\n`));

            // concat all parts
            let totalLen = 0;
            for (const p of parts) totalLen += p.length;
            const body = new Uint8Array(totalLen);
            let offset = 0;
            for (const p of parts) {
                body.set(p, offset);
                offset += p.length;
            }

            // send to Telegram
            const tgRes = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendPhoto`, {
                method: 'POST',
                headers: {
                    'Content-Type': `multipart/form-data; boundary=${boundary}`
                },
                body: body
            });

            const tgJson = await tgRes.json();
            if (!tgJson.ok) {
                return json(502, { status: false, error: tgJson.description || 'telegram_failed' });
            }

            return json(200, {
                status: true,
                telegram_message_id: tgJson.result && tgJson.result.message_id
            });

        } catch (err) {
            return json(500, { status: false, error: err.message || 'Server error' });
        }
    }
};

function json(code, data) {
    return new Response(JSON.stringify(data), {
        status: code,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
}
