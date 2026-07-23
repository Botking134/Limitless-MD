// plugins/gclog.js
const config = require('../config');
const { 
    readSettings, 
    saveSettings, 
    clearGroupLogs, 
    generateAizenSummary,
    scheduleAutoSummary,
    unscheduleAutoSummary
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

        // ─── CASE A: DISPLAY STATUS & BUTTONS (.gclog) ───
        if (!subCommand) {
            const currentStatus = settings[jid] === 'on' ? 'Active 🟢' : 'Inactive 💤';
            const totalLogs = global.groupLogs[jid] ? global.groupLogs[jid].length : 0;

            const statusText =
                `🔮 *LIMITLESS GC-LOG STATE* 🔮\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `• *Group:* \`${jid.split('@')[0]}\`\n` +
                `• *Logging:* \`${currentStatus}\`\n` +
                `• *Stored logs:* \`${totalLogs} / 100\` messages\n\n` +
                `Configure or view your logging parameters using the buttons below:`;

            const buttonMessage = {
                text: statusText,
                footer: "🔮 Sōsuke Aizen Cursed Log Assistant",
                buttons: [
                    { buttonId: `${config.prefix}gclog on`, buttonText: { displayText: "Enable 🟢" }, type: 1 },
                    { buttonId: `${config.prefix}gclog off`, buttonText: { displayText: "Disable 💤" }, type: 1 },
                    { buttonId: `${config.prefix}gclog clear`, buttonText: { displayText: "Clear Logs 🗑️" }, type: 1 },
                    { buttonId: `${config.prefix}gclog check`, buttonText: { displayText: "Aizen Summary 🔮" }, type: 1 }
                ],
                headerType: 1
            };

            return await sock.sendMessage(jid, buttonMessage, { quoted: msg });
        }

        // ─── CASE B: ENABLE LOGGING & INITIATE SCHEDULER (.gclog on) ───
        if (subCommand === 'on') {
            settings[jid] = 'on';
            saveSettings(settings);
            
            // Instantly start the 3-hour automated posting timer loop
            scheduleAutoSummary(jid);
            
            return await sock.sendMessage(jid, { 
                text: "🟢 *𝘓𝘰𝘨𝘨𝘪𝘯𝘨 𝘩𝘢𝘴 𝘣𝘦𝘦𝘯 𝘢𝘤𝘵𝘪𝘷𝘢𝘵𝘦𝘥 𝘧𝘰𝘳 𝘵𝘩𝘪𝘴 𝘨𝘳𝘰𝘶𝘱. 𝘈𝘶𝘵𝘰𝘮𝘢𝘵𝘦𝘥 3-𝘩𝘰𝘶𝘳 𝘴𝘶𝘮𝘮𝘢𝘳𝘪𝘦𝘴 𝘢𝘳𝘦 𝘯𝘰𝘸 𝘴𝘤𝘩𝘦𝘥𝘶𝘭𝘦𝘥.*" 
            }, { quoted: msg });
        }

        // ─── CASE C: DISABLE LOGGING & PURGE SCHEDULER (.gclog off) ───
        if (subCommand === 'off') {
            settings[jid] = 'off';
            saveSettings(settings);
            
            // Instantly clear and delete the active interval timer
            unscheduleAutoSummary(jid);
            
            return await sock.sendMessage(jid, { 
                text: "💤 *𝘓𝘰𝘨𝘨𝘪𝘯𝘨 𝘩𝘢𝘴 𝘣𝘦𝘦𝘯 𝘥𝘦𝘢𝘤𝘵𝘪𝘷𝘢𝘵𝘦𝘥 𝘧𝘰𝘳 𝘵𝘩𝘪𝘴 𝘨𝘳𝘰𝘶𝘱. 𝘈𝘶𝘵𝘰𝘮𝘢𝘵𝘦𝘥 3-𝘩𝘰𝘶𝘳 𝘴𝘶𝘮𝘮𝘢𝘳𝘪𝘦𝘴 𝘤𝘢𝘯𝘤𝘦𝘭𝘭𝘦𝘥.*" 
            }, { quoted: msg });
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