console.log("Pf1e Parallel Leveling loaded.");

Hooks.on("renderActorSheetPFCharacter", (sheet, html) => {
    console.log("Pf1e Parallel Leveling: Hook fired for renderActorSheetPFCharacter.");

    const actor = sheet.actor;
    if (!actor) {
        console.warn("Pf1e Parallel Leveling: No actor found on sheet.");
        return;
    }

    console.log(`Pf1e Parallel Leveling: Processing actor sheet for "${actor.name}"`);

    // Remove max XP display
    const xpSeparator = html.find(".experience .separator");
    const xpMax = html.find(".experience .text-box.max");
    if (xpSeparator.length && xpMax.length) {
        console.log("Pf1e Parallel Leveling: Removing XP max display.");
        xpSeparator.remove();
        xpMax.remove();
    } else {
        console.warn("Pf1e Parallel Leveling: XP max display elements not found.");
    }

    // Actor XP
    const xp = actor.system?.details?.xp?.value ?? 0;
    console.log("Pf1e Parallel Leveling: Actor current XP =", xp);

    // XP Track (fast/medium/slow/custom)
    let track = "medium";
    let formula = "";
    try {
        const config = game.settings.get("pf1", "experienceConfig");
        track = config?.track ?? "medium";
        formula = config?.custom?.formula ?? "";
        console.log(`Pf1e Parallel Leveling: Retrieved XP track = "${track}"`);
        if (track === "custom") console.log("Pf1e Parallel Leveling: Custom formula =", formula);
    } catch (err) {
        console.warn("Pf1e Parallel Leveling: Error retrieving experience config, defaulting to 'medium'", err);
    }

    // XP delta calculator
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
                const delta = next - current;
                console.log(`Pf1e Parallel Leveling: [Track=${track}] XP from level ${level} to ${level + 1} = ${delta}`);
                return delta;
            } else {
                const lastDelta = xpTable[19] - xpTable[18];
                const epicLevel = level - 19;
                const epicXP = lastDelta * Math.pow(2, epicLevel);
                console.log(`Pf1e Parallel Leveling: Epic level ${level + 1}, XP delta = ${epicXP}`);
                return epicXP;
            }
        } else {
            const prevTotal = getRequiredXPFromFormula(formula, level);
            const nextTotal = getRequiredXPFromFormula(formula, level + 1);
            const delta = nextTotal - prevTotal;
            console.log(`Pf1e Parallel Leveling: [Custom] XP from level ${level} to ${level + 1} = ${delta}`);
            return delta;
        }
    };

    function getRequiredXPFromFormula(formula, level) {
        try {
            const roll = new Roll(formula, { level });
            roll.evaluate({ async: false });

            if (typeof roll.total === "number" && !isNaN(roll.total)) {
                console.log(`Pf1e Parallel Leveling: [Formula] Level ${level} requires total XP = ${roll.total}`);
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
            console.warn("Pf1e Parallel Leveling: Class item not found for ID", classId);
            return;
        }

        const currentLevel = classItem.system?.level ?? 0;
        const xpRequired = getXpForLevel(currentLevel);
        const canLevel = xp >= xpRequired;

        console.log(`Pf1e Parallel Leveling: ${classItem.name} (L${currentLevel}) needs ${xpRequired} XP to level up. Actor XP = ${xp}. Enable button? ${canLevel}`);

        $btn.prop("disabled", !canLevel);
        $btn.attr("title", canLevel ? "Click to level up" : `Requires ${xpRequired} XP`);
    });

    console.log("Pf1e Parallel Leveling: Finished processing actor sheet for", actor.name);
});
