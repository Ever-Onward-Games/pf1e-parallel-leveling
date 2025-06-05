console.log("Pf1e Parallel Leveling loaded.");

const pf1eParallelLeveling = {
    // ───────────────────────────────────────────────────────────
    // 🧰 Utility: Calculate XP cost for leveling
    getXpForLevel: (level, track = "medium", formula = "") => {
        const xpTable = CONFIG.PF1.CHARACTER_EXP_LEVELS?.[track];

        const getRequiredXPFromFormula = (formula, level) => {
            try {
                const roll = new Roll(formula, {level});
                roll.evaluate({async: false});
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
    },

    // ───────────────────────────────────────────────────────────
    // 🧰 Utility: Deduct XP from actor safely
    deductXpFromActor: async (actor, amount, reason = "") => {
        const currentXP = actor.system?.details?.xp?.value ?? 0;
        const newXP = Math.max(currentXP - amount, 0);
        console.log(`Pf1e Parallel Leveling: Deducting ${amount} XP from "${actor.name}" (${reason}). New XP: ${newXP}`);
        await actor.update({"system.details.xp.value": newXP});
    }
}

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
        const xpRequired = pf1eParallelLeveling.getXpForLevel(currentLevel, track, formula);
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

    const xpCost = pf1eParallelLeveling.getXpForLevel(oldLevel, track, formula);
    await pf1eParallelLeveling.deductXpFromActor(actor, xpCost, `level-up from ${oldLevel} → ${newLevel}`);
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

    const fullCost = pf1eParallelLeveling.getXpForLevel(1, track, formula);
    const halfCost = Math.floor(fullCost / 2);

    await pf1eParallelLeveling.deductXpFromActor(actor, halfCost, `new level 1 class "${item.name}"`);
});

Hooks.once("ready", async () => {
    libWrapper.register(
        "pf1e-parallel-leveling", // Your module ID
        "pf1.canva.actors.ActorSheetPFCharacter.prototype.getData", // Target method path
        async function (wrapped, ...args) {
            const data = await wrapped(...args);
            if (!data) {
                console.warn("Pf1e Parallel Leveling: getData returned no data");
                return data;
            }

            console.log(`Pf1e Parallel Leveling: getData called for actor "${this.actor?.name}"`);
            data.levelUp = true;
            console.log("Pf1e Parallel Leveling: Forced data.levelUp = true");

            return data;
        },
        "WRAPPER"
    );
});


