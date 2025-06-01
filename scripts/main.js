console.log("Pf1e Parallel Leveling loaded.");

Hooks.on("renderActorSheetPFCharacter", async (sheet, html, data) => {
    const actor = sheet.actor;
    if (!actor) return console.warn("Pf1e Parallel Leveling: No actor found on sheet.");

    console.log("Pf1e Parallel Leveling: Processing sheet for", actor.name);

    // Remove max XP display
    html.find(".experience .separator").remove();
    html.find(".experience .text-box.max").remove();

    const xp = actor.system?.details?.xp?.value ?? 0;
    console.log("Pf1e Parallel Leveling: Actor XP =", xp);

    // XP config
    let track = "medium";
    let formula = "";
    try {
        const config = game.settings.get("pf1", "experienceConfig");
        track = config?.track ?? "medium";
        formula = config?.custom?.formula ?? "";
        console.log(`Pf1e Parallel Leveling: XP track = "${track}"`, formula ? `(formula: ${formula})` : "");
    } catch (err) {
        console.warn("Pf1e Parallel Leveling: Error reading experience config, defaulting to medium.", err);
    }

    // --- Get XP needed to level up a class from level N to N+1
    function getXpForLevel(level) {
        if (track !== "custom") {
            const xpTables = CONFIG.PF1.CHARACTER_EXP_LEVELS;
            const xpTable = xpTables?.[track];
            if (!xpTable) {
                console.warn(`Pf1e Parallel Leveling: No XP table found for track "${track}"`);
                return 1000;
            }

            if (level < xpTable.length) {
                const delta = xpTable[level] - (xpTable[level - 1] ?? 0);
                console.log(`Pf1e Parallel Leveling: [Track=${track}] XP from level ${level} to ${level + 1} = ${delta}`);
                return delta;
            } else {
                // Epic progression: double previous delta
                const lastDelta = xpTable[19] - xpTable[18];
                const epicLevel = level - 19;
                const epicXP = lastDelta * Math.pow(2, epicLevel);
                console.log(`Pf1e Parallel Leveling: Epic XP for level ${level + 1} = ${epicXP}`);
                return epicXP;
            }

        } else {
            // Custom XP formula
            if (!formula || typeof formula !== "string") {
                console.warn("Pf1e Parallel Leveling: No custom formula provided, using fallback.");
                return 1000;
            }

            if (level <= 20) {
                return getRequiredXPFromFormula(formula, level + 1) - getRequiredXPFromFormula(formula, level);
            } else {
                const baseDelta = getRequiredXPFromFormula(formula, 20) - getRequiredXPFromFormula(formula, 19);
                const epicLevel = level - 19;
                const epicXP = baseDelta * Math.pow(2, epicLevel);
                console.log(`Pf1e Parallel Leveling: Epic custom XP for level ${level + 1} = ${epicXP}`);
                return epicXP;
            }
        }
    }

    // --- Evaluate formula-based XP for given level
    function getRequiredXPFromFormula(formula, level) {
        try {
            const roll = new Roll(formula, { level });
            roll.evaluate({ async: false });
            if (typeof roll.total === "number" && !isNaN(roll.total)) {
                console.log(`Pf1e Parallel Leveling: Custom XP formula result for level ${level} = ${roll.total}`);
                return roll.total;
            } else {
                console.warn("Pf1e Parallel Leveling: Invalid result from formula", roll);
                return Number.MAX_SAFE_INTEGER;
            }
        } catch (err) {
            console.error("Pf1e Parallel Leveling: Error evaluating formula:", err);
            return Number.MAX_SAFE_INTEGER;
        }
    }

    // Process each class row and inject/update level up buttons
    const classRows = html.find("table.class-list tbody tr");
    classRows.each((_, row) => {
        const $row = $(row);
        const classId = $row.data("itemId");
        if (!classId) return;

        const classItem = actor.items.get(classId);
        if (!classItem) {
            console.warn("Pf1e Parallel Leveling: Missing class item", classId);
            return;
        }

        const level = classItem.system?.level ?? 0;
        const requiredXP = getXpForLevel(level);
        const canLevel = xp >= requiredXP;

        console.log(`Pf1e Parallel Leveling: ${classItem.name} (L${level}) requires ${requiredXP} XP → Can level? ${canLevel}`);

        let $btn = $row.find("button.level-up");
        if ($btn.length === 0) {
            $btn = $(`<button type="button" class="level-up"><i class="fas fa-plus"></i></button>`);
            $row.find("td:last").append($btn);
            console.log(`Pf1e Parallel Leveling: Injected Level Up button for class ${classItem.name}`);
        }

        $btn.prop("disabled", !canLevel);
        $btn.attr("title", canLevel ? "Click to level up" : `Requires ${requiredXP} XP`);
    });

    console.log("Pf1e Parallel Leveling: Finished processing actor sheet.");
});
