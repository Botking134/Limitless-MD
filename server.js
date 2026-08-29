// server.js - Express Dashboard & API for Limitless WhatsApp Bot
const express = require('express');
const path = require('path');
const config = require('./config');
const { getVar, setVar, DYNAMIC_KEYS } = require('./vars');
const { loadState, saveState } = require('./stateManager');
const { getPairingStatus, requestPairingCode, restartBot, clearAuthSession, getActiveSocket } = require('./pair');
const commands = require('./commands');

function createServer() {
    const app = express();
    const PORT = 3000;

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // ─── API ROUTES ───────────────────────────────────────────────

    // 1. Health Check
    app.get('/api/health', (req, res) => {
        res.json({
            status: 'ok',
            botName: config.botName,
            version: '1.0.0',
            uptime: Math.floor(process.uptime()),
            timestamp: new Date().toISOString()
        });
    });

    // 2. Bot & System Status
    app.get('/api/status', (req, res) => {
        const pairing = getPairingStatus();
        const totalCommands = Object.keys(commands).filter(k => k !== 'reload').length;

        res.json({
            botName: config.botName,
            ownerName: config.ownerName,
            ownerNumber: config.ownerNumber,
            prefix: config.prefix,
            isPublic: config.isPublic,
            autoReact: config.autoReact,
            antipm: config.antipm,
            antigcstatus: config.antigcstatus,
            botJid: config.botJid || null,
            ownerJid: config.ownerJid || null,
            totalCommands,
            sudosCount: Array.isArray(config.sudos) ? config.sudos.length : 0,
            secondaryOwnersCount: Array.isArray(config.secondaryOwners) ? config.secondaryOwners.length : 0,
            bannedCount: Array.isArray(config.banned) ? config.banned.length : 0,
            chatbots: {
                gojoChats: config.gojoChats?.length || 0,
                aizenChats: config.chatbotChats?.length || 0,
                lizzyChats: config.lizzyChats?.length || 0,
                fridayChats: config.fridayChats?.length || 0
            },
            pairing: {
                status: pairing.status,
                registered: pairing.registered,
                phoneNumber: pairing.phoneNumber,
                errorMessage: pairing.errorMessage,
                hasQr: !!pairing.qrImage,
                pairingCode: pairing.pairingCode,
                user: pairing.user
            },
            memory: process.memoryUsage(),
            uptime: Math.floor(process.uptime())
        });
    });

    // 3. Pairing Status & Details
    app.get('/api/pairing', (req, res) => {
        res.json(getPairingStatus());
    });

    // 4. Request WhatsApp Pairing Code
    app.post('/api/pair/request-code', async (req, res) => {
        const { phoneNumber } = req.body;
        if (!phoneNumber) {
            return res.status(400).json({ success: false, error: 'Phone number is required' });
        }
        try {
            const code = await requestPairingCode(phoneNumber);
            res.json({ success: true, pairingCode: code, message: `Pairing code generated for ${phoneNumber}` });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // 5. Restart Bot Engine
    app.post('/api/pair/restart', async (req, res) => {
        try {
            restartBot().catch(e => console.error("Restart error:", e));
            res.json({ success: true, message: 'Bot restart initiated' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // 6. Clear Session Auth (Logout & Re-pair)
    app.post('/api/session/clear', async (req, res) => {
        try {
            await clearAuthSession();
            setTimeout(() => {
                restartBot().catch(e => console.error("Post-clear restart error:", e));
            }, 1000);
            res.json({ success: true, message: 'Auth session cleared. Ready for fresh pairing.' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // 7. Get Config Variables
    app.get('/api/config', (req, res) => {
        const dynamicVars = {};
        for (const key of DYNAMIC_KEYS) {
            dynamicVars[key] = config[key];
        }
        res.json({
            static: {
                botName: config.botName,
                ownerName: config.ownerName,
                ownerNumber: config.ownerNumber,
                ownerJid: config.ownerJid,
                botJid: config.botJid
            },
            dynamic: dynamicVars,
            keys: DYNAMIC_KEYS
        });
    });

    // 8. Update Config Variable
    app.post('/api/config', (req, res) => {
        const { key, value } = req.body;
        if (!key) {
            return res.status(400).json({ success: false, error: 'Missing key parameter' });
        }
        try {
            const ok = setVar(key, value);
            if (ok) {
                res.json({ success: true, key, value, message: `Updated ${key} successfully.` });
            } else {
                res.status(400).json({ success: false, error: `Invalid dynamic key '${key}'` });
            }
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // 9. Commands List & Metadata
    app.get('/api/commands', (req, res) => {
        const list = [];
        for (const key in commands) {
            if (key === 'reload') continue;
            const item = commands[key];
            list.push({
                trigger: key,
                description: item.metadata?.description || 'General command',
                category: item.metadata?.category || 'general',
                usage: item.metadata?.usage || key,
                permission: item.metadata?.permission || 'public',
                isPrefixless: item.metadata?.isPrefixless || false
            });
        }
        res.json({
            count: list.length,
            prefix: config.prefix,
            commands: list
        });
    });

    // 10. System Logs
    app.get('/api/logs', (req, res) => {
        res.json({
            logs: global.recentLogs || []
        });
    });

    // ─── DASHBOARD HTML PAGE ──────────────────────────────────────
    app.get('/', (req, res) => {
        res.send(getDashboardHtml());
    });

    // Start Express listener
    const server = app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n========================================`);
        console.log(`🌐 [WEB CONSOLE] Limitless Bot UI running on http://0.0.0.0:${PORT}`);
        console.log(`========================================\n`);
    });

    return server;
}

function getDashboardHtml() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Limitless WhatsApp Bot | Control Center</title>
    <meta name="description" content="Control center and live WhatsApp pairing console for Limitless WhatsApp Bot">
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
    <style>
        body {
            font-family: 'Plus Jakarta Sans', sans-serif;
            background-color: #0b0f19;
            color: #f1f5f9;
        }
        .mono {
            font-family: 'JetBrains Mono', monospace;
        }
        .custom-scrollbar::-webkit-scrollbar {
            width: 6px;
            height: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
            background: #111827;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
            background: #374151;
            border-radius: 4px;
        }
    </style>
</head>
<body class="min-h-screen flex flex-col antialiased selection:bg-cyan-500 selection:text-white">

    <!-- Top Navigation -->
    <header class="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-50">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <div class="flex items-center space-x-3">
                <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
                    <span class="text-xl font-extrabold text-white">♾️</span>
                </div>
                <div>
                    <h1 class="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                        <span id="headerBotName">Limitless</span>
                        <span class="text-xs px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-medium">MD v1.0</span>
                    </h1>
                    <p class="text-xs text-slate-400">WhatsApp Multi-Device AI Engine</p>
                </div>
            </div>

            <!-- Real-time Status Indicator -->
            <div class="flex items-center space-x-3">
                <div id="statusBadge" class="flex items-center space-x-2 px-3 py-1.5 rounded-full bg-slate-800 text-xs font-semibold border border-slate-700">
                    <span class="w-2.5 h-2.5 rounded-full bg-yellow-400 animate-pulse" id="statusDot"></span>
                    <span id="statusText" class="text-slate-300">Connecting...</span>
                </div>
                <button onclick="refreshData()" class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition text-xs border border-slate-700 flex items-center gap-1.5" title="Refresh state">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                    <span class="hidden sm:inline">Refresh</span>
                </button>
            </div>
        </div>
    </header>

    <!-- Main Container -->
    <main class="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 space-y-8">

        <!-- Top Metrics Cards -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div class="p-4 rounded-xl bg-slate-900/50 border border-slate-800/80">
                <span class="text-xs text-slate-400 font-medium uppercase tracking-wider">Commands Loaded</span>
                <p class="text-2xl font-bold text-white mt-1" id="metricCommands">-</p>
                <span class="text-xs text-cyan-400 font-mono mt-1 block" id="metricPrefix">Prefix: /</span>
            </div>
            <div class="p-4 rounded-xl bg-slate-900/50 border border-slate-800/80">
                <span class="text-xs text-slate-400 font-medium uppercase tracking-wider">Primary Owner</span>
                <p class="text-lg font-bold text-white mt-1 truncate" id="metricOwner">-</p>
                <span class="text-xs text-slate-400 font-mono mt-1 block truncate" id="metricNumber">-</span>
            </div>
            <div class="p-4 rounded-xl bg-slate-900/50 border border-slate-800/80">
                <span class="text-xs text-slate-400 font-medium uppercase tracking-wider">Access Mode</span>
                <p class="text-lg font-bold text-white mt-1" id="metricMode">-</p>
                <span class="text-xs text-emerald-400 font-mono mt-1 block" id="metricAutoReact">Auto-React: Off</span>
            </div>
            <div class="p-4 rounded-xl bg-slate-900/50 border border-slate-800/80">
                <span class="text-xs text-slate-400 font-medium uppercase tracking-wider">Server Uptime</span>
                <p class="text-lg font-bold text-white mt-1 font-mono" id="metricUptime">0s</p>
                <span class="text-xs text-slate-400 font-mono mt-1 block" id="metricMemory">-</span>
            </div>
        </div>

        <!-- WhatsApp Pairing Center -->
        <section class="rounded-2xl bg-gradient-to-b from-slate-900 to-slate-900/80 border border-slate-800 p-6 shadow-xl relative overflow-hidden">
            <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-800/80">
                <div>
                    <h2 class="text-xl font-bold text-white flex items-center gap-2">
                        <span>📲 WhatsApp Authentication & Pairing</span>
                    </h2>
                    <p class="text-sm text-slate-400 mt-1">Connect your WhatsApp account using a pairing code or scan the live QR code below.</p>
                </div>
                <div class="flex items-center gap-2">
                    <button onclick="clearSession()" class="px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs font-semibold transition flex items-center gap-1.5">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        Reset / Unlink Session
                    </button>
                    <button onclick="restartSocket()" class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold transition flex items-center gap-1.5">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                        Restart Engine
                    </button>
                </div>
            </div>

            <!-- Connected View -->
            <div id="viewConnected" class="hidden py-8 text-center space-y-4">
                <div class="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto text-3xl">
                    ✓
                </div>
                <div>
                    <h3 class="text-lg font-bold text-white">WhatsApp Bot is Connected and Online</h3>
                    <p class="text-sm text-slate-400 mt-1" id="connectedInfo">Device ID: Connected</p>
                </div>
                <div class="flex justify-center gap-3">
                    <span class="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-medium border border-emerald-500/30">Listening for messages & commands</span>
                </div>
            </div>

            <!-- Unconnected Pairing Options -->
            <div id="viewPairing" class="grid grid-cols-1 lg:grid-cols-12 gap-8 pt-6">
                <!-- Method 1: Pairing Code -->
                <div class="lg:col-span-7 space-y-4">
                    <div class="flex items-center space-x-2">
                        <span class="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 text-xs font-bold flex items-center justify-center">1</span>
                        <h3 class="text-base font-bold text-white">Pair with Phone Number (Recommended)</h3>
                    </div>
                    <p class="text-xs text-slate-400">Enter your full phone number with country code (e.g. <code class="text-cyan-300">2347059092107</code>). You will receive an 8-character pairing code to link on WhatsApp.</p>
                    
                    <form onsubmit="requestCode(event)" class="space-y-3">
                        <div class="flex gap-2">
                            <input type="text" id="phoneInput" placeholder="e.g. 2347059092107" required class="flex-1 px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono text-sm">
                            <button type="submit" id="btnRequestCode" class="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold text-sm shadow-md shadow-cyan-500/20 transition whitespace-nowrap">
                                Get Code
                            </button>
                        </div>
                    </form>

                    <!-- Pairing Code Display Box -->
                    <div id="pairingCodeBox" class="hidden p-4 rounded-xl bg-slate-950 border border-cyan-500/30 space-y-3">
                        <div class="flex items-center justify-between">
                            <span class="text-xs text-slate-400">Your Pairing Code:</span>
                            <button onclick="copyPairingCode()" class="text-xs text-cyan-400 hover:text-cyan-300 font-medium">Copy Code</button>
                        </div>
                        <div class="flex items-center justify-center py-3 bg-slate-900 rounded-lg border border-slate-800">
                            <span id="pairingCodeDisplay" class="text-2xl sm:text-3xl font-extrabold font-mono tracking-widest text-cyan-400 selection:bg-cyan-500">----</span>
                        </div>
                        <ol class="text-xs text-slate-400 space-y-1 list-decimal list-inside">
                            <li>Open <strong class="text-slate-200">WhatsApp</strong> on your phone.</li>
                            <li>Tap <strong class="text-slate-200">Settings</strong> (or 3 dots) &gt; <strong class="text-slate-200">Linked Devices</strong>.</li>
                            <li>Tap <strong class="text-slate-200">Link a Device</strong> &gt; <strong class="text-slate-200">Link with phone number instead</strong>.</li>
                            <li>Enter the code above.</li>
                        </ol>
                    </div>
                </div>

                <!-- Method 2: QR Code -->
                <div class="lg:col-span-5 flex flex-col items-center justify-center p-6 bg-slate-950/70 rounded-xl border border-slate-800 text-center space-y-3">
                    <div class="flex items-center space-x-2">
                        <span class="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 text-xs font-bold flex items-center justify-center">2</span>
                        <h3 class="text-sm font-bold text-white">Or Scan QR Code</h3>
                    </div>
                    <div class="w-48 h-48 bg-white rounded-xl p-2 flex items-center justify-center shadow-md relative overflow-hidden" id="qrContainer">
                        <img id="qrImage" src="" alt="WhatsApp QR Code" class="w-full h-full object-contain hidden">
                        <div id="qrPlaceholder" class="text-xs text-slate-400 flex flex-col items-center">
                            <svg class="w-6 h-6 animate-spin text-slate-500 mb-2" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg>
                            <span>Generating QR...</span>
                        </div>
                    </div>
                    <p class="text-xs text-slate-400">Open WhatsApp &gt; Linked Devices &gt; Link a Device to scan.</p>
                </div>
            </div>
        </section>

        <!-- Dynamic Settings & Control Panel -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <!-- Left: Settings Form -->
            <div class="lg:col-span-6 rounded-2xl bg-slate-900/70 border border-slate-800 p-6 space-y-6">
                <div>
                    <h3 class="text-base font-bold text-white flex items-center gap-2">
                        ⚙️ Bot Configuration & Behavior
                    </h3>
                    <p class="text-xs text-slate-400 mt-1">Changes are saved dynamically to vars.json and apply immediately.</p>
                </div>

                <div class="space-y-4">
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-xs font-medium text-slate-300 mb-1.5">Command Prefix</label>
                            <input type="text" id="cfgPrefix" class="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm font-mono focus:border-cyan-500 focus:outline-none" placeholder="/">
                        </div>
                        <div>
                            <label class="block text-xs font-medium text-slate-300 mb-1.5">Bot Display Name</label>
                            <input type="text" id="cfgBotName" class="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm focus:border-cyan-500 focus:outline-none" placeholder="Limitless">
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-xs font-medium text-slate-300 mb-1.5">Public Mode</label>
                            <select id="cfgIsPublic" class="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm focus:border-cyan-500 focus:outline-none">
                                <option value="false">Off (Owner & Sudos only)</option>
                                <option value="true">On (Everyone can use)</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-xs font-medium text-slate-300 mb-1.5">Auto-React</label>
                            <select id="cfgAutoReact" class="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm focus:border-cyan-500 focus:outline-none">
                                <option value="off">Off</option>
                                <option value="cmd">React to commands</option>
                                <option value="all">React to all messages</option>
                            </select>
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-xs font-medium text-slate-300 mb-1.5">Anti-PM (Direct Message Protection)</label>
                            <select id="cfgAntipm" class="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm focus:border-cyan-500 focus:outline-none">
                                <option value="off">Off</option>
                                <option value="on">On</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-xs font-medium text-slate-300 mb-1.5">Sticker Author Name</label>
                            <input type="text" id="cfgAuthor" class="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm focus:border-cyan-500 focus:outline-none" placeholder="Infinity">
                        </div>
                    </div>

                    <button onclick="saveSettings()" class="w-full py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-sm shadow-md transition">
                        Save Configuration
                    </button>
                </div>
            </div>

            <!-- Right: AI Chatbots & Modules Status -->
            <div class="lg:col-span-6 rounded-2xl bg-slate-900/70 border border-slate-800 p-6 space-y-6">
                <div>
                    <h3 class="text-base font-bold text-white flex items-center gap-2">
                        🤖 AI Persona Modules
                    </h3>
                    <p class="text-xs text-slate-400 mt-1">Chatbot personas available in group chats and direct messages.</p>
                </div>

                <div class="space-y-3">
                    <div class="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                        <div class="flex items-center space-x-3">
                            <span class="text-2xl">👁️</span>
                            <div>
                                <h4 class="text-sm font-bold text-white">Satoru Gojo</h4>
                                <p class="text-xs text-slate-400">Playful, arrogant strongest sorcerer (Groq Llama 3.3)</p>
                            </div>
                        </div>
                        <span class="text-xs px-2.5 py-1 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-mono">.gojo rise/sleep</span>
                    </div>

                    <div class="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                        <div class="flex items-center space-x-3">
                            <span class="text-2xl">🔮</span>
                            <div>
                                <h4 class="text-sm font-bold text-white">Sōsuke Aizen</h4>
                                <p class="text-xs text-slate-400">Intellectual mastermind with full command knowledge</p>
                            </div>
                        </div>
                        <span class="text-xs px-2.5 py-1 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 font-mono">.aizen unseal/seal</span>
                    </div>

                    <div class="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                        <div class="flex items-center space-x-3">
                            <span class="text-2xl">🖤</span>
                            <div>
                                <h4 class="text-sm font-bold text-white">Lizzy</h4>
                                <p class="text-xs text-slate-400">Devoted Albedo-inspired assistant</p>
                            </div>
                        </div>
                        <span class="text-xs px-2.5 py-1 rounded-full bg-pink-500/10 text-pink-400 border border-pink-500/20 font-mono">.lizzy wake/sleep</span>
                    </div>

                    <div class="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                        <div class="flex items-center space-x-3">
                            <span class="text-2xl">📶</span>
                            <div>
                                <h4 class="text-sm font-bold text-white">F.R.I.D.A.Y.</h4>
                                <p class="text-xs text-slate-400">High-tech Stark Industries analytical interface</p>
                            </div>
                        </div>
                        <span class="text-xs px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono">.friday boot/shutdown</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- Commands Explorer -->
        <section class="rounded-2xl bg-slate-900/70 border border-slate-800 p-6 space-y-4">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h3 class="text-base font-bold text-white flex items-center gap-2">
                        📜 Command Registry & Plugins (<span id="cmdCountLabel">0</span>)
                    </h3>
                    <p class="text-xs text-slate-400 mt-0.5">Browse all loaded bot triggers across all modular plugins.</p>
                </div>
                <div class="flex gap-2">
                    <input type="text" id="searchCmd" oninput="filterCommands()" placeholder="Search commands..." class="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-cyan-500">
                </div>
            </div>

            <div class="overflow-x-auto">
                <div class="max-h-80 overflow-y-auto custom-scrollbar rounded-xl border border-slate-800 bg-slate-950">
                    <table class="w-full text-left border-collapse text-xs">
                        <thead class="bg-slate-900 text-slate-400 sticky top-0 border-b border-slate-800">
                            <tr>
                                <th class="p-3 font-semibold">Command</th>
                                <th class="p-3 font-semibold">Category</th>
                                <th class="p-3 font-semibold">Description</th>
                                <th class="p-3 font-semibold">Permission</th>
                            </tr>
                        </thead>
                        <tbody id="commandsTableBody" class="divide-y divide-slate-900 text-slate-300">
                            <tr>
                                <td colspan="4" class="p-4 text-center text-slate-500">Loading commands...</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </section>

        <!-- System Logs Console -->
        <section class="rounded-2xl bg-slate-900/70 border border-slate-800 p-6 space-y-3">
            <div class="flex items-center justify-between">
                <div class="flex items-center space-x-2">
                    <span class="w-2.5 h-2.5 rounded-full bg-cyan-400"></span>
                    <h3 class="text-sm font-bold text-white font-mono">LIVE SYSTEM LOGS</h3>
                </div>
                <button onclick="fetchLogs()" class="text-xs text-slate-400 hover:text-cyan-400 transition font-mono">Refresh Logs</button>
            </div>
            <div id="logsConsole" class="h-48 overflow-y-auto custom-scrollbar p-3.5 bg-slate-950 rounded-xl border border-slate-800 font-mono text-xs text-slate-300 space-y-1">
                <p class="text-slate-500">Listening for console output...</p>
            </div>
        </section>

    </main>

    <!-- Footer -->
    <footer class="border-t border-slate-800 py-6 text-center text-xs text-slate-500">
        <p>Limitless WhatsApp Bot &copy; 2026. Powered by Baileys &amp; Google GenAI.</p>
    </footer>

    <!-- Frontend Script -->
    <script>
        let allCommands = [];

        async function fetchStatus() {
            try {
                const res = await fetch('/api/status');
                const data = await res.json();

                document.getElementById('headerBotName').innerText = data.botName || 'Limitless';
                document.getElementById('metricCommands').innerText = data.totalCommands || 0;
                document.getElementById('metricPrefix').innerText = 'Prefix: ' + (data.prefix || '(prefixless)');
                document.getElementById('metricOwner').innerText = data.ownerName || 'Infinity';
                document.getElementById('metricNumber').innerText = data.ownerNumber ? '+' + data.ownerNumber : '-';
                document.getElementById('metricMode').innerText = data.isPublic ? 'Public 🌐' : 'Private 🔒';
                document.getElementById('metricAutoReact').innerText = 'Auto-React: ' + (data.autoReact || 'off');
                document.getElementById('metricUptime').innerText = formatUptime(data.uptime || 0);

                if (data.memory) {
                    const mb = Math.round(data.memory.rss / (1024 * 1024));
                    document.getElementById('metricMemory').innerText = mb + ' MB RSS';
                }

                const statusDot = document.getElementById('statusDot');
                const statusText = document.getElementById('statusText');
                const viewConnected = document.getElementById('viewConnected');
                const viewPairing = document.getElementById('viewPairing');

                if (data.pairing.status === 'connected') {
                    statusDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400';
                    statusText.innerText = 'Connected';
                    statusText.className = 'text-emerald-400';
                    viewConnected.classList.remove('hidden');
                    viewPairing.classList.add('hidden');
                    if (data.pairing.user) {
                        document.getElementById('connectedInfo').innerText = 'Phone ID: ' + (data.pairing.user.id || 'Connected');
                    }
                } else if (data.pairing.status === 'qr') {
                    statusDot.className = 'w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse';
                    statusText.innerText = 'Ready for QR Scan';
                    statusText.className = 'text-cyan-400';
                    viewConnected.classList.add('hidden');
                    viewPairing.classList.remove('hidden');
                } else if (data.pairing.status === 'pairing_code_ready') {
                    statusDot.className = 'w-2.5 h-2.5 rounded-full bg-purple-400 animate-pulse';
                    statusText.innerText = 'Pairing Code Active';
                    statusText.className = 'text-purple-400';
                    viewConnected.classList.add('hidden');
                    viewPairing.classList.remove('hidden');
                } else {
                    statusDot.className = 'w-2.5 h-2.5 rounded-full bg-yellow-400 animate-pulse';
                    statusText.innerText = data.pairing.status || 'Standby';
                    statusText.className = 'text-yellow-400';
                    viewConnected.classList.add('hidden');
                    viewPairing.classList.remove('hidden');
                }

            } catch (e) {
                console.error("Status fetch error:", e);
            }
        }

        async function fetchPairing() {
            try {
                const res = await fetch('/api/pairing');
                const data = await res.json();

                const qrImage = document.getElementById('qrImage');
                const qrPlaceholder = document.getElementById('qrPlaceholder');

                if (data.qrImage) {
                    qrImage.src = data.qrImage;
                    qrImage.classList.remove('hidden');
                    qrPlaceholder.classList.add('hidden');
                } else if (data.status === 'connected') {
                    qrImage.classList.add('hidden');
                    qrPlaceholder.innerHTML = '<span class="text-emerald-400 font-semibold">✓ Linked</span>';
                    qrPlaceholder.classList.remove('hidden');
                } else {
                    qrImage.classList.add('hidden');
                    qrPlaceholder.innerHTML = '<span class="text-slate-400 text-xs">Waiting for QR...</span>';
                    qrPlaceholder.classList.remove('hidden');
                }

                const pairingCodeBox = document.getElementById('pairingCodeBox');
                const pairingCodeDisplay = document.getElementById('pairingCodeDisplay');
                if (data.pairingCode) {
                    pairingCodeDisplay.innerText = data.pairingCode;
                    pairingCodeBox.classList.remove('hidden');
                }
            } catch (e) {
                console.error("Pairing fetch error:", e);
            }
        }

        async function requestCode(e) {
            e.preventDefault();
            const phone = document.getElementById('phoneInput').value;
            const btn = document.getElementById('btnRequestCode');
            btn.disabled = true;
            btn.innerText = 'Generating...';

            try {
                const res = await fetch('/api/pair/request-code', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phoneNumber: phone })
                });
                const result = await res.json();
                if (result.success) {
                    document.getElementById('pairingCodeDisplay').innerText = result.pairingCode;
                    document.getElementById('pairingCodeBox').classList.remove('hidden');
                    alert('Pairing code generated: ' + result.pairingCode);
                } else {
                    alert('Error: ' + (result.error || 'Failed to generate pairing code'));
                }
            } catch (err) {
                alert('Request error: ' + err.message);
            } finally {
                btn.disabled = false;
                btn.innerText = 'Get Code';
                fetchPairing();
            }
        }

        function copyPairingCode() {
            const code = document.getElementById('pairingCodeDisplay').innerText;
            if (code && code !== '----') {
                navigator.clipboard.writeText(code);
                alert('Copied pairing code to clipboard: ' + code);
            }
        }

        async function clearSession() {
            if (!confirm('Are you sure you want to unlink and reset the WhatsApp session?')) return;
            try {
                const res = await fetch('/api/session/clear', { method: 'POST' });
                const data = await res.json();
                alert(data.message || 'Session reset');
                refreshData();
            } catch (e) {
                alert('Error resetting session: ' + e.message);
            }
        }

        async function restartSocket() {
            try {
                const res = await fetch('/api/pair/restart', { method: 'POST' });
                const data = await res.json();
                alert(data.message || 'Restart initiated');
                refreshData();
            } catch (e) {
                alert('Restart failed: ' + e.message);
            }
        }

        async function fetchConfig() {
            try {
                const res = await fetch('/api/config');
                const data = await res.json();
                if (data.dynamic) {
                    document.getElementById('cfgPrefix').value = data.dynamic.prefix || '';
                    document.getElementById('cfgBotName').value = data.static.botName || '';
                    document.getElementById('cfgIsPublic').value = String(data.dynamic.isPublic);
                    document.getElementById('cfgAutoReact').value = data.dynamic.autoReact || 'off';
                    document.getElementById('cfgAntipm').value = data.dynamic.antipm || 'off';
                    document.getElementById('cfgAuthor').value = data.dynamic.author || '';
                }
            } catch (e) {
                console.error("Config load error:", e);
            }
        }

        async function saveSettings() {
            const prefix = document.getElementById('cfgPrefix').value;
            const isPublic = document.getElementById('cfgIsPublic').value === 'true';
            const autoReact = document.getElementById('cfgAutoReact').value;
            const antipm = document.getElementById('cfgAntipm').value;
            const author = document.getElementById('cfgAuthor').value;

            try {
                await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'prefix', value: prefix }) });
                await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'isPublic', value: isPublic }) });
                await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'autoReact', value: autoReact }) });
                await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'antipm', value: antipm }) });
                await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'author', value: author }) });

                alert('Settings saved successfully!');
                refreshData();
            } catch (e) {
                alert('Failed to save settings: ' + e.message);
            }
        }

        async function fetchCommands() {
            try {
                const res = await fetch('/api/commands');
                const data = await res.json();
                allCommands = data.commands || [];
                document.getElementById('cmdCountLabel').innerText = allCommands.length;
                renderCommands(allCommands);
            } catch (e) {
                console.error("Commands fetch error:", e);
            }
        }

        function renderCommands(list) {
            const tbody = document.getElementById('commandsTableBody');
            if (list.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-slate-500">No commands found</td></tr>';
                return;
            }
            tbody.innerHTML = list.map(c => \`
                <tr class="hover:bg-slate-900/50 transition">
                    <td class="p-3 font-mono font-bold text-cyan-400">\${escapeHtml(c.trigger)}</td>
                    <td class="p-3"><span class="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] font-mono uppercase">\${escapeHtml(c.category)}</span></td>
                    <td class="p-3 text-slate-300">\${escapeHtml(c.description)}</td>
                    <td class="p-3 text-slate-400 font-mono text-[10px]">\${escapeHtml(c.permission)}</td>
                </tr>
            \`).join('');
        }

        function filterCommands() {
            const query = document.getElementById('searchCmd').value.toLowerCase();
            const filtered = allCommands.filter(c => 
                c.trigger.toLowerCase().includes(query) || 
                c.description.toLowerCase().includes(query) ||
                c.category.toLowerCase().includes(query)
            );
            renderCommands(filtered);
        }

        async function fetchLogs() {
            try {
                const res = await fetch('/api/logs');
                const data = await res.json();
                const container = document.getElementById('logsConsole');
                if (!data.logs || data.logs.length === 0) {
                    container.innerHTML = '<p class="text-slate-500">No logs captured yet.</p>';
                    return;
                }
                container.innerHTML = data.logs.slice(-50).map(l => {
                    let color = 'text-slate-300';
                    if (l.level === 'WARN') color = 'text-yellow-400';
                    if (l.level === 'ERROR') color = 'text-red-400';
                    const time = l.time ? l.time.split('T')[1].split('.')[0] : '';
                    return \`<div class="\${color}"><span class="text-slate-600 mr-1.5">[\${time}]</span><span class="font-semibold text-slate-500 mr-1.5">[\${l.level}]</span>\${escapeHtml(l.message)}</div>\`;
                }).join('');
                container.scrollTop = container.scrollHeight;
            } catch (e) {
                console.error("Logs fetch error:", e);
            }
        }

        function formatUptime(seconds) {
            const h = Math.floor(seconds / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            const s = seconds % 60;
            return \`\${h}h \${m}m \${s}s\`;
        }

        function escapeHtml(str) {
            return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        function refreshData() {
            fetchStatus();
            fetchPairing();
            fetchLogs();
        }

        // Init
        refreshData();
        fetchConfig();
        fetchCommands();
        setInterval(refreshData, 3000);
    </script>
</body>
</html>`;
}

module.exports = { createServer };
