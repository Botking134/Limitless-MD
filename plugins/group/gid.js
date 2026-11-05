// plugins/group/gid.js
//   .gid   in a group  -> shows that group's id (use it with e.g. `.antilink delete <id>` from a DM)
//   .gid   in a DM     -> lists every group this bot is in, with ids (owner / sudo / dev only)
module.exports = [
    {
        name: 'gid',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev } = {}) => {
            const jid = msg.key.remoteJid;
            if (jid.endsWith('@g.us')) {
                return sock.sendMessage(jid, { text: `🆔 *Group ID:*\n${jid}` }, { quoted: msg });
            }
            if (!(isOwner || isSudo || isDev)) {
                return sock.sendMessage(jid, { text: '❌ Only the owner can list groups. Run .gid inside a group to get its id.' }, { quoted: msg });
            }
            try {
                const groups = Object.values(await sock.groupFetchAllParticipating());
                if (!groups.length) return sock.sendMessage(jid, { text: 'I am not in any groups.' }, { quoted: msg });
                groups.sort((a, b) => String(a.subject).localeCompare(String(b.subject)));
                const lines = groups.map((g, i) => `${i + 1}. *${g.subject || 'Unnamed'}*\n${g.id}`);
                // keep each message a comfortable size
                for (let i = 0; i < lines.length; i += 25) {
                    const head = i === 0 ? `👥 *Groups (${groups.length})*\n\n` : '';
                    await sock.sendMessage(jid, { text: head + lines.slice(i, i + 25).join('\n\n') }, { quoted: msg });
                }
            } catch (e) {
                await sock.sendMessage(jid, { text: `❌ Could not read groups: ${e.message}` }, { quoted: msg });
            }
        }
    }
];
