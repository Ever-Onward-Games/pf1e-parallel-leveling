console.log("Pf1e Parallel Leveling loaded.");

Hooks.on("renderActorSheetPFCharacter", (sheet, html) => {
    const actor = sheet.actor;
    if (!actor) {
        console.warn("Pf1e Parallel Leveling: No actor found on sheet.");
        return;
    }

    console.log("Pf1e Parallel Leveling: Processing actor sheet for", actor.name);

    // Remove max XP display
    const xpSeparator = html.find(".experience .separator");
    const xpMax = html.find(".experience .text-box.max");
    if (xpSeparator.length && xpMax.length) {
        console.log("Pf1e Parallel Leveling: Removing XP max display.");
        xpSeparator.remove();
        xpMax.remove();
    } else {
        console.warn("Pf1e Parallel Leveling: XP max elements not found.");
    }

    // Actor XP
    const xp = actor.system?.details?.xp?.value ?? 0;
    console.log("Pf1e Parallel Leveling: Actor XP =", xp);

    // XP Track (fast/medium/slow/custom)
    let track = "medium";
    try {
        const config = game.settings.get("pf1", "experienceConfig");
        track = config?.track ?? "medium";
        console.log("Pf1e Parallel Leveling: XP track =", track);
    } catch (err) {
        console.warn("Pf1e Parallel Leveling: Defaulting XP track to medium due to error:", err);
    }

    const progression = game.system?.data?.config?.progression ?? CONFIG.PF1?.progression;
    const xpTable = progression?.[track];

    if (!xpTable) {
        console.error("Pf1e Parallel Leveling: No XP table found for track", track, "Progression data:", progression);
        return;
    }

    // Always show level-up buttons, disable based on XP
    html.find("button.level-up").each((_, btn) => {
        const $btn = $(btn);
        const classId = $btn.data("itemId");
        const classItem = actor.items.get(classId);
        if (!classItem) {
            console.warn("Pf1e Parallel Leveling: Class item not found:", classId);
            return;
        }

        const currentLevel = classItem.system?.level ?? 0;
        const nextLevel = currentLevel + 1;
        const requiredXP = xpTable[nextLevel] ?? Number.MAX_SAFE_INTEGER;
        const canLevel = xp >= requiredXP;

        console.log(`Pf1e Parallel Leveling: ${classItem.name} L${currentLevel} → L${nextLevel} requires ${requiredXP} XP. Actor has ${xp}. Button enabled? ${canLevel}`);

        $btn.prop("disabled", !canLevel);
        $btn.attr("title", canLevel ? "Click to level up" : `Requires ${requiredXP} XP`);
    });
});
