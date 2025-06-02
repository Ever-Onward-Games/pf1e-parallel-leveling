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
    console.log("Pf1e Parallel Leveling: Applying actor-level fractional bonus override");

    const originalPrepare = CONFIG.Actor.documentClass.prototype.prepareDerivedData;

    CONFIG.Actor.documentClass.prototype.prepareDerivedData = function () {
        originalPrepare.call(this);

        if (this.type !== "character") return;

        const useFractional = game.settings.get("pf1", "useFractionalBaseBonuses");
        if (!useFractional) return;

        console.log(`Pf1e Parallel Leveling: Recalculating BAB and saves for ${this.name}`);

        const classes = this.items.filter(i => i.type === "class" && i.system?.level > 0);

        // BAB stacking
        let goodBab = 0, medBab = 0, poorBab = 0;
        // Save stacking
        let fortGood = 0, fortPoor = 0;
        let refGood = 0, refPoor = 0;
        let willGood = 0, willPoor = 0;

        for (const cls of classes) {
            const level = cls.system.level ?? 0;

            // BAB
            switch (cls.system.bab) {
                case "high": goodBab = Math.max(goodBab, level); break;
                case "medium": medBab = Math.max(medBab, level - goodBab); break;
                case "low": poorBab = Math.max(poorBab, level - goodBab - medBab); break;
            }

            // Saving Throws
            const saves = cls.system.savingThrows ?? {};
            if (saves.fort?.value === "high") fortGood = Math.max(fortGood, level);
            else fortPoor = Math.max(fortPoor, level - fortGood);

            if (saves.ref?.value === "high") refGood = Math.max(refGood, level);
            else refPoor = Math.max(refPoor, level - refGood);

            if (saves.will?.value === "high") willGood = Math.max(willGood, level);
            else willPoor = Math.max(willPoor, level - willGood);
        }

        const fractional = {
            bab: Math.floor(goodBab + medBab * 0.75 + poorBab * 0.5),
            fort: Math.floor((fortGood > 0 ? 2 : 0) + fortGood / 2 + fortPoor / 3),
            ref: Math.floor((refGood > 0 ? 2 : 0) + refGood / 2 + refPoor / 3),
            will: Math.floor((willGood > 0 ? 2 : 0) + willGood / 2 + willPoor / 3),
        };

        console.log(`Pf1e Parallel Leveling: Final fractional bonuses for ${this.name}:`, fractional);

        // Inject custom overrides
        this.system.attributes.bab.total = fractional.bab;
        this.system.attributes.savingThrows.fort.base = fractional.fort;
        this.system.attributes.savingThrows.ref.base = fractional.ref;
        this.system.attributes.savingThrows.will.base = fractional.will;
    };
});

