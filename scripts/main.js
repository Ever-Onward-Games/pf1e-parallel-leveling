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

Hooks.once("init", () => {
    libWrapper.register(
        "pf1e-parallel-leveling",
        "pf1.documents.item.ItemClassPF.prototype.prepareDerivedData",
        function (wrapped) {
            wrapped.call(this);
            for (const save of ["fort", "ref", "will"]) {
                this.system.savingThrows[save].base = 0;
                this.system.savingThrows[save].good = false;
            }
        },
        "WRAPPER"
    );


    libWrapper.register(
        "pf1e-parallel-leveling",
        "pf1.documents.actor.abstract.BaseCharacterPF.prototype._prepareTypeChanges",
        function (wrapped) {
            wrapped.call(this); // Let other changes happen

            // Our custom logic starts here
            const classes = this.items.filter(i => i.type === "class" && i.system?.level > 0);
            const saves = { fort: { good: 0, poor: 0 }, ref: { good: 0, poor: 0 }, will: { good: 0, poor: 0 } };
            let goodBabLevel = 0, medBabLevel = 0, poorBabLevel = 0;

            for (const cls of classes) {
                const lvl = cls.system.level ?? 0;
                const bab = cls.system.bab;

                if (bab === "high") goodBabLevel = Math.max(goodBabLevel, lvl);
                else if (bab === "medium") medBabLevel = Math.max(medBabLevel, lvl - goodBabLevel);
                else if (bab === "low") poorBabLevel = Math.max(poorBabLevel, lvl - medBabLevel - goodBabLevel);

                for (const save of ["fort", "ref", "will"]) {
                    const isGood = cls.system.savingThrows?.[save]?.value === "high";
                    if (isGood) saves[save].good = Math.max(saves[save].good, lvl);
                    else saves[save].poor = Math.max(saves[save].poor, lvl - saves[save].good);
                }
            }

            const finalSaves = {};
            for (const save of ["fort", "ref", "will"]) {
                const good = saves[save].good;
                const poor = saves[save].poor;
                finalSaves[save] = Math.floor((good > 0 ? 2 : 0) + good / 2 + poor / 3);
            }

            const finalBAB = Math.floor(
                goodBabLevel + medBabLevel * 0.75 + poorBabLevel * 0.5
            );

            // Apply using standard method so tooltips reflect this
            this._addTypeChange("bab", goodBabLevel, {
                label: "Class Levels (High BAB)",
                type: "untyped",
                source: "ParallelLeveling"
            });

            this._addTypeChange("bab", medBabLevel * 0.75, {
                label: "Class Levels (Med BAB)",
                type: "untyped",
                source: "ParallelLeveling"
            });

            this._addTypeChange("bab", poorBabLevel * 0.5, {
                label: "Class Levels (Poor BAB)",
                type: "untyped",
                source: "ParallelLeveling"
            });

            for (const save of ["fort", "ref", "will"]) {
                this._addTypeChange(`saves.${save}`, saves[save].good, {
                    label: "Base Save (Good)",
                    type: "untyped",
                    source: "ParallelLeveling"
                });
            }

            for (const save of ["fort", "ref", "will"]) {
                this._addTypeChange(`saves.${save}`, saves[save].poor, {
                    label: "Base Save (Poor)",
                    type: "untyped",
                    source: "ParallelLeveling"
                });
            }

            console.log("Pf1e Parallel Leveling: Applied parallel BAB and saves", {
                bab: finalBAB,
                saves: finalSaves
            });
        },
        "WRAPPER"
    );
});