Hooks.once("init", async () => {

    libWrapper.register(
        "pf1e-parallel-leveling",
        "pf1.documents.item.ItemClassPF.prototype.prepareDerivedData",
        function (wrapped, ...args) {
            wrapped.call(this, ...args);
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
        function (wrapped, ...args) {
            wrapped.call(this, ...args); // Let other changes happen
            const isFractional = game.settings.get("pf1", "useFractionalBaseBonuses");
            if(!isFractional) return; // Only apply if fractional is enabled

            const changes = args[0];

            const classes = this.items.filter(i => i.type === "class" && i.system?.level > 0);

            const bab = {};
            const baseSaves = {};

            for (const cls of classes) {
                const classLvl = cls.system.level ?? 0;
                const classBab = cls.system.bab;
                const stackType = cls.subType === "prestige"
                    ? "prestige"
                    : cls.subType === "mythic"
                        ? "mythic"
                        : "base";
                for (const save of Object.keys(system.attributes.savingThrows)) {
                    const hasGoodSave = cls.system.savingThrows[save].good === true;

                    if(hasGoodSave) {
                        baseSaves[save] ??= {};
                        baseSaves[save][stackType] ??= {};
                        baseSaves[save][stackType].good = hasGoodSave ? Math.max(baseSaves[save]?.good ?? 0, classLvl) : baseSaves[save][stackType]?.good ?? 0;
                        baseSaves[save][stackType].poor = !hasGoodSave ? Math.max(baseSaves[save]?.poor ?? 0, classLvl) : baseSaves[save][stackType]?.poor ?? 0;
                    }

                    for (let i = changes.length - 1; i >= 0; i--) {
                        if (changes[i].flavor === cls.name && changes[i].type === "untypedPerm" && changes[i].target === save) {
                            changes.splice(i, 1);
                        }
                    }
                }

                bab[stackType] ??= {};
                bab[stackType][classBab] = Math.max(bab[stackType][classBab] ?? 0, classLvl);
            }

            const finalSaves = {
                fort: {
                    base: {
                        good: 0,
                        poor: 0
                    },
                    prestige: {
                        good: 0,
                        poor: 0
                    },
                    total: {
                        good: 0,
                        poor: 0
                    }
                },
                ref: {
                    base: {
                        good: 0,
                        poor: 0
                    },
                    prestige: {
                        good: 0,
                        poor: 0
                    },
                    total: {
                        good: 0,
                        poor: 0
                    }
                },
                will: {
                    base: {
                        good: 0,
                        poor: 0
                    },
                    prestige: {
                        good: 0,
                        poor: 0
                    },
                    total: {
                        good: 0,
                        poor: 0
                    }
                }
            }

            for(let save of Object.keys(baseSaves)) {
                const saveData = baseSaves[save];

                const goodBaseSave = saveData.base?.good ?? 0;
                const poorBaseSave = Math.max((saveData.base?.poor ?? 0) - goodBaseSave, 0);
                const totalBaseSave = Math.clamp(goodBaseSave + poorBaseSave, 0, 20);

                const goodPrestigeSave = Math.max(Math.clamp((saveData.prestige?.good ?? 0) + goodBaseSave, 0, 20) - goodBaseSave, 0);
                const poorPrestigeSave = Math.max(Math.clamp((saveData.prestige?.poor ?? 0) + totalBaseSave + goodPrestigeSave, 0, 20) - totalBaseSave - goodPrestigeSave, 0);

                const totalNonEpicGoodSave = Math.clamp(goodPrestigeSave + goodBaseSave, 0, 20);
                const totalNonEpicPoorSave = Math.clamp(poorPrestigeSave + poorBaseSave, 0, 20);

                finalSaves[save].base.good = goodBaseSave;
                finalSaves[save].base.poor = poorBaseSave;
                finalSaves[save].prestige.good = goodPrestigeSave;
                finalSaves[save].prestige.poor = poorPrestigeSave;
                finalSaves[save].total.good = totalNonEpicGoodSave;
                finalSaves[save].total.poor = totalNonEpicPoorSave;

                changes.push(
                    new pf1.components.ItemChange({
                        formula: Math.floor(finalSaves[save].total.good / 2 + finalSaves[save].total.poor / 3),
                        target: save,
                        type: "untypedPerm",
                        flavor: `Class ${save} Save (${finalSaves[save].base.good}/${finalSaves[save].prestige.good}/${finalSaves[save].base.poor})/${finalSaves[save].prestige.poor}`
                    })
                );
            }

            const highBaseBabLevels = Math.clamp(bab.base.high, 0, 20);
            const mediumBaseBabLevels = Math.clamp(bab.base.medium - highBaseBabLevels, 0, 20);
            const lowBaseBabLevels = Math.clamp(bab.base.low - mediumBaseBabLevels - highBaseBabLevels, 0, 20);
            const totalBaseLevels = Math.clamp(highBaseBabLevels + mediumBaseBabLevels + lowBaseBabLevels, 0, 20);
            const highPrestigeBabLevels = Math.max(Math.clamp(bab.prestige.high + highBaseBabLevels, 0, 20) - highBaseBabLevels, 0) ;
            const mediumPrestigeBabLevels = Math.max(Math.clamp(bab.prestige.medium + highBaseBabLevels + mediumBaseBabLevels + highPrestigeBabLevels, 0, 20) - highBaseBabLevels - mediumBaseBabLevels - highPrestigeBabLevels, 0);
            const lowPrestigeBabLevels = Math.max(Math.clamp(bab.prestige.low + totalBaseLevels + highPrestigeBabLevels + mediumPrestigeBabLevels, 0, 20) - totalBaseLevels - highPrestigeBabLevels - mediumPrestigeBabLevels, 0);

            const finalBAB = {
                base: {
                    high: highBaseBabLevels,
                    medium: mediumBaseBabLevels,
                    low: lowBaseBabLevels,
                    total: totalBaseLevels
                },
                prestige: {
                    high: highPrestigeBabLevels,
                    medium: mediumPrestigeBabLevels,
                    low: lowPrestigeBabLevels,
                    total: highPrestigeBabLevels + mediumPrestigeBabLevels + lowPrestigeBabLevels
                }
            };

            changes.push(
                new pf1.components.ItemChange({
                    formula: finalBAB.base.total + finalBAB.prestige.total,
                    target: "bab",
                    type: "untypedPerm",
                    flavor: `Class BAB (${finalBAB.base.high}/${finalBAB.base.medium}/${finalBAB.base.low})/${finalBAB.prestige.high}/${finalBAB.prestige.medium}/${finalBAB.prestige.low}`
                })
            );

            console.log("Pf1e Parallel Leveling: Applied parallel BAB and saves", {
                bab: finalBAB,
                saves: finalSaves
            });
        },
        "WRAPPER"
    );
});

