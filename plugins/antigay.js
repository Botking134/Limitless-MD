// ─── ANTISPAM RATE-LIMIT ──────────────────────────────────
        const antispamConfig = config.antispam?.[jid];
        if (isGroup && antispamConfig && antispamConfig.status === 'on' && !isAuthorized && !msg.key.fromMe && !isDev) {
            // ... (keep existing antispam logic)
        }

        // ─── ANTIGAY INTERCEPTOR (Modular Hook) ───────────────────
        try {
            const { handleAntiGayInterceptor } = require('../plugins/antigay');
            const wasIntercepted = await handleAntiGayInterceptor(sock, msg, contextInfo, mentionedJids);
            if (wasIntercepted) return;
        } catch (interceptErr) {
            console.error("[ANTIGAY HOOK ERROR]", interceptErr.message);
        }