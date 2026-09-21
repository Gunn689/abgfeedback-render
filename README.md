# abgfeedback-render

AutoFeedback server — terima base64 image dari PUBG Lua, forward ke Telegram.

## Deploy

1. New Web Service di Render
2. Connect repo ini
3. Runtime: Node
4. Build: `npm install`
5. Start: `node index.js`
6. Instance: Free
7. Env vars:
   - `BOT_TOKEN` = token bot Telegram
   - `CHAT_ID` = id grup Telegram

## Health check

GET `/` atau `/health` → `{"status":true,...}`

## Endpoint

POST `/` atau `/upload`
Body: `application/x-www-form-urlencoded`
- `base64_image` = gambar base64
- `caption` = caption Telegram (HTML)
