// server.js
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// Native API Web Server Routing
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // Handle CORS preflight (OPTIONS) requests
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400'
        });
        res.end();
        return;
    }

    if (pathname === '/code') {
        const targetNumber = parsedUrl.query.phone ? parsedUrl.query.phone.replace(/[^0-9]/g, '') : '';
        
        // Standardized CORS Headers to allow Netlify access safely
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*', // Safe cross-origin access
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });

        if (!targetNumber) {
            res.end(JSON.stringify({ error: 'Missing phone parameter.' }));
            return;
        }

        try {
            const { default: makeWASocket, useMultiFileAuthState, Browsers } = await import('@itsliaaa/baileys');
            const tempSessionPath = path.join(__dirname, `session_temp_${targetNumber}`);
            
            // Clean any dead sessions to prevent write locks and force fresh pairing state
            if (fs.existsSync(tempSessionPath)) {
                fs.rmSync(tempSessionPath, { recursive: true, force: true });
            }
            fs.mkdirSync(tempSessionPath);

            const { state, saveCreds } = await useMultiFileAuthState(tempSessionPath);
            const sock = makeWASocket({
                auth: state,
                printQRInTerminal: false,
                logger: require('pino')({ level: 'silent' }),
                browser: Browsers.ubuntu('Chrome')
            });

            sock.ev.on('creds.update', saveCreds);

            // Dynamic Retry Handshake Polling (gives slow servers up to 15 seconds to connect)
            let code = null;
            let retries = 0;
            
            while (!code && retries < 10) {
                try {
                    await new Promise(resolve => setTimeout(resolve, 1500)); // Wait 1.5 seconds between retries
                    code = await sock.requestPairingCode(targetNumber, "INFINITY");
                } catch (err) {
                    retries++;
                }
            }

            if (code) {
                res.end(JSON.stringify({ code }));
            } else {
                res.end(JSON.stringify({ error: 'WhatsApp pairing handshake timed out. Please ensure your hosting panel is online and try again.' }));
            }

            // Listen for successful authentication state
            sock.ev.on('connection.update', async (update) => {
                const { connection } = update;
                if (connection === 'open') {
                    try {
                        const credsFilePath = path.join(tempSessionPath, 'creds.json');
                        if (fs.existsSync(credsFilePath)) {
                            const rawCreds = fs.readFileSync(credsFilePath, 'utf-8');
                            
                            // Base64 encode the creds object payload to form the Short Session ID
                            const base64SessionId = "Limitless~" + Buffer.from(rawCreds).toString('base64');
                            
                            // Send Session ID straight to the user's private WhatsApp chat
                            const selfJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                            await sock.sendMessage(selfJid, { 
                                text: `📦 *LIMITLESS SESSION MANIFESTED* 📦\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                                      `Here is your standard short Session ID. Copy it to your deployment config:\n\n` +
                                      `\`\`\`${base64SessionId}\`\`\`\n\n` +
                                      `⚠️ *Notice:* Keep this credentials payload private. Do not share it with anyone.`
                            });

                            // Graceful cleanup
                            sock.logout();
                            setTimeout(() => {
                                fs.rmSync(tempSessionPath, { recursive: true, force: true });
                            }, 5000);
                        }
                    } catch (e) {
                        console.error("Session Packager Error:", e.message);
                    }
                }
            });

        } catch (serverErr) {
            res.end(JSON.stringify({ error: 'Server allocation failed.' }));
        }
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
});

server.listen(PORT, () => {
    console.log(`🌐 [PAIRING-SITE] Server listening at http://localhost:${PORT}`);
});