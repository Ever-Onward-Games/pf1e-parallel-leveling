console.log("Pf1e Parallel Leveling loaded.");

Hooks.on("renderActorSheetPFCharacter", (sheet, html) => {
    const actor = sheet.actor;
    if (!actor) {
        console.warn("Pf1e Parallel Leveling: No actor found on sheet.");
        return;
    }

    console.log("Pf1e Parallel Leveling: Processing actor sheet for", actor.name);

    // Remove max XP cap display
    const xpSeparator = html.find(".experience .separator");
    const xpMax = html.find(".experience .text-box.max");
    if (xpSeparator.length && xpMax.length) {
        console.log("Pf1e Parallel Leveling: Removing XP max display.");
        xpSeparator.remove();
        xpMax.remove();
    } else {
        console.warn("Pf1e Parallel Leveling: XP max display elements not found.");
    }

    // Get current XP
    const xp = actor.system?.details?.xp?.value ?? 0;
    console.log("Pf1e Parallel Leveling: Current XP =", xp);

    // Determine XP track
    let track = "medium";
    try {
        const config = game.settings.get("pf1", "experienceConfig");
        track = config?.track ?? "medium";
        console.log("Pf1e Parallel Leveling: XP track =", track);
    } catch (err) {
        console.warn("Pf1e Parallel Leveling: Could not retrieve experienceConfig, defaulting to 'medium'.", err);
    }

    const progression = CONFIG?.PF1?.progression ?? {};
    const xpTable = progression[track];
    if (!xpTable) {
        console.error("Pf1e Parallel Leveling: XP table not found for track", track);
        return;
    }

    // Process Level Up buttons
    html.find("button.level-up").each((_, btn) => {
        const $btn = $(btn);
        const classId = $btn.data("itemId");
        console.log("Pf1e Parallel Leveling: Processing Level Up button for class ID =", classId);

        const classItem = actor.items.get(classId);
        if (!classItem) {
            console.warn("Pf1e Parallel Leveling: Class item not found for ID", classId);
            return;
        }

        const level = classItem.system.level ?? 0;
        const nextLevel = level + 1;
        const requiredXP = xpTable[nextLevel] ?? Number.MAX_SAFE_INTEGER;

        const canLevel = xp >= requiredXP;
        console.log(`Pf1e Parallel Leveling: ${classItem.name} Level ${level} → ${nextLevel}: Requires ${requiredXP} XP. Actor has ${xp} XP. Can level? ${canLevel}`);

        $btn.prop("disabled", !canLevel);
        $btn.attr("title", canLevel
            ? "Click to level up"
            : `Requires ${requiredXP} XP`);
    });
});
