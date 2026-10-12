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
        intro: 'Kneel, mortals. You have been summoned by the almighty Demon King of Tyranny, Anos Voldigoad.',
        gifs: [],
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
        intro: 'Listen here, you worms. You have been summoned by the almighty King of Curses, Ryomen Sukuna.',
        gifs: [],
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
        intro: 'Listen here, you mortals. You have been summoned by the almighty Madara Uchiha.',
        gifs: [
            'https://media.giphy.com/media/PmCiutdmK8mt2/giphy.mp4',
            'https://media.giphy.com/media/5D8fDjKyQfuZW/giphy.mp4'
        ],
        messages: [
            '🔥 Wake up to reality, all of you. Madara Uchiha calls, and you will answer.',
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
        intro: 'Listen carefully, you pitiful ones. You have been summoned by the almighty Sōsuke Aizen.',
        gifs: [],
        messages: [
            '☕ Please, gather. Everything has proceeded exactly as I intended, and your arrival is the final piece.',
            '🦋 Admiration is the farthest thing from understanding. Come closer, and perhaps you will understand.',
            '👓 Do not be alarmed. I merely require your attention. Though refusal was never an option.',
            '🌙 From the very beginning, you were meant to read this message. Assemble.',
            '🕊️ I do not raise my voice. I do not need to. Gather before Kyōka Suigetsu fools you further.',
            '⚡ Sōsuke Aizen has summoned you. Consider it a privilege, not an inconvenience.',
            '🔮 You thought you had a choice in coming here? How charming. Proceed.',
            '🌸 Stand at the summit with me, or watch from far below. I will wait, though not for long.',
            '🪞 What you see is only what I allow you to see. Now, show yourselves.',
            '👑 The throne of Hueco Mundo was only the beginning. Gather and witness what comes next.'
        ]
    },
    {
        name: 'Goku Black',
        intro: 'Listen here, you mortals. You have been summoned by the divine and almighty Goku Black.',
        gifs: [],
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

function pickGif(character) {
    const pool = character.gifs.length ? character.gifs : CHARACTERS.flatMap(c => c.gifs);
    return pool.length ? pick(pool) : null;
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

    const character = pick(CHARACTERS);
    const quoted = getQuoted(msg);

    // A follow-up is either text typed after the command or the text of a replied-to message.
    const userMessage = (args || '').trim() || quoted?.text || '';

    const header = userMessage
        ? `${character.intro}\n\n*Message:* ${userMessage}`
        : pick(character.messages);

    const list = all ? buildMemberList(participants) : '';
    const fullText = all ? `${header}\n\n${list}` : header;

    let sent = false;

    // Replied to a picture/video/etc -> forward the real media instead of the GIF.
    if (quoted?.media) {
        sent = await sendWithQuotedMedia(sock, jid, quoted, header, mentions, list);
    }

    if (!sent) {
        const gif = pickGif(character);
        if (gif) {
            try {
                await sock.sendMessage(jid, {
                    video: { url: gif },
                    gifPlayback: true,
                    caption: fullText,
                    mentions
                });
                sent = true;
            } catch (gifErr) {
                console.error('[Summon] GIF send failed:', gifErr.message);
            }
        }
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
