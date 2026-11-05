// plugins/disk.js
// Dev-only disk report and cleaner.
//   .disk                 free space + the biggest folders
//   .disk clean           empties storage/temp (leftover conversion files)
//   .disk clean backups   also deletes storage/backups (made by .git force)
// Non-devs get a 🖕 / 💩 / ❌ reaction and nothing else; devs get 👨‍💻.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { dirSize } = require('../helpers/TempCleaner');

const ROOT = path.join(__dirname, '..');
const STORAGE = path.join(ROOT, 'storage');
const DENY = ['🖕', '💩', '❌'];

const mb = (bytes) => (bytes / 1048576).toFixed(1) + ' MB';
const gb = (bytes) => (bytes / 1073741824).toFixed(2) + ' GB';

function du(target) {
    return new Promise((resolve) => {
        execFile('du', ['-sk', target], { timeout: 20000 }, (err, out) => {
            if (!err) {
                const kb = parseInt(String(out).split(/\s+/)[0], 10);
                if (Number.isFinite(kb)) return resolve(kb * 1024);
            }
            try { resolve(dirSize(target)); } catch (e) { resolve(0); }
        });
    });
}

async function biggest(dir, limit) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch (e) { return []; }
    const sizes = await Promise.all(names.map(async (n) => ({ name: n, size: await du(path.join(dir, n)) })));
    return sizes.sort((a, b) => b.size - a.size).slice(0, limit);
}

function emptyDir(dir) {
    let freed = 0, count = 0;
    let names = [];
    try { names = fs.readdirSync(dir); } catch (e) { return { freed, count }; }
    for (const n of names) {
        const full = path.join(dir, n);
        try {
            const st = fs.lstatSync(full);
            freed += st.isDirectory() ? dirSize(full) : st.size;
            fs.rmSync(full, { recursive: true, force: true });
            count++;
        } catch (e) { /* skip */ }
    }
    return { freed, count };
}

module.exports = [
    {
        name: 'disk',
        isPrefixless: false,
        category: 'owner',
        description: 'Show free disk space and the biggest folders; "disk clean" empties temp files.',
        execute: async (sock, msg, args, { isDev } = {}) => {
            const jid = msg.key.remoteJid;
            const react = async (text) => { try { await sock.sendMessage(jid, { react: { text, key: msg.key } }); } catch (e) { /* best effort */ } };
            if (!isDev) return react(DENY[Math.floor(Math.random() * DENY.length)]);
            await react('👨‍💻');

            const arg = (Array.isArray(args) ? args.join(' ') : String(args || '')).trim().toLowerCase();
            const reply = (text) => sock.sendMessage(jid, { text }, { quoted: msg });

            try {
                if (arg.startsWith('clean')) {
                    const temp = emptyDir(path.join(STORAGE, 'temp'));
                    let text = `🧹 *Temp cleaned:* ${temp.count} item(s), ${mb(temp.freed)} freed.`;
                    if (arg.includes('backups')) {
                        const b = emptyDir(path.join(STORAGE, 'backups'));
                        text += `\n🗑️ *Backups deleted:* ${b.count} item(s), ${mb(b.freed)} freed.`;
                    }
                    return await reply(text);
                }

                let space = '';
                try {
                    const st = fs.statfsSync(STORAGE);
                    const total = st.blocks * st.bsize;
                    const free = st.bavail * st.bsize;
                    space = `💽 *Disk:* ${gb(free)} free of ${gb(total)} (${Math.round((1 - free / total) * 100)}% used)\n\n`;
                } catch (e) { space = '💽 *Disk:* could not read free space on this host\n\n'; }

                const [top, inStorage] = await Promise.all([biggest(ROOT, 6), biggest(STORAGE, 6)]);
                const fmt = (list) => list.map((x) => `• ${x.name} — ${mb(x.size)}`).join('\n') || '• (empty)';
                await reply(
                    `${space}📁 *Project folder (biggest)*\n${fmt(top)}\n\n📂 *storage/ (biggest)*\n${fmt(inStorage)}\n\n` +
                    `Free space: \`disk clean\` (temp files) · \`disk clean backups\` (also deletes storage/backups)`
                );
            } catch (e) {
                await reply(`❌ *Error:* ${e.message}`);
            }
        }
    }
];
