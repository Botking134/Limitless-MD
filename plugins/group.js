// 28. TIMED KICK CONTROLLER (.tkick) (Issue 1 Repaired)
    {
        name: 'tkick',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            try {
                const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner);
                if (!isAuthorized) return await sock.sendMessage(jid, { text: "❌ Admin rights required." }, { quoted: msg });

                const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                const targets = mentions.length > 0 ? mentions : [parseTargetUser(msg, args)];

                const cleanTargets = targets.filter(t => t && t.split('@')[0] !== settings.ownerNumber);

                // If no targets are mentioned, display pending timers status
                if (cleanTargets.length === 0) {
                    const activeKeys = Object.keys(global.tkickTimers).filter(k => k.startsWith(jid));
                    if (activeKeys.length === 0) {
                        return await sock.sendMessage(jid, { text: "❌ No pending timed kicks running in this domain." }, { quoted: msg });
                    }

                    let list = "⏳ *PENDING TIMED KICKS:*\n━━━━━━━━━━━━━━━━━━━\n\n";
                    activeKeys.forEach((key, idx) => {
                        const task = global.tkickTimers[key];
                        const remainingSec = Math.max(0, Math.floor((task.endTime - Date.now()) / 1000));
                        list += `${idx + 1}. @${task.targetJid.split('@')[0]} — Remaining: *${remainingSec}s*\n`;
                    });

                    // Single button to cancel all pending kicks in this group
                    const buttonMessage = {
                        text: list,
                        buttons: [
                            { buttonId: `${settings.prefix}tkick_cancel_all`, buttonText: { displayText: 'Cancel All Kicks' }, type: 1 }
                        ],
                        headerType: 1,
                        mentions: activeKeys.map(k => global.tkickTimers[k].targetJid)
                    };

                    try {
                        return await sock.sendMessage(jid, buttonMessage, { quoted: msg });
                    } catch (e) {
                        return await sock.sendMessage(jid, { text: list, mentions: activeKeys.map(k => global.tkickTimers[k].targetJid) }, { quoted: msg });
                    }
                }

                // Parse duration from text arguments (e.g. 10s, 5m, etc.)
                const durationString = args.replace(/@[^ ]+/g, '').trim().split(' ')[0] || '';
                const durationMs = parseDuration(durationString);

                if (!durationMs) {
                    return await sock.sendMessage(jid, { text: `❌ Please provide a valid duration string (e.g. \`10s\`, \`5m\`).` }, { quoted: msg });
                }

                // Register Timers
                for (const target of cleanTargets) {
                    const timerKey = `${jid}_${target}`;
                    
                    if (global.tkickTimers[timerKey]) {
                        clearTimeout(global.tkickTimers[timerKey].timeoutId);
                    }

                    const timeoutId = setTimeout(async () => {
                        try {
                            await sock.groupParticipantsUpdate(jid, [target], "remove");
                            await sock.sendMessage(jid, { text: `🌪️ *Timer Elapsed.* Exorcising member: @${target.split('@')[0]}`, mentions: [target] });
                        } catch (err) {}
                        delete global.tkickTimers[timerKey];
                    }, durationMs);

                    global.tkickTimers[timerKey] = {
                        timeoutId,
                        targetJid: target,
                        endTime: Date.now() + durationMs
                    };
                }

                await sock.sendMessage(jid, {
                    text: `⏳ Registered timed kick for *${cleanTargets.length}* member(s).\n\n*Delay:* ${durationString}`,
                    mentions: cleanTargets
                }, { quoted: msg });

            } catch (e) {
                console.error(e);
            }
        }
    },

    // 29. CANCEL ALL TIMED KICKS IN GROUP (.tkick_cancel_all / mapped from button) (Issue 1 Repaired)
    {
        name: 'tkick_cancel_all',
        isPrefixless: true,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner);
            if (!isAuthorized) return;

            const activeKeys = Object.keys(global.tkickTimers).filter(k => k.startsWith(jid));

            if (activeKeys.length === 0) {
                return await sock.sendMessage(jid, { text: "❌ No pending timed kicks found to cancel." }, { quoted: msg });
            }

            activeKeys.forEach(key => {
                clearTimeout(global.tkickTimers[key].timeoutId);
                delete global.tkickTimers[key];
            });

            await sock.sendMessage(jid, { text: "✅ Successfully cancelled all pending timed kicks in this group." }, { quoted: msg });
        }
    },