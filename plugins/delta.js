// ─── UNIVERSAL COMMAND EXECUTOR ──────────────────────────────────
async function executeCommand(tag, sock, msg, userContext) {
    const registry = getRegistry();
    const { command, args } = tag;
    
    // 1. Locate the command in the registry
    const entry = registry[command] || registry[`.${command}`];
    if (!entry) {
        console.warn(`[DELTA] Command not found in active registry: "${command}". Ensure this command exists in your bot.`);
        return null;
    }

    const meta = entry.metadata || entry;
    const { isOwner, isDev, isSudo } = userContext;
    let allowed = false;
    const perm = meta.permission || 'public';

    // 2. Enforce standard permissions
    if (perm === 'public') allowed = true;
    else if (perm === 'sudo' && (isSudo || isDev || isOwner)) allowed = true;
    else if (perm === 'dev' && (isDev || isOwner)) allowed = true;
    else if (perm === 'owner' && (isOwner || isDev)) allowed = true;

    if (!allowed) {
        console.warn(`[DELTA] Permission denied for execution of: ${command}`);
        return null;
    }

    // 3. Create a highly compatible context object (supports almost all WA bot frameworks)
    const formattedArgs = args ? args.split(/\s+/) : [];
    const executionContext = {
        args: formattedArgs,
        text: args,
        prefix: '.',
        command: command,
        isOwner,
        isDev,
        isSudo,
        ...userContext
    };

    try {
        console.log(`[DELTA] Attempting execution of: "${command}" with args: "${args}"`);
        
        // We pass the context object, raw string, and user details to satisfy any framework structure
        await entry.execute(sock, msg, executionContext, args, userContext);
        
        return true;
    } catch (err) {
        console.error(`[DELTA] Execution failed for command "${command}":`, err.message);
        return false;
    }
}