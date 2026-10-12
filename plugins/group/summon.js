// plugins/group/summon.js
// Prefixless "summon" (hidden tag) and "summon-all" (visible tag-all).
//
//   summon                 -> random themed message on a GIF, everyone mentioned
//   summon I am awesome    -> "<intro> / Message: I am awesome", everyone mentioned
//   summon-all             -> same idea, plus the visible admins/members list
//
// Like ghost, the command message is deleted and nothing is sent as a reply to it.
// Replying to a picture/video with either command forwards the media itself.
//
// NOTE: plugins/ai.js already has a prefixed ".summon <character> <prompt>".
// Both share the registry name "summon", so when the message was typed WITH the
// prefix this file hands it straight to the AI version.

const config = require('../../config');
const { getBody, getQuoted, sendWithQuotedMedia } = require('../../helpers/TagHelper');

// ─── CHARACTER POOLS ─────────────────────────────────────────────
// Add more GIF links to any character's `gifs` array. A character with an
// empty list borrows from the combined pool of every character's GIFs.
const CHARACTERS = [
    {
        name: 'Anos Voldigoad',
        intro: 'Kneel, mortals. You have been summoned by the almighty Demon King of Tyranny, {user}.',
        gifs: [
            'https://tenor.com/view/anos-voldigoad-the-misfit-of-demon-king-academy-maou-gakuin-no-futekigousha-shijou-saikyou-anime-gif-17773908',
            'https://tenor.com/view/anime-fire-magic-boy-power-gif-20556777',
            'https://tenor.com/view/anos-voldigoad-maou-gakuin-no-futekigousha-anime-one-eye-closed-eyes-gif-2170303314035264186',
            'https://media0.giphy.com/media/v1.Y2lkPTZjMDliOTUycWd4cGc0dXlpN3ZtazV0NzhhbDVmeWpjdW40NG1naG05dHViZHptMSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/FeAxKYM3TUjaCr3y0T/giphy.gif'
        ],
        messages: [
            '👑 Kneel and listen, little ones. The Demon King of Tyranny does not repeat himself. Gather before me. Now.',
            '🌑 I have crushed gods for sport. Answering this summons should be a trivial task for you. Show yourselves.',
            '⚡ Your Demon King has spoken. Whoever delays will learn what tyranny truly means.',
            '👁️ I see the entire group, down to the root of every one of you. Come forward before my patience thins.',
            '🔥 Do not mistake my silence for mercy. Assemble. The throne is waiting.',
            '🕯️ Two thousand years I slept, and still you make me wait. Gather. At once.',
            '💀 Is this all the attendance the Demon King deserves? Pathetic. Fill this chat immediately.',
            '🌌 The root of all magic bows to me, and so will your schedules. Present yourselves.',
            '⚔️ I permit you to stand in my presence. Do not waste the honor. Gather.',
            '👑 Tyranny begins with a simple order: show up. This is that order.'
        ]
    },
    {
        name: 'Sukuna',
        intro: 'Listen here, you worms. You have been summoned by the almighty King of Curses, {user}.',
        gifs: [
            'https://giphy.com/gifs/sukuna-absolutely-cinema-new-yuta-hoYXVjUeuWkDU7tgpP',
            'https://giphy.com/gifs/jujutsu-kaisen-jjk-tybwaizen-6z1HgugyTuAIcQU0bJ',
            'https://tenor.com/view/ryomen-sukuna-sukuna-jjk-jujutsu-kaisen-shibuya-incident-gif-13282712230001592672',
            'https://tenor.com/view/jujutsu-kaisen-sukuna-lurk-shadow-aura-gif-6185663566858598390',
            'https://tenor.com/view/sukuna-gojo-sukuna-stand-stance-menace-gif-13567237251564571991'
        ],
        messages: [
            '🩸 Tch. Listen well, insects. The King of Curses will not call twice. Gather.',
            '👹 Entertain me, weaklings. Appear before I get bored and carve the silence myself.',
            '🔪 You have been summoned by the strongest curse in history. Show some respect and show up.',
            '🔥 Malevolent Shrine is open. Walk in on your own, or be dragged in. Choose quickly.',
            '😈 Hmph. Such a quiet group. Let me hear you scream, or at least type.',
            '🩸 I tolerate no tardiness. Every one of you, get over here.',
            '👁️ Four eyes see everything, fools. Hiding in the chat will not save you.',
            '🌑 Stand tall if you wish to amuse me. Cower, and I will not be gentle. Gather.',
            '⛩️ The King\'s patience is thinner than a Cleave cut. Appear.',
            '💀 Even a lowly sorcerer can answer a summons. Prove you are more than trash.'
        ]
    },
    {
        name: 'Madara Uchiha',
        intro: 'Listen here, you mortals. You have been summoned by the almighty {user}.',
        gifs: [
            'https://media.giphy.com/media/PmCiutdmK8mt2/giphy.mp4',
            'https://media.giphy.com/media/5D8fDjKyQfuZW/giphy.mp4',
            'https://tenor.com/view/naruto-shippuden-anime-madara-uchiha-madara-reanimated-madara-gif-17675345',
            'https://tenor.com/view/madara-uchiha-madara-uchiha-sharingan-mangekyou-sharingan-gif-26811631',
            'https://tenor.com/view/madara-uchiha-madara-gif-6511397259848860477',
            'https://tenor.com/view/ok-gif-26107516'
        ],
        messages: [
            '🔥 Wake up to reality, all of you. {user} calls, and you will answer.',
            '👁️ The Sharingan sees who is present and who is hiding. Step forward.',
            '🌕 Gather beneath the moon. The Infinite Tsukuyomi of this chat begins now.',
            '⚔️ I have outlived wars and legends. A simple summons should not be difficult for you. Assemble.',
            '🌋 Those who ignore the call of an Uchiha will taste the wrath of Susanoo. Move.',
            '🍃 Even the Senju could not make me wait this long. Show yourselves.',
            '🩸 The world is a stage of illusions, and I am calling the cast. Get in here.',
            '💥 Stand with me or stand in the dust. Either way, you will stand here now.',
            '🌑 Light and shadow gather as one. So will you. Report immediately.',
            '👑 A god among shinobi has spoken. Obey and arrive.'
        ]
    },
    {
        name: 'Aizen',
        intro: 'Listen carefully, you pitiful ones. You have been summoned by the almighty {user}.',
        gifs: [
            'https://media2.giphy.com/media/v1.Y2lkPTZjMDliOTUyenMwdTIyZWM3NTNmMTUwaHoza2kybDhpY3I5ZW5qbWwwOWpnMzhhYiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/VjlBgiS7Ly7P9Q5YDw/giphy.gif',
            'https://media1.giphy.com/media/v1.Y2lkPTZjMDliOTUydTB0NnE2ZzJ1MHY2ZzBxdDBobnZ6MGZjMGlvMGJyZjNtMm5qMjhhNCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/cEUhgMTCEFmKa8Fw4z/giphy.gif',
            'https://media1.giphy.com/media/v1.Y2lkPTZjMDliOTUydXQ5ZWUwY2R2bHphNDRmeGI1YXZrajl1YnA1eWV0dnUxa241cm02cyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/YQ5vylGalaqSF1FjVP/giphy.gif'
        ],
        messages: [
            '☕ Please, gather. Everything has proceeded exactly as I intended, and your arrival is the final piece.',
            '🦋 Admiration is the farthest thing from understanding. Come closer, and perhaps you will understand.',
            '👓 Do not be alarmed. I merely require your attention. Though refusal was never an option.',
            '🌙 From the very beginning, you were meant to read this message. Assemble.',
            '🕊️ I do not raise my voice. I do not need to. Gather before Kyōka Suigetsu fools you further.',
            '⚡ {user} has summoned you. Consider it a privilege, not an inconvenience.',
            '🔮 You thought you had a choice in coming here? How charming. Proceed.',
            '🌸 Stand at the summit with me, or watch from far below. I will wait, though not for long.',
            '🪞 What you see is only what I allow you to see. Now, show yourselves.',
            '👑 The throne of Hueco Mundo was only the beginning. Gather and witness what comes next.'
        ]
    },
    {
        name: 'Goku Black',
        intro: 'Listen here, you mortals. You have been summoned by the divine and almighty {user}.',
        gifs: [
            'https://media2.giphy.com/media/v1.Y2lkPTZjMDliOTUycjhhd3BiY2t4bTR2dGNoZHBhenFhbXZ1YXl1bXlmNGhncHQ2OXVwciZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/Ji62nL3dPnJOrbVwOi/giphy.gif',
            'https://media2.giphy.com/media/v1.Y2lkPTZjMDliOTUyMDBpMnQ0emJzNHFvbWpibGtzN2I5dzY3NG5oYTF3eG9vcmowZjQxcSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/iNUCN6uXXh2pk8oJk0/giphy.gif',
            'https://media1.giphy.com/media/v1.Y2lkPTZjMDliOTUybnd2dHZtOHNpZG50d2EzbHY4NGFmNTA2aHdkZjF0eWtobGRtd2tlMyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/0wDC3JcBUQIeLBHfcH/giphy.gif'
        ],
        messages: [
            '🌸 Listen, mortals. Divine justice has spoken through me. Gather.',
            '⚡ I am the god who will cleanse this world. Show your faces, mortals.',
            '🔥 Your trivial lives bore me. Appear, and entertain divinity.',
            '👑 Super Saiyan Rosé is only the beginning of my beauty and my wrath. Assemble.',
            '🕊️ A god does not wait on mortals. Come forth immediately.',
            '🌌 The Zero Mortals Plan begins with a roll call. Present yourselves.',
            '💫 You stand before perfection in a Saiyan\'s body. Bow, then gather.',
            '🌹 Even the pitiful humans may serve a purpose today. Report to me.',
            '⚔️ Disobey the summons of a god, and I will simply erase your name from this chat.',
            '☄️ This world must be purified, and attendance is the first step. Gather.'
        ]
    }
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Turns whatever link was pasted into something Baileys can send as a video.
//  - giphy page / media links  -> https://media.giphy.com/media/<id>/giphy.mp4
//  - tenor.com/view/... pages  -> direct .mp4 read from the page's og:video tag
//  - anything else             -> used as-is
const tenorCache = new Map();

async function resolveTenor(url) {
    if (tenorCache.has(url)) return tenorCache.get(url);
    try {
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml'
            }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const html = await res.text();

        let direct = null;
        const m1 = html.match(/<meta[^>]+property=["']og:video["'][^>]+content=["']([^"']+)["']/i);
        const m2 = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video["']/i);
        if (m1) direct = m1[1];
        else if (m2) direct = m2[1];
        if (!direct) {
            const m3 = html.match(/https:\/\/media\.tenor\.com\/[^"'\s\\]+\.mp4/i);
            if (m3) direct = m3[0];
        }
        if (direct) {
            direct = direct.replace(/&amp;/g, '&');
            tenorCache.set(url, direct);
            return direct;
        }
    } catch (e) { /* fall through */ }
    return null;
}

async function toDirectUrl(entry) {
    if (entry.includes('tenor.com/view/')) return resolveTenor(entry);

    if (entry.includes('giphy.com')) {
        if (/giphy\.mp4(\?|$)/.test(entry) && /media\.giphy\.com\/media\/[A-Za-z0-9]+\//.test(entry)) return entry;
        const fromMedia = entry.match(/\/([A-Za-z0-9]+)\/giphy[^/]*\.(?:gif|mp4|webp)/);
        const fromPage = entry.match(/giphy\.com\/gifs\/(?:[^/?#]*-)?([A-Za-z0-9]+)\/?(?:[?#].*)?$/);
        const id = (fromMedia || fromPage)?.[1];
        if (id) return `https://media.giphy.com/media/${id}/giphy.mp4`;
    }
    return entry;
}

// Tries the character's GIFs in random order; returns true as soon as one sends.
async function sendCharacterGif(sock, jid, character, caption, mentions) {
    const pool = character.gifs.length ? character.gifs : CHARACTERS.flatMap(c => c.gifs);
    const order = [...pool].sort(() => Math.random() - 0.5);

    for (const entry of order) {
        try {
            const url = await toDirectUrl(entry);
            if (!url) continue;
            await sock.sendMessage(jid, { video: { url }, gifPlayback: true, caption, mentions });
            return true;
        } catch (err) {
            console.error('[Summon] GIF failed, trying next:', err.message);
        }
    }
    return false;
}

// JID of whoever ran the command (used for the "@user" in the speech).
function getSenderJid(sock, msg, participants) {
    const strip = (j) => (j || '').replace(/:\d+@/, '@');
    if (msg.key.fromMe) {
        const own = [strip(sock.user?.id), strip(sock.user?.lid)].filter(Boolean);
        return own.find(j => participants.some(p => p.id === j)) || own[0];
    }
    return msg.key.participant || msg.participant || null;
}

function buildMemberList(participants) {
    const admins = participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin');
    const members = participants.filter(p => p.admin === null || p.admin === undefined);

    let list = `             ⟬ ＡＤＭＩＮＳ⟭\n`;
    for (let i = 0; i < admins.length; i += 2) {
        const a1 = admins[i] ? `➣@${admins[i].id.split('@')[0]}` : '';
        const a2 = admins[i + 1] ? `                      ➣@${admins[i + 1].id.split('@')[0]}` : '';
        list += `${a1}${a2}\n`;
    }

    list += `\n           ☲ＭＥＭＢＥＲＳ☲\n`;
    for (const m of members) list += `➥@${m.id.split('@')[0]}\n`;
    return list;
}

async function runSummon(sock, msg, args, ctx, all) {
    const jid = msg.key.remoteJid;
    const { isOwner, isSudo, isDev } = ctx || {};

    // Typed WITH the prefix -> that's the AI character command from ai.js.
    if (!all) {
        const prefix = config.prefix;
        if (prefix && getBody(msg).trim().startsWith(prefix)) {
            const aiCommands = require('../ai');
            const aiSummon = aiCommands.find(c => c.name === 'summon');
            if (aiSummon) return aiSummon.execute(sock, msg, args, ctx);
            return;
        }
    }

    if (!jid.endsWith('@g.us')) return;
    if (!(isDev || isOwner || isSudo)) return;

    const groupMetadata = await sock.groupMetadata(jid);
    const participants = groupMetadata.participants;
    const mentions = participants.map(p => p.id);

    const senderJid = getSenderJid(sock, msg, participants);
    const userTag = senderJid ? `@${senderJid.split('@')[0]}` : 'the summoner';
    if (senderJid && !mentions.includes(senderJid)) mentions.push(senderJid);

    const character = pick(CHARACTERS);
    const quoted = getQuoted(msg);

    // A follow-up is either text typed after the command or the text of a replied-to message.
    const userMessage = (args || '').trim() || quoted?.text || '';

    const header = (userMessage
        ? `${character.intro}\n\n*Message:* ${userMessage}`
        : pick(character.messages)
    ).split('{user}').join(userTag);

    const list = all ? buildMemberList(participants) : '';
    const fullText = all ? `${header}\n\n${list}` : header;

    let sent = false;

    // Replied to a picture/video/etc -> forward the real media instead of the GIF.
    if (quoted?.media) {
        sent = await sendWithQuotedMedia(sock, jid, quoted, header, mentions, list);
    }

    if (!sent) {
        sent = await sendCharacterGif(sock, jid, character, fullText, mentions);
    }

    if (!sent) {
        await sock.sendMessage(jid, { text: fullText, mentions });
    }

    // Ghost behaviour: wipe the command message.
    try {
        await sock.sendMessage(jid, { delete: msg.key });
    } catch (err) {}
}

module.exports = [
    {
        name: 'summon',
        isPrefixless: true,
        prefixlessArgs: true,
        category: 'group',
        description: 'Prefixless hidden tag with a themed GIF message. Add text after it for a custom message.',
        execute: (sock, msg, args, ctx) => runSummon(sock, msg, args, ctx, false)
    },
    {
        name: 'summon-all',
        isPrefixless: true,
        prefixlessArgs: true,
        category: 'group',
        description: 'Prefixless visible tag-all with a themed GIF message. Add text after it for a custom message.',
        execute: (sock, msg, args, ctx) => runSummon(sock, msg, args, ctx, true)
    },
    {
        name: 'summonall',
        isPrefixless: true,
        prefixlessArgs: true,
        category: 'group',
        description: 'Alias of summon-all.',
        execute: (sock, msg, args, ctx) => runSummon(sock, msg, args, ctx, true)
    }
];
