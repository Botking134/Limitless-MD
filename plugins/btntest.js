// plugins/btntest.js
// Owner-only diagnostic: sends the same tiny button message in several formats
// so we can see which one your WhatsApp actually draws. Usage: .btntest
const config = require('../config');

module.exports = [
    {
        name: 'btntest',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner } = {}) => {
            const jid = msg.key.remoteJid;
            if (!isOwner) return;
            const report = [];

            const say = (t) => sock.sendMessage(jid, { text: t }, { quoted: msg });

            // A: old-style buttons (goes through the pair.js converter)
            try {
                await sock.sendMessage(jid, {
                    text: '🧪 *Variant A* — converted old-style button',
                    footer: 'btntest',
                    buttons: [{ buttonId: config.prefix + 'ping', buttonText: { displayText: 'A: tap me' }, type: 1 }],
                    headerType: 1
                }, { quoted: msg });
                report.push('A sent');
            } catch (e) { report.push('A error: ' + e.message); }

            // B: native-flow quick reply, no view-once wrapper, with empty header
            try {
                const { generateWAMessageFromContent, proto } = await import('@itsliaaa/baileys');
                const full = generateWAMessageFromContent(jid, proto.Message.fromObject({
                    interactiveMessage: {
                        header: { title: '', subtitle: '', hasMediaAttachment: false },
                        body: { text: '🧪 *Variant B* — plain interactiveMessage' },
                        footer: { text: 'btntest' },
                        nativeFlowMessage: { buttons: [{ name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: 'B: tap me', id: config.prefix + 'ping' }) }] }
                    }
                }), { userJid: sock.user.id });
                const nodes = [{ tag: 'biz', attrs: {}, content: [{ tag: 'interactive', attrs: { type: 'native_flow', v: '1' }, content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }] }] }];
                if (!jid.endsWith('@g.us')) nodes.push({ tag: 'bot', attrs: { biz_bot: '1' } });
                await sock.relayMessage(jid, full.message, { messageId: full.key.id, additionalNodes: nodes });
                report.push('B sent');
            } catch (e) { report.push('B error: ' + e.message); }

            // C: vansnowi richMenu
            try {
                if (typeof sock.richMenu !== 'function') throw new Error('sock.richMenu is not a function');
                await sock.richMenu(jid, {
                    body: { carousel: true, cards: [{ title: 'C: richMenu', buttons: ['ping'], toast: 'ok' }] }
                });
                report.push('C sent');
            } catch (e) { report.push('C error: ' + e.message); }

            // D: old-style list (converted to single_select)
            try {
                await sock.sendMessage(jid, {
                    text: '🧪 *Variant D* — converted list',
                    footer: 'btntest',
                    title: 'List test',
                    buttonText: 'Open list',
                    sections: [{ title: 'Test', rows: [{ title: 'Ping', rowId: config.prefix + 'ping', description: 'runs ping' }] }]
                }, { quoted: msg });
                report.push('D sent');
            } catch (e) { report.push('D error: ' + e.message); }

            await say('🧪 *btntest result*\n' + report.join('\n') + '\n\nTell me which of A, B, C, D show real buttons.');
        }
    }
];
