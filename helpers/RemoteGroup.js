// helpers/RemoteGroup.js
//
// Lets a group-only command be run from a private chat by naming the group:
//
//     .antilink delete 120363012345678901@g.us
//     .badword add idiot 120363012345678901@g.us
//     .antitag 120363012345678901@g.us          (shows that group's current setting)
//
// The group id can sit anywhere in the arguments. The command runs exactly as if it had
// been typed in that group, but every reply comes back to the DM and nothing is posted in
// the group. Who may do this: owner / sudo / devs, and admins of that group.
const { cleanJid } = require('./Message');

const GROUP_ID = /^\d{5,}(?:-\d+)?@g\.us$/i;

const asString = (args) => (Array.isArray(args) ? args.join(' ') : String(args || ''));

function wrap(cmd) {
    const original = cmd.execute;
    return {
        ...cmd,
        execute: async (sock, msg, args, ctx = {}) => {
            const dm = msg.key.remoteJid || '';
            if (dm.endsWith('@g.us') || msg.key.fromMe && dm.endsWith('@g.us')) return original(sock, msg, args, ctx);

            const tokens = asString(args).split(/\s+/).filter(Boolean);
            const at = tokens.findIndex((t) => GROUP_ID.test(t));
            const reply = (text) => sock.sendMessage(dm, { text }, { quoted: msg });

            if (at === -1) {
                return reply(`ℹ️ Run this in the group, or from here with the group id:\n.${cmd.name} <options> <groupid@g.us>\n\n_Use .gid inside a group to get its id._`);
            }

            const gjid = tokens[at].toLowerCase();
            const rest = tokens.filter((_, i) => i !== at).join(' ');

            let meta;
            try { meta = await sock.groupMetadata(gjid); }
            catch (e) { return reply('❌ I could not open that group. Check the id, and that this bot is a member.'); }

            // owner / sudo / dev, or an admin of that group
            let allowed = !!(ctx.isOwner || ctx.isSudo || ctx.isDev);
            let isAdmin = !!ctx.isAdmin;
            if (!allowed) {
                const me = cleanJid(dm);
                const p = (meta.participants || []).find((x) => cleanJid(x.id) === me || (x.lid && cleanJid(x.lid) === me));
                isAdmin = p?.admin === 'admin' || p?.admin === 'superadmin';
                allowed = isAdmin;
            }
            if (!allowed) return reply('❌ Only the bot owner or an admin of that group can do this.');

            const subject = meta.subject ? `\n\n📍 _${meta.subject}_` : '';
            const redirect = (content) => {
                if (!content || typeof content !== 'object') return content;
                const c = { ...content };
                if (typeof c.text === 'string') c.text += subject;
                if (Array.isArray(c.buttons)) {
                    // keep the group id on button taps, otherwise the next tap would lose it
                    c.buttons = c.buttons.map((b) => (b && b.buttonId ? { ...b, buttonId: `${b.buttonId} ${gjid}` } : b));
                }
                return c;
            };

            const proxy = new Proxy(sock, {
                get(target, prop) {
                    if (prop === 'sendMessage') {
                        return (to, content, opts) => {
                            if (to !== gjid) return target.sendMessage(to, content, opts);
                            if (content && (content.delete || content.react)) return Promise.resolve(); // nothing to do in a DM
                            return target.sendMessage(dm, redirect(content), { ...(opts || {}), quoted: msg });
                        };
                    }
                    const v = target[prop];
                    return typeof v === 'function' ? v.bind(target) : v;
                }
            });

            const fake = { ...msg, key: { ...msg.key, remoteJid: gjid, participant: dm } };
            return original(proxy, fake, rest, { ...ctx, isAdmin });
        }
    };
}

// Wrap every command in `list` whose name is in `names` (in place).
function wrapMany(list, names) {
    const set = new Set(names);
    for (let i = 0; i < list.length; i++) if (set.has(list[i].name)) list[i] = wrap(list[i]);
    return list;
}

module.exports = { wrap, wrapMany, GROUP_ID };
