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
    let formula = "";
    try {
        const config = game.settings.get("pf1", "experienceConfig");
        track = config?.track ?? "medium";
        formula = config?.custom?.formula ?? "";
        console.log("Pf1e Parallel Leveling: XP track =", track);
    } catch (err) {
        console.warn("Pf1e Parallel Leveling: Defaulting XP track to medium due to error:", err);
    }

    // XP function
    const getXpForLevel = (level) => {
        const xpTables = CONFIG.PF1.CHARACTER_EXP_LEVELS;
        const xpTable = xpTables?.[track];

        if (track !== "custom") {
            if (!xpTable) {
                console.warn(`Pf1e Parallel Leveling: No XP table found for track "${track}"`);
                return 1000;
            }

            if (level < xpTable.length) {
                const current = level === 0 ? 0 : xpTable[level - 1];
                const next = xpTable[level];
                return next - current;
            } else {
                const lastDelta = xpTable[19] - xpTable[18];
                const epicLevel = level - 19;
                return lastDelta * Math.pow(2, epicLevel);
            }
        } else {
            if (level < 20) {
                return getRequiredXPFromFormula(formula, level + 1) - getRequiredXPFromFormula(formula, level);
            } else {
                const prevTotal = getRequiredXPFromFormula(formula, level);
                const nextTotal = getRequiredXPFromFormula(formula, level + 1);
                return nextTotal - prevTotal;
            }
        }
    };

    function getRequiredXPFromFormula(formula, level) {
        try {
            const roll = new Roll(formula, { level });
            roll.evaluate({ async: false });

            if (typeof roll.total === "number" && !isNaN(roll.total)) {
                return roll.total;
            } else {
                console.warn("Pf1e Parallel Leveling: Formula produced non-numeric result:", roll);
                return Number.MAX_SAFE_INTEGER;
            }
        } catch (err) {
            console.error("Pf1e Parallel Leveling: Error evaluating XP formula:", err);
            return Number.MAX_SAFE_INTEGER;
        }
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
        const xpRequired = getXpForLevel(currentLevel);
        const canLevel = xp >= xpRequired;

        console.log(`Pf1e Parallel Leveling: ${classItem.name} L${currentLevel} → L${currentLevel + 1} requires ${xpRequired} XP. Actor has ${xp}. Button enabled? ${canLevel}`);

        $btn.prop("disabled", !canLevel);
        $btn.attr("title", canLevel ? "Click to level up" : `Requires ${xpRequired} XP`);
    });
});
