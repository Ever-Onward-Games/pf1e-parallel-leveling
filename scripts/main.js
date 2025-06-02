console.log("Pf1e Parallel Leveling loaded.");

Hooks.once("ready", () => {
    console.log("Pf1e Parallel Leveling: 'ready' hook fired.");

    const characterSheets = CONFIG.Actor.sheetClasses?.["character"];
    if (!characterSheets) {
        console.error("Pf1e Parallel Leveling: No character sheet classes found in CONFIG.");
        return;
    }

    const [sheetKey, sheetConfig] = Object.entries(characterSheets).find(
        ([key, val]) => key.includes("ActorSheetPFCharacter") && val?.cls
    ) || [];

    if (!sheetConfig?.cls) {
        console.error("Pf1e Parallel Leveling: Could not locate ActorSheetPFCharacter class.");
        return;
    }

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
    if (!actor) return;

    const xp = actor.system?.details?.xp?.value ?? 0;
    const xpSeparator = html.find(".experience .separator");
    const xpMax = html.find(".experience .text-box.max");
    xpSeparator.remove();
    xpMax.remove();

    let track = "medium";
    let formula = "";
    try {
        const config = game.settings.get("pf1", "experienceConfig");
        track = config?.track ?? "medium";
        formula = config?.custom?.formula ?? "";
    } catch (err) {
        console.warn("Pf1e Parallel Leveling: Failed to get XP config", err);
    }

    const getRequiredXPFromFormula = (formula, level) => {
        try {
            const roll = new Roll(formula, { level });
            roll.evaluate({ async: false });
            return (typeof roll.total === "number" && !isNaN(roll.total)) ? roll.total : Number.MAX_SAFE_INTEGER;
        } catch {
            return Number.MAX_SAFE_INTEGER;
        }
    };

    const getXpForLevel = (level) => {
        const xpTable = CONFIG.PF1.CHARACTER_EXP_LEVELS?.[track];
        if (track !== "custom") {
            if (!xpTable) return 1000;
            if (level < xpTable.length) return xpTable[level] - (level === 0 ? 0 : xpTable[level - 1]);
            return (xpTable[19] - xpTable[18]) * Math.pow(2, level - 19);
        } else {
            if (level < 20)
                return getRequiredXPFromFormula(formula, level + 1) - getRequiredXPFromFormula(formula, level);
            return (getRequiredXPFromFormula(formula, 20) - getRequiredXPFromFormula(formula, 19)) * Math.pow(2, level - 19);
        }
    };

    html.find("button.level-up").each((_, btn) => {
        const $btn = $(btn);
        const classId = $btn.data("itemId");
        const classItem = actor.items.get(classId);
        if (!classItem) return;

        const currentLevel = classItem.system?.level ?? 0;
        const xpRequired = getXpForLevel(currentLevel);
        const canLevel = xp >= xpRequired;

        $btn.prop("disabled", !canLevel);
        $btn.attr("title", canLevel ? "Click to level up" : `Requires ${xpRequired} XP`);
    });

    console.log("Pf1e Parallel Leveling: Finished processing actor sheet for", actor.name);
});

// 🔄 Hook for XP deduction on actual level-up
Hooks.on("updateItem", async (item, update) => {
    if (item.type !== "class" || !item.actor || item.actor.type !== "character") return;

    const oldLevel = item.system?.level ?? 0;
    const newLevel = getProperty(update, "system.level");
    if (typeof newLevel !== "number" || newLevel <= oldLevel) return;

    const actor = item.actor;
    let track = "medium";
    let formula = "";
    try {
        const config = game.settings.get("pf1", "experienceConfig");
        track = config?.track ?? "medium";
        formula = config?.custom?.formula ?? "";
    } catch {}

    const getRequiredXPFromFormula = (formula, level) => {
        try {
            const roll = new Roll(formula, { level });
            roll.evaluate({ async: false });
            return (typeof roll.total === "number" && !isNaN(roll.total)) ? roll.total : Number.MAX_SAFE_INTEGER;
        } catch {
            return Number.MAX_SAFE_INTEGER;
        }
    };

    const getXpForLevel = (level) => {
        const xpTable = CONFIG.PF1.CHARACTER_EXP_LEVELS?.[track];
        if (track !== "custom") {
            if (!xpTable) return 1000;
            if (level < xpTable.length) return xpTable[level] - (level === 0 ? 0 : xpTable[level - 1]);
            return (xpTable[19] - xpTable[18]) * Math.pow(2, level - 19);
        } else {
            if (level < 20)
                return getRequiredXPFromFormula(formula, level + 1) - getRequiredXPFromFormula(formula, level);
            return (getRequiredXPFromFormula(formula, 20) - getRequiredXPFromFormula(formula, 19)) * Math.pow(2, level - 19);
        }
    };

    const xpCost = getXpForLevel(oldLevel);
    const currentXP = actor.system?.details?.xp?.value ?? 0;
    const newXP = Math.max(currentXP - xpCost, 0);

    console.log(`Pf1e Parallel Leveling: Detected level-up from ${oldLevel} → ${newLevel}. Deducting ${xpCost} XP. New XP: ${newXP}`);
    await actor.update({ "system.details.xp.value": newXP });
});
