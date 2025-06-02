console.log("Pf1e Parallel Leveling loaded.");

Hooks.once("ready", () => {
    console.log("Pf1e Parallel Leveling: 'ready' hook fired.");

    const characterSheets = CONFIG.Actor.sheetClasses?.["character"];
    if (!characterSheets) return console.error("Pf1e Parallel Leveling: No character sheet classes found in CONFIG.");

    const [sheetKey, sheetConfig] = Object.entries(characterSheets).find(
        ([key, val]) => key.includes("ActorSheetPFCharacter") && val?.cls
    ) || [];

    if (!sheetConfig?.cls) return console.error("Pf1e Parallel Leveling: Could not locate ActorSheetPFCharacter class.");

    const cls = sheetConfig.cls;
    const originalGetData = cls.prototype.getData;
    if (typeof originalGetData !== "function") return console.error("Pf1e Parallel Leveling: Original getData method not found!");

    cls.prototype.getData = async function (...args) {
        console.log(`Pf1e Parallel Leveling: getData called for actor "${this.actor?.name}"`);
        const data = await originalGetData.call(this, ...args);
        if (!data) return console.warn("Pf1e Parallel Leveling: getData returned no data") || data;
        data.levelUp = true;
        console.log("Pf1e Parallel Leveling: Forced data.levelUp = true");
        return data;
    };
});

function getXpForLevel(level, track, formula) {
    const xpTable = CONFIG.PF1.CHARACTER_EXP_LEVELS?.[track];

    const getRequiredXPFromFormula = (formula, level) => {
        try {
            const roll = new Roll(formula, { level });
            roll.evaluate({ async: false });
            return typeof roll.total === "number" && !isNaN(roll.total) ? roll.total : Number.MAX_SAFE_INTEGER;
        } catch (err) {
            console.warn("Pf1e Parallel Leveling: Error evaluating XP formula:", err);
            return Number.MAX_SAFE_INTEGER;
        }
    };

    if (track !== "custom") {
        if (!xpTable) return 1000;
        if (level < xpTable.length) return xpTable[level] - (level === 0 ? 0 : xpTable[level - 1]);
        return (xpTable[19] - xpTable[18]) * Math.pow(2, level - 19);
    } else {
        if (level < 20)
            return getRequiredXPFromFormula(formula, level + 1) - getRequiredXPFromFormula(formula, level);
        return (getRequiredXPFromFormula(formula, 20) - getRequiredXPFromFormula(formula, 19)) * Math.pow(2, level - 19);
    }
}

Hooks.on("renderActorSheetPFCharacter", (sheet, html) => {
    console.log("Pf1e Parallel Leveling: Hook fired for renderActorSheetPFCharacter.");
    const actor = sheet.actor;
    if (!actor) return;

    const xp = actor.system?.details?.xp?.value ?? 0;

    html.find(".experience .separator").remove();
    html.find(".experience .text-box.max").remove();

    let track = "medium", formula = "";
    try {
        const config = game.settings.get("pf1", "experienceConfig");
        track = config?.track ?? "medium";
        formula = config?.custom?.formula ?? "";
    } catch (err) {
        console.warn("Pf1e Parallel Leveling: Failed to get XP config", err);
    }

    html.find("button.level-up").each((_, btn) => {
        const $btn = $(btn);
        const classId = $btn.data("itemId");
        const classItem = actor.items.get(classId);
        if (!classItem) return;

        const currentLevel = classItem.system?.level ?? 0;
        const xpRequired = getXpForLevel(currentLevel, track, formula);
        const canLevel = xp >= xpRequired;

        $btn.prop("disabled", !canLevel);
        $btn.attr("title", canLevel ? "Click to level up" : `Requires ${xpRequired} XP`);
    });

    console.log("Pf1e Parallel Leveling: Finished processing actor sheet for", actor.name);
});

// 🧮 Deduct XP on level-up using preUpdateItem to avoid race conditions
Hooks.on("preUpdateItem", async (item, update, options, userId) => {
    if (item.type !== "class" || !item.actor || item.actor.type !== "character") return;

    const oldLevel = item.system?.level ?? 0;
    const newLevel = getProperty(update, "system.level");
    if (typeof newLevel !== "number" || newLevel <= oldLevel) return;

    console.log(`Pf1e Parallel Leveling: Detected level-up on "${item.name}" from ${oldLevel} → ${newLevel}`);

    const actor = item.actor;
    const currentXP = actor.system?.details?.xp?.value ?? 0;

    let track = "medium", formula = "";
    try {
        const config = game.settings.get("pf1", "experienceConfig");
        track = config?.track ?? "medium";
        formula = config?.custom?.formula ?? "";
    } catch (err) {
        console.warn("Pf1e Parallel Leveling: Could not retrieve XP config, defaulting to medium.");
    }

    const xpCost = getXpForLevel(oldLevel, track, formula);
    const newXP = Math.max(currentXP - xpCost, 0);

    console.log(`Pf1e Parallel Leveling: Deducting ${xpCost} XP. New XP will be: ${newXP}`);

    await actor.update({ "system.details.xp.value": newXP });
});
