// plugins/gclog.js
const config = require('../config');
const { 
    readSettings, 
    saveSettings, 
    clearGroupLogs, 
    generateAizenSummary 
} = require('../helpers/SummaryManager');

module.exports = {
    name: 'gclog',
    category: 'tools',
    description: "Displays, clears, or configures Sōsuke Aizen's conversation log summaries for this group",
    execute: async (sock, msg, args) => {
        const jid = msg.key.remoteJid;
        if (!jid.endsWith('@g.us')) {
            return await sock.sendMessage(jid, { text: "❌ This command can only be executed within group chats." }, { quoted: msg });
        }

        const subCommand = args ? args.toLowerCase().trim() : '';
        const settings = readSettings();

        // ─── CASE A: DISPLAY STATUS (.gclog) ───
        if (!subCommand) {
            const currentStatus = settings[jid] === 'on' ? 'Active 🟢' : 'Inactive 💤';
            const totalLogs = global.groupLogs[jid] ? global.groupLogs[jid].length : 0;

            const statusText =
                `🔮 *LIMITLESS GC-LOG STATE* 🔮\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `• *Group:* \`${jid.split('@')[0]}\`\n` +
                `• *Logging:* \`${currentStatus}\`\n` +
                `• *Stored logs:* \`${totalLogs} / 100\` messages\n\n` +
                `👉 Use \`${config.prefix}gclog on\` to enable logging.\n` +
                `👉 Use \`${config.prefix}gclog off\` to disable logging.\n` +
                `👉 Use \`${config.prefix}gclog clear\` to purge logs.\n` +
                `👉 Use \`${config.prefix}gclog check\` to view the summary.`;

            return await sock.sendMessage(jid, { text: statusText }, { quoted: msg });
        }

        // ─── CASE B: ENABLE LOGGING (.gclog on) ───
        if (subCommand === 'on') {
            settings[jid] = 'on';
            saveSettings(settings);
            return await sock.sendMessage(jid, { text: "🟢 *𝘓𝘰𝘨𝘨𝘪𝘯𝘨 𝘩𝘢𝘴 𝘣𝘦𝘦𝘯 𝘢𝘤𝘵𝘪𝘷𝘢𝘵𝘦𝘥 𝘧𝘰𝘳 𝘵𝘩𝘪𝘴 𝘨𝘳𝘰𝘶𝘱. 𝘙𝘦𝘤𝘦𝘯𝘵 𝘮𝘦𝘴𝘴𝘢𝘨𝘦𝘴 𝘸𝘪𝘭𝘭 𝘣𝘦 𝘳𝘦𝘤𝘰𝘳𝘥𝘦𝘥.*" }, { quoted: msg });
        }

        // ─── CASE C: DISABLE LOGGING (.gclog off) ───
        if (subCommand === 'off') {
            settings[jid] = 'off';
            saveSettings(settings);
            return await sock.sendMessage(jid, { text: "💤 *𝘓𝘰𝘨𝘨𝘪𝘯𝘨 𝘩𝘢𝘴 𝘣𝘦𝘦𝘯 𝘥𝘦𝘢𝘤𝘵𝘪𝘷𝘢𝘵𝘦𝘥 𝘧𝘰𝘳 𝘵𝘩𝘪𝘴 𝘨𝘳𝘰𝘶𝘱.*" }, { quoted: msg });
        }

        // ─── CASE D: CLEAR LOGS (.gclog clear) ───
        if (subCommand === 'clear') {
            clearGroupLogs(jid);
            const aizenClearMsg = `*"I have erased your insignificant discussions from my memory. Since when were you under the impression that your words were worth preserving?"*`;
            return await sock.sendMessage(jid, { text: aizenClearMsg }, { quoted: msg });
        }

        // ─── CASE E: SUMMARY GENERATION (.gclog check) ───
        if (subCommand === 'check') {
            if (settings[jid] !== 'on') {
                return await sock.sendMessage(jid, { text: `❌ GC-Logging is currently inactive. Activate it first by typing: \`${config.prefix}gclog on\`` }, { quoted: msg });
            }

            const logs = global.groupLogs[jid] || [];
            if (logs.length < 5) {
                const emptyAizenMsg = `*"Such a sparse flow of thoughts. There is nothing here worthy of my calculation. Continue speaking, and perhaps you will capture my interest."*`;
                return await sock.sendMessage(jid, { text: emptyAizenMsg }, { quoted: msg });
            }

            await sock.sendMessage(jid, { text: "Expanding Kyōka Suigetsu... analyzing your simple thoughts. 🔮" }, { quoted: msg });

            try {
                const summaryResult = await generateAizenSummary(logs);
                await sock.sendMessage(jid, { text: summaryResult.trim() }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Sōsuke Aizen declined to analyze your mind at this time." }, { quoted: msg });
            }
            return;
        }

        // Default Fallback
        await sock.sendMessage(jid, { text: `❌ Unknown option. Type \`${config.prefix}gclog\` to see active options.` }, { quoted: msg });
    }
};