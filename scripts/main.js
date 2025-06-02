console.log("Pf1e Parallel Leveling loaded.");

Hooks.once("ready", () => {
    console.log("Pf1e Parallel Leveling: 'ready' hook fired.");

    const characterSheets = CONFIG.Actor.sheetClasses?.["character"];
    if (!characterSheets) {
        console.error("Pf1e Parallel Leveling: No character sheet classes found in CONFIG.");
        return;
    }

    console.log("Pf1e Parallel Leveling: Retrieved characterSheets:", characterSheets);

    // Dynamically find the ActorSheetPFCharacter entry
    const [sheetKey, sheetConfig] = Object.entries(characterSheets).find(
        ([key, val]) => key.includes("ActorSheetPFCharacter") && val?.cls
    ) || [];

    if (!sheetConfig?.cls) {
        console.error("Pf1e Parallel Leveling: Could not locate ActorSheetPFCharacter class.");
        return;
    }

    console.log(`Pf1e Parallel Leveling: Found ActorSheetPFCharacter as "${sheetKey}"`);

    const cls = sheetConfig.cls;
    const originalGetData = cls.prototype.getData;

    if (typeof originalGetData !== "function") {
        console.error("Pf1e Parallel Leveling: Original getData method not found!");
        return;
    }

    console.log("Pf1e Parallel Leveling: Overriding getData to force levelUp = true");

    cls.prototype.getData = async function (...args) {
        console.log(`Pf1e Parallel Leveling: getData called for actor "${this.actor?.name}"`);

        const data = await originalGetData.call(this, ...args);

        if (!data) {
            console.warn("Pf1e Parallel Leveling: getData returned no data");
            return data;
        }

        data.levelUp = true;
        console.log("Pf1e Parallel Leveling: Forced data.levelUp = true");

        return data;
    };
});



Hooks.on("renderActorSheetPFCharacter", (sheet, html) => {
    console.log("Pf1e Parallel Leveling: Hook fired for renderActorSheetPFCharacter.");

    const actor = sheet.actor;
    if (!actor) {
        console.warn("Pf1e Parallel Leveling: No actor found on sheet.");
        return;
    }

    console.log(`Pf1e Parallel Leveling: Processing actor sheet for "${actor.name}"`);

    const xpField = actor.system?.details?.xp;
    const xp = xpField?.value ?? 0;

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

    console.log("Pf1e Parallel Leveling: Actor current XP =", xp);

    // Track and formula
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

    const getRequiredXPFromFormula = (formula, level) => {
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
    };

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
            }
            const lastDelta = xpTable[19] - xpTable[18];
            const epicLevel = level - 19;
            const epicXP = lastDelta * Math.pow(2, epicLevel);
            console.log(`Pf1e Parallel Leveling: Epic level ${level + 1}, XP delta = ${epicXP}`);
            return epicXP;
        } else {
            if (level < 20) {
                const prevTotal = getRequiredXPFromFormula(formula, level);
                const nextTotal = getRequiredXPFromFormula(formula, level + 1);
                const delta = nextTotal - prevTotal;
                console.log(`Pf1e Parallel Leveling: [Custom] XP from level ${level} to ${level + 1} = ${delta}`);
                return delta;
            }
            const prevTotal = getRequiredXPFromFormula(formula, 19);
            const nextTotal = getRequiredXPFromFormula(formula, 20);
            const delta = nextTotal - prevTotal;
            const epicLevel = level - 19;
            console.log(`Pf1e Parallel Leveling: [Custom] Epic level XP delta = ${delta * Math.pow(2, epicLevel)}`);
            return delta * Math.pow(2, epicLevel);
        }
    };

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

        // If button is clickable, hook post-level check
        if (canLevel) {
            $btn.off("click.pf1e-parallel-leveling").on("click.pf1e-parallel-leveling", async () => {
                console.log(`Pf1e Parallel Leveling: ${classItem.name} level-up click intercepted. Watching for XP deduction.`);

                const beforeLevel = classItem.system?.level ?? 0;
                console.log(`Pf1e Parallel Leveling: ${classItem.name} current level before click = ${beforeLevel}`);

                // Wait and recheck
                setTimeout(async () => {
                    const updatedItem = actor.items.get(classId);
                    const afterLevel = updatedItem?.system?.level ?? beforeLevel;

                    if (afterLevel > beforeLevel) {
                        const xpNow = actor.system?.details?.xp?.value ?? 0;
                        const xpCost = getXpForLevel(beforeLevel);
                        const xpNew = Math.max(xpNow - xpCost, 0);

                        console.log(`Pf1e Parallel Leveling: ${classItem.name} leveled from ${beforeLevel} → ${afterLevel}. Deducting ${xpCost} XP. New XP = ${xpNew}`);

                        await actor.update({ "system.details.xp.value": xpNew });
                    } else {
                        console.warn(`Pf1e Parallel Leveling: No level increase detected for ${classItem.name}. No XP deducted.`);
                    }
                }, 300); // Let Foundry finish its internal update
            });
        }
    });

    console.log("Pf1e Parallel Leveling: Finished processing actor sheet for", actor.name);
});