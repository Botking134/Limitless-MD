// plugins/gclog.js
// GCLOG Command Module — Automatic 3-Hour Conversation Summarizer
// Leverages helpers/Summary.js and handles group configuration states

const config = require('../config');
const { cleanJid } = require('../helpers/Message'); // Adjust the path if cleanJid is located elsewhere
const { 
    readGcLogs, 
    saveGcLogs, 
    queryGroq, 
    triggerSummary 
} = require('../helpers/Summary');

module.exports = {
    name: 'gclog',
    isPrefixless: false,
    category: 'admin',
    permission: 'public', // Set to public since permissions are checked inside execute
    execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
        const jid = msg.key.remoteJid;
        const isGroup = jid.endsWith('@g.us');
        
        // Guard Check: GCLOG only functions inside Group Chats
        if (!isGroup) {
            return await sock.sendMessage(jid, { 
                text: "❌ This command is restricted to group chats only." 
            }, { quoted: msg });
        }

        // Direct Boolean Permission Validation (Bypasses missing verifyPermissions)
        const isAuthorized = isOwner || isSudo || isDev;
        if (!isAuthorized) {
            return await sock.sendMessage(jid, { 
                text: "❌ You are not authorized to configure group logs." 
            }, { quoted: msg });
        }

        const cleanChatJid = cleanJid(jid);

        // Ensure config tracking container is initialized
        if (!config.gclogActive) config.gclogActive = {};

        // Parse action
        let action = args ? args.toLowerCase().trim() : '';

        // Fallback: If no action argument is specified, check for legacy or interactive button responses
        if (!action) {
            const getRawMessage = (message) => {
                if (!message) return null;
                if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
                if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
                return message;
            };

            const rawMsg = getRawMessage(msg.message);
            const buttonId = rawMsg?.buttonsResponseMessage?.selectedButtonId ||
                             rawMsg?.templateButtonReplyMessage?.selectedId ||
                             '';
            if (buttonId) {
                const parts = buttonId.split(' ');
                if (parts.length > 1) {
                    action = parts[1]?.toLowerCase() || '';
                }
            }
        }

        // ─── STATE 1: DISPLAY CONFIGURATION MENU ───
        if (!action) {
            const current = config.gclogActive[cleanChatJid] ? 'on' : 'off';
            const activeStatus = current === 'on' ? "Active 🟢" : "Inactive 💤";
            
            const prompt = `📊 *Group Chat Log (GCLOG) Configuration:*\n\n` +
                           `• *Status:* \`${activeStatus}\`\n\n` +
                           `Select an option below or type the command manually:`;

            const buttonMessage = {
                text: prompt,
                buttons: [
                    { buttonId: `${config.prefix}gclog on`, buttonText: { displayText: 'Turn On 🟢' }, type: 1 },
                    { buttonId: `${config.prefix}gclog off`, buttonText: { displayText: 'Turn Off 💤' }, type: 1 },
                    { buttonId: `${config.prefix}gclog check`, buttonText: { displayText: 'Check Log 📊' }, type: 1 }
                ],
                headerType: 1
            };

            try {
                // Sends interactive buttons if supported by client
                return await sock.sendMessage(cleanChatJid, buttonMessage, { quoted: msg });
            } catch (e) {
                // Plain-text menu fallback for devices that do not support legacy button syntax
                return await sock.sendMessage(cleanChatJid, { 
                    text: `${prompt}\n\n• \`${config.prefix}gclog on\`\n• \`${config.prefix}gclog off\`\n• \`${config.prefix}gclog check\`` 
                }, { quoted: msg });
            }
        }

        // ─── STATE 2: ACTIVATE AUTOMATED WINDOW ───
        if (action === 'on') {
            config.gclogActive[cleanChatJid] = true;
            
            // Clear existing memory tracker interval for this group to avoid duplicate schedules
            if (global.gclogIntervals && global.gclogIntervals[cleanChatJid]) {
                clearInterval(global.gclogIntervals[cleanChatJid]);
            }

            global.gclogIntervals = global.gclogIntervals || {};
            
            // Define 3-hour summary cycle (3 hours * 60 minutes * 60 seconds * 1000 milliseconds)
            global.gclogIntervals[cleanChatJid] = setInterval(async () => {
                await triggerSummary(sock, cleanChatJid);
            }, 3 * 60 * 60 * 1000);

            await sock.sendMessage(cleanChatJid, { 
                text: "🔒 *GCLOG Activated. A Satoru Gojo 10‑point summary will be generated every 3 hours.*" 
            }, { quoted: msg });

            // LAZY-LOADING FIX: Dynamically load stateManager to execute saveState()
            // This prevents Circular Dependency (require loop) crashes at runtime
            require('../stateManager').saveState();
            return;
        }

        // ─── STATE 3: DEACTIVATE AUTOMATED WINDOW ───
        if (action === 'off') {
            if (global.gclogIntervals && global.gclogIntervals[cleanChatJid]) {
                clearInterval(global.gclogIntervals[cleanChatJid]);
                delete global.gclogIntervals[cleanChatJid];
            }
            
            config.gclogActive[cleanChatJid] = false;
            
            // Wipe stored historical logs for this group
            const logsToClear = readGcLogs();
            logsToClear[cleanChatJid] = [];
            saveGcLogs(logsToClear);

            await sock.sendMessage(cleanChatJid, { 
                text: "🔓 *GCLOG Deactivated. Automated timers cleared and log file reset.*" 
            }, { quoted: msg });

            // LAZY-LOADING FIX: Prevent Circular Dependency loops
            require('../stateManager').saveState();
            return;
        }

        // ─── STATE 4: MANUAL SUMMARY PREVIEW ───
        if (action === 'check') {
            const currentLogs = readGcLogs();
            const logs = currentLogs[cleanChatJid] || [];
            
            if (logs.length === 0) {
                return await sock.sendMessage(cleanChatJid, { 
                    text: "📊 No logs found within the current 3‑hour window." 
                }, { quoted: msg });
            }

            // Provide immediate feedback to the chat
            const statusMsg = await sock.sendMessage(cleanChatJid, { 
                text: "⏳ *Satoru Gojo is reading through the logs...*" 
            }, { quoted: msg });

            // Compile logs to string
            const logString = logs.map(l => `[${new Date(l.time).toLocaleTimeString()}] ${l.sender}: ${l.text}`).join('\n');
            const promptMsg = "You are Satoru Gojo, the strongest Jujutsu Sorcerer. Summarize these group conversation logs. You must output exactly 10 bullet points. Keep your tone playful, informal, cocky, and teasing (as Satoru Gojo). Do not include any intro, outro, or conversational filler.";

            try {
                // Call Groq using the token-efficient Llama-3.1 model
                const responseText = await queryGroq([
                    { role: "system", content: "You are Satoru Gojo." },
                    { role: "user", content: `${promptMsg}\n\nHere are the chat logs:\n${logString}` }
                ], "llama-3.1-8b-instant");

                if (responseText) {
                    await sock.sendMessage(cleanChatJid, {
                        text: `🤞 *LIMITLESS DOMAIN CONVERSATION PREVIEW (Current Window):*\n\n${responseText.trim()}`,
                        edit: statusMsg.key
                    });
                } else {
                    throw new Error("Groq API returned an empty completion response.");
                }
            } catch (err) {
                console.error("[GCLOG] Manual preview summary failed:", err);
                await sock.sendMessage(cleanChatJid, {
                    text: `❌ *Summary generation error:*\n${err.message}`,
                    edit: statusMsg.key
                });
            }
            return;
        }

        // Catch-all fallback
        await sock.sendMessage(cleanChatJid, { 
            text: `❌ Unknown action: \`${action}\`. Use \`on\`, \`off\`, or \`check\`.` 
        }, { quoted: msg });
    }
};