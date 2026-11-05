// plugins/group/badword.js
//   .badword add <word or phrase>[ | another | ...]  add (separate entries with |)
//   .badword remove <word or phrase>[ | ...]         remove
//   .badword warn | delete | kick | off              what happens when someone says one
//   .badword clear                                   empty the list
//   .badwords                                        show the list + current mode
//   .antiword ...                                    same as .badword  (".antiword off")
//
// Admins / owner / sudo / devs may use it, and they are immune to it.
const BadWords = require('../../helpers/BadWords');
const { cleanJid } = require('../../helpers/Message');

const MODE_LABEL = { warn: 'WARN', delete: 'DELETE', kick: 'KICK', off: 'OFF' };

async function allowed(sock, msg, jid, { isOwner, isSudo, isDev, isAdmin }) {
    if (!jid.endsWith('@g.us')) {
        await sock.sendMessage(jid, { text: '❌ This command is only available in group chats.' }, { quoted: msg });
        return false;
    }
    if (isDev || isOwner || isSudo || isAdmin) return true;

    try {
        const meta = await sock.groupMetadata(jid);
        const me = cleanJid(msg.key.participant || msg.key.remoteJid || '');
        const p = (meta.participants || []).find((x) => cleanJid(x.id) === me || (x.lid && cleanJid(x.lid) === me));
        if (p?.admin === 'admin' || p?.admin === 'superadmin') return true;
    } catch (e) { /* fall through */ }

    await sock.sendMessage(jid, { text: '❌ You must be an administrator in this group to run this command!' }, { quoted: msg });
    return false;
}

function listText(sock, jid) {
    const { mode, words } = BadWords.getGroup(sock, jid);
    const body = words.length ? words.map((w, i) => `${i + 1}. ${w}`).join('\n') : '_No words set yet._';
    return `🚫 *Antiword* — ${MODE_LABEL[mode]}\n\n${body}\n\n` +
           `_Admins and devs are immune._\n` +
           `Add: .badword add <word or phrase>\nRemove: .badword remove <word>\nMode: .badword warn | delete | kick | off`;
}

// Hide the admin's own command message so the words aren't shown to the whole group.
async function hide(sock, jid, msg) {
    try { await sock.sendMessage(jid, { delete: msg.key }); } catch (e) { /* needs admin; ignore */ }
}

async function run(sock, msg, args, ctx) {
    const jid = msg.key.remoteJid;
    if (!(await allowed(sock, msg, jid, ctx))) return;

    const input = (Array.isArray(args) ? args.join(' ') : String(args || '')).trim();
    const reply = (text) => sock.sendMessage(jid, { text }, { quoted: msg });
    if (!input) return reply(listText(sock, jid));

    const [first, ...restParts] = input.split(/\s+/);
    const sub = first.toLowerCase();
    const rest = input.slice(first.length).trim();

    if (BadWords.MODES.includes(sub) || sub === 'on') {
        const mode = sub === 'on' ? 'delete' : sub;
        BadWords.setMode(sock, jid, mode);
        const note = mode !== 'off' && !BadWords.getGroup(sock, jid).words.length
            ? '\n\n⚠️ The list is empty — add words with .badword add <word>.' : '';
        return reply(`🚫 *Antiword updated:* \`${MODE_LABEL[mode]}\`${note}`);
    }

    if (sub === 'add' || sub === 'set') {
        const terms = BadWords.parseTerms(rest);
        if (!terms.length) return reply('Usage: .badword add <word or phrase>[ | another one]');
        const { added, existed } = BadWords.add(sock, jid, terms);
        await hide(sock, jid, msg);
        const g = BadWords.getGroup(sock, jid);
        return sock.sendMessage(jid, {
            text: `✅ Added ${added.length} word${added.length === 1 ? '' : 's'}` +
                  `${existed ? ` (${existed} already in the list)` : ''}.` +
                  `${g.mode === 'off' ? '\n\n⚠️ Antiword is OFF — turn it on with .badword warn | delete | kick' : ''}`
        });
    }

    if (sub === 'remove' || sub === 'del' || sub === 'delete' || sub === 'rm') {
        const terms = BadWords.parseTerms(rest);
        if (!terms.length) return reply('Usage: .badword remove <word or phrase>');
        const n = BadWords.remove(sock, jid, terms);
        await hide(sock, jid, msg);
        return sock.sendMessage(jid, { text: n ? `🗑️ Removed ${n} word${n === 1 ? '' : 's'}.` : '❌ None of those were in the list.' });
    }

    if (sub === 'clear' || sub === 'reset') {
        const n = BadWords.clear(sock, jid);
        return reply(`🗑️ Cleared ${n} word${n === 1 ? '' : 's'}.`);
    }

    if (sub === 'list') return reply(listText(sock, jid));

    // `.badword some word` with no subcommand: treat as a list request, not a silent add
    return reply('Usage:\n.badword add <word or phrase>\n.badword remove <word>\n.badword warn | delete | kick | off\n.badword clear\n.badwords');
}

const commands = [
    { name: 'badword', isPrefixless: false, execute: run },
    { name: 'antiword', isPrefixless: false, execute: run },
    {
        name: 'badwords',
        isPrefixless: false,
        execute: async (sock, msg, args, ctx) => {
            const jid = msg.key.remoteJid;
            if (!(await allowed(sock, msg, jid, ctx))) return;
            await sock.sendMessage(jid, { text: listText(sock, jid) }, { quoted: msg });
        }
    }
];

module.exports = require('../../helpers/RemoteGroup').wrapMany(commands, ['badword', 'antiword', 'badwords']);
