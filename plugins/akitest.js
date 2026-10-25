// plugins/akitest.js
// .akitest   -> checks, from the bot's own host, whether the real Akinator packages work
//               (installed? can they start a game? does Cloudflare block them?) and reports in chat.
// Owner / dev only. Safe to delete once the Akinator engine is settled.

const short = (e) => {
    const status = e?.response?.status || e?.status || e?.statusCode;
    return `${e?.name || 'Error'}: ${String(e?.message || e).slice(0, 160)}${status ? ` (HTTP ${status})` : ''}`;
};

async function load(name) {
    try { return await import(name); } catch (e) { return { __error: e }; }
}

function missing(e) {
    return /Cannot find (package|module)|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/i.test(String(e?.message || e) + String(e?.code || ''));
}

async function testAkiApi() {
    const m = await load('aki-api');
    if (m.__error) {
        return missing(m.__error)
            ? '❌ *aki-api*: not installed. Run `npm install aki-api`.'
            : `❌ *aki-api*: failed to load — ${short(m.__error)}`;
    }
    try {
        const Aki = m.Aki || m.default?.Aki || m.default;
        const aki = new Aki({ region: 'en' });
        await aki.start();
        const lines = [
            `✅ *aki-api*: works`,
            `   Q: ${aki.question}`,
            `   options: ${JSON.stringify(aki.answers)}`,
            `   progress: ${aki.progress}`
        ];
        try { await aki.step(1); lines.push(`   after "no": ${aki.question} (progress ${aki.progress})`); }
        catch (e) { lines.push(`   ⚠️ first answer failed — ${short(e)}`); }
        return lines.join('\n');
    } catch (e) {
        return `❌ *aki-api*: ${short(e)}`;
    }
}

async function testClient() {
    let route = 'direct';
    const m = await load('akinator-client');
    if (m.__error) {
        return missing(m.__error)
            ? '❌ *akinator-client*: not installed. Run `npm install akinator-client`.'
            : `❌ *akinator-client*: failed to load — ${short(m.__error)}`;
    }
    try {
        const Ctor = m.AkinatorClient || m.default?.AkinatorClient || m.default;
        const config = require('../config');
        const opts = { language: 'en', retries: 2 };
        const key = config.scraperApiKey || process.env.SCRAPERAPI_KEY;
        const proxy = config.akiProxy || process.env.AKI_PROXY;
        if (key) opts.scraperApiKey = key;
        if (proxy) opts.proxy = proxy;
        route = key ? 'via ScraperAPI' : proxy ? 'via proxy' : 'direct (no key or proxy set)';
        let a;
        try { a = new Ctor(opts); } catch (e) { a = new Ctor(); }
        await a.start();
        const lines = [
            `✅ *akinator-client*: works (${route})`,
            `   Q: ${a.question}`,
            `   progress: ${a.progress}`,
            `   exports: ${Object.keys(m).join(', ')}`
        ];
        try { await a.answer(m.Answers?.NO ?? 1); lines.push(`   after "no": ${a.question} (progress ${a.progress})`); }
        catch (e) { lines.push(`   ⚠️ first answer failed — ${short(e)}`); }
        return lines.join('\n');
    } catch (e) {
        return `❌ *akinator-client* (${route}): ${short(e)}`;
    }
}

module.exports = [
    {
        name: 'akitest',
        isPrefixless: false,
        category: 'owner',
        description: 'Owner test: checks whether the real Akinator packages work from this host.',
        execute: async (sock, msg, args, { isOwner, isDev } = {}) => {
            const jid = msg.key.remoteJid;
            if (!(isOwner || isDev)) return;
            await sock.sendMessage(jid, { text: '🧪 Testing the Akinator packages from this host… (up to 30 seconds)' }, { quoted: msg });
            const withTimeout = (p, label) => Promise.race([
                p, new Promise(r => setTimeout(() => r(`❌ *${label}*: no answer after 25s (blocked or stuck)`), 25000))
            ]);
            const results = [];
            results.push(await withTimeout(testAkiApi(), 'aki-api'));
            results.push(await withTimeout(testClient(), 'akinator-client'));
            await sock.sendMessage(jid, { text: `🧞 *AKINATOR PACKAGE TEST*\n\n${results.join('\n\n')}` }, { quoted: msg });
        }
    }
];
