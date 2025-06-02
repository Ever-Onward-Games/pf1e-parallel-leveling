console.log("Pf1e Parallel Leveling loaded.");

// ───────────────────────────────────────────────────────────
// 🧰 Utility: Calculate XP cost for leveling
function getXpForLevel(level, track = "medium", formula = "") {
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

// ───────────────────────────────────────────────────────────
// 🧰 Utility: Deduct XP from actor safely
async function deductXpFromActor(actor, amount, reason = "") {
    const currentXP = actor.system?.details?.xp?.value ?? 0;
    const newXP = Math.max(currentXP - amount, 0);
    console.log(`Pf1e Parallel Leveling: Deducting ${amount} XP from "${actor.name}" (${reason}). New XP: ${newXP}`);
    await actor.update({ "system.details.xp.value": newXP });
}

// ───────────────────────────────────────────────────────────
// 📦 Sheet Patch: Force levelUp = true
Hooks.once("ready", () => {
    console.log("Pf1e Parallel Leveling: 'ready' hook fired.");

    const characterSheets = CONFIG.Actor.sheetClasses?.["character"];
    if (!characterSheets) return console.error("Pf1e Parallel Leveling: No character sheet classes found in CONFIG.");

    const [_, sheetConfig] = Object.entries(characterSheets).find(
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

// ───────────────────────────────────────────────────────────
// 🎛️ UI: Level-up logic and XP gate
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

// ───────────────────────────────────────────────────────────
// 🧾 Deduct XP on actual level-up (pre-update hook avoids races)
Hooks.on("preUpdateItem", async (item, update) => {
    if (item.type !== "class" || !item.actor || item.actor.type !== "character") return;

    const oldLevel = item.system?.level ?? 0;
    const newLevel = getProperty(update, "system.level");
    if (typeof newLevel !== "number" || newLevel <= oldLevel) return;

    const actor = item.actor;

    let track = "medium", formula = "";
    try {
        const config = game.settings.get("pf1", "experienceConfig");
        track = config?.track ?? "medium";
        formula = config?.custom?.formula ?? "";
    } catch {}

    const xpCost = getXpForLevel(oldLevel, track, formula);
    await deductXpFromActor(actor, xpCost, `level-up from ${oldLevel} → ${newLevel}`);
});

// ───────────────────────────────────────────────────────────
// 🧪 New Class: Deduct XP when adding a level 1 base class
Hooks.on("createItem", async (item) => {
    if (item.type !== "class" || !item.actor || item.actor.type !== "character") return;

    const classLevel = item.system?.level ?? 0;
    if (classLevel !== 1) return;

    const actor = item.actor;

    let track = "medium", formula = "";
    try {
        const config = game.settings.get("pf1", "experienceConfig");
        track = config?.track ?? "medium";
        formula = config?.custom?.formula ?? "";
    } catch {}

    const fullCost = getXpForLevel(1, track, formula);
    const halfCost = Math.floor(fullCost / 2);

    await deductXpFromActor(actor, halfCost, `new level 1 class "${item.name}"`);
});

Hooks.once("ready", () => {
    console.log("Pf1e Parallel Leveling: Applying fractional bonus override.");

    const originalPrepareDerivedData = CONFIG.Actor.documentClass.prototype.prepareDerivedData;

    CONFIG.Actor.documentClass.prototype.prepareDerivedData = function () {
        let classes = [];
        let classData = {
            level: 0,
            babLevels: { high: 0, medium: 0, low: 0 },
            saves: {
                fort: { good: 0, poor: 0 },
                ref: { good: 0, poor: 0 },
                will: { good: 0, poor: 0 }
            }
        };
        let fractional = {
            bab: 0,
            fort: 0,
            ref: 0,
            will: 0
        };
        const useFractional = game.settings.get("pf1", "useFractionalBaseBonuses");
        if(this.type === "character" && useFractional) {
            classes = this.items.filter(i => i.type === "class" && i.system?.level > 0);

            classData = classes.reduce((acc, cls) => {
                acc.level = Math.max(acc.level, cls.system.level ?? 0);

                // BAB breakdown
                switch (cls.system.bab) {
                    case "high": acc.babLevels.high = Math.max(acc.babLevels.high, level); break;
                    case "medium": acc.babLevels.medium = Math.max(acc.babLevels.medium, level); break;
                    case "low": acc.babLevels.low= Math.max(acc.babLevels.low, level); break;
                }

                // Saves
                const s = cls.system.savingThrows;
                if (!s) return acc;

                for (const key of ["fort", "ref", "will"]) {
                    const saveType = s[key]?.value;
                    if (saveType === "high") acc.saves[key].good = Math.max(acc.saves[key].good, level);
                    else if (saveType === "low" || saveType === "poor") acc.saves[key].poor = Math.max(acc.saves[key].poor, level);
                }

                return acc;
            }, classData);

            classData.babLevels.medium = Math.max(classData.babLevels.medium - classData.babLevels.high, 0);
            classData.babLevels.low = Math.max(classData.babLevels.low - classData.babLevels.medium - classData.babLevels.high, 0);
            classData.saves.fort.poor = Math.max(classData.saves.fort.poor - classData.saves.fort.good, 0);
            classData.saves.ref.poor = Math.max(classData.saves.ref.poor - classData.saves.ref.good, 0);
            classData.saves.will.poor = Math.max(classData.saves.will.poor - classData.saves.will.good, 0);

            this.system.details.level = classData.level;

            this.system.attributes ??= {};
            this.system.attributes.bab ??= {};
            this.system.attributes.savingThrows ??= {};
            this.system.attributes.savingThrows.fort ??= {};
            this.system.attributes.savingThrows.ref ??= {};
            this.system.attributes.savingThrows.will ??= {};

            fractional = {
                bab: Math.floor(classData.babLevels.high + 0.75 * babLevels.medium + 0.5 * babLevels.low),
                fort: Math.floor((saves.fort.good > 0 ? 2 : 0) + saves.fort.good / 2 + saves.fort.poor / 3),
                ref: Math.floor((saves.ref.good > 0 ? 2 : 0) + saves.ref.good / 2 + saves.ref.poor / 3),
                will: Math.floor((saves.will.good > 0 ? 2 : 0) + saves.will.good / 2 + saves.will.poor / 3)
            };
            console.log("Pf1e Parallel Leveling: Calculated fractional bonuses:", fractional);

            this.system.attributes.bab.total = fractional.bab;
            this.system.attributes.savingThrows.fort.base = fractional.fort;
            this.system.attributes.savingThrows.ref.base = fractional.ref;
            this.system.attributes.savingThrows.will.base = fractional.will;
        }

        originalPrepareDerivedData.call(this);
    };
});
