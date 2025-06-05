const pf1eParallelLeveling = {
    logging: {
        log: (message, data, level) => {
            if (!!data) {
                switch (level) {
                    case "info":
                        console.info(`Pf1e Parallel Leveling | ${message}`, data);
                        break;
                    case "debug":
                        console.debug(`Pf1e Parallel Leveling | ${message}`, data);
                        break;
                    case "warn":
                        console.warn(`Pf1e Parallel Leveling | ${message}`, data);
                        break;
                    case "error":
                        console.error(`Pf1e Parallel Leveling | ${message}`, data);
                        break;
                    default:
                        console.log(`Pf1e Parallel Leveling | ${message}`, data);
                }
            } else {
                switch (level) {
                    case "info":
                        console.info(`Pf1e Parallel Leveling | ${message}`);
                        break;
                    case "debug":
                        console.debug(`Pf1e Parallel Leveling | ${message}`);
                        break;
                    case "warn":
                        console.warn(`Pf1e Parallel Leveling | ${message}`);
                        break;
                    case "error":
                        console.error(`Pf1e Parallel Leveling | ${message}`);
                        break;
                    default:
                        console.log(`Pf1e Parallel Leveling | ${message}`);
                }
            }
        },
        warn: (message, data) => {
            pf1eParallelLeveling.logging.log(message, data, "warn");
        },
        info: (message, data) => {
            pf1eParallelLeveling.logging.log(message, data, "info");
        },
        debug: (message, data) => {
            pf1eParallelLeveling.logging.log(message, data, "debug");
        },
        error: (message, data) => {
            pf1eParallelLeveling.logging.log(message, data, "error");
        }
    },

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
                pf1eParallelLeveling.logging.error("Error evaluating XP formula", err);
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
        pf1eParallelLeveling.logging.info(`Deducting ${amount} XP from "${actor.name}" (${reason}). New XP: ${newXP}`);
        await actor.update({"system.details.xp.value": newXP});
    }
}

pf1eParallelLeveling.logging.info("Initializing.");

// ───────────────────────────────────────────────────────────
// 🎛️ UI: Level-up logic and XP gate
Hooks.on("renderActorSheetPFCharacter", (sheet, html) => {
    pf1eParallelLeveling.logging.info("Hook fired for renderActorSheetPFCharacter.");
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
        pf1eParallelLeveling.logging.warn("Failed to get XP config", err);
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

    pf1eParallelLeveling.logging.info(`Finished processing actor sheet for ${actor.name}`);
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
        "pf1.applications.actor.ActorSheetPFCharacter.prototype.getData", // Target method path
        async function (wrapped, ...args) {
            const data = await wrapped(...args);
            if (!data) {
                pf1eParallelLeveling.logging.warn("getData returned no data");
                return data;
            }

            pf1eParallelLeveling.logging.info(`getData called for actor "${this.actor?.name}"`);
            data.levelUp = true;
            pf1eParallelLeveling.logging.info("Forced data.levelUp = true");

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
            if(!isFractional) {
                pf1eParallelLeveling.logging.info("Skipping parallel leveling changes because fractional base bonuses are disabled.");
                return;
            } // Only apply if fractional is enabled

            const changes = args[0];
            const system = this.system;
            const classes = this.items.filter(i => i.type === "class" && i.system?.level > 0);

            pf1eParallelLeveling.logging.info("Classes identified for parallel leveling", classes);

            const bab = {
                base: {
                    high: 0,
                    medium: 0,
                    low: 0,
                    total: 0
                },
                prestige: {
                    high: 0,
                    medium: 0,
                    low: 0,
                    total: 0
                }
            };
            const baseSaves = {};

            for (const cls of classes) {
                const classLvl = cls.system.level ?? 0;
                const classBab = cls.system.bab;
                const stackType = cls.system.subType === "prestige"
                    ? "prestige"
                    : cls.system.subType === "mythic"
                        ? "mythic"
                        : "base";

                for (let i = changes.length - 1; i >= 0; i--) {
                    if (changes[i].flavor === cls.name && changes[i].type === "untypedPerm" && changes[i].target === "bab") {
                        pf1eParallelLeveling.logging.info(`Removing existing BAB change for ${cls.name}`, changes[i]);
                        changes.splice(i, 1);
                    }
                }

                for (const save of Object.keys(system.attributes.savingThrows)) {
                    const hasGoodSave = cls.system.savingThrows[save].value === "high";

                    pf1eParallelLeveling.logging.info('Class Save Processing', { class: cls, save, stackType, hasGoodSave, saveData: cls.system.savingThrows[save] });

                    baseSaves[save] ??= {};
                    baseSaves[save][stackType] ??= {};
                    baseSaves[save][stackType].good = hasGoodSave ? Math.max(baseSaves[save]?.good ?? 0, classLvl) : baseSaves[save][stackType]?.good ?? 0;
                    baseSaves[save][stackType].poor = !hasGoodSave ? Math.max(baseSaves[save]?.poor ?? 0, classLvl) : baseSaves[save][stackType]?.poor ?? 0;

                    pf1eParallelLeveling.logging.info(`Processed ${save} save for class ${cls.name}`, baseSaves);

                    for (let i = changes.length - 1; i >= 0; i--) {
                        if (changes[i].flavor === cls.name && changes[i].type === "untypedPerm" && changes[i].target === save) {
                            pf1eParallelLeveling.logging.info(`Removing existing save change for ${cls.name} (${save})`, changes[i]);
                            changes.splice(i, 1);
                        }
                    }
                }

                bab[stackType] ??= {};
                bab[stackType][classBab] = Math.max(bab[stackType][classBab] ?? 0, classLvl);

                pf1eParallelLeveling.logging.info(`Processed class ${cls.name} for parallel leveling`, { bab, baseSaves });
            }

            pf1eParallelLeveling.logging.info("Finished all classes", { bab, baseSaves });

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

                pf1eParallelLeveling.logging.info(`Processing Base Class ${save} Save`, { goodBaseSave, poorBaseSave, totalBaseSave });

                const goodPrestigeSave = Math.max(Math.clamp((saveData.prestige?.good ?? 0) + goodBaseSave, 0, 20) - goodBaseSave, 0);
                const poorPrestigeSave = Math.max(Math.clamp((saveData.prestige?.poor ?? 0) + totalBaseSave + goodPrestigeSave, 0, 20) - totalBaseSave - goodPrestigeSave, 0);

                pf1eParallelLeveling.logging.info(`Processing Prestige Class ${save} Save`, { goodPrestigeSave, poorPrestigeSave });

                const totalNonEpicGoodSave = Math.clamp(goodPrestigeSave + goodBaseSave, 0, 20);
                const totalNonEpicPoorSave = Math.clamp(poorPrestigeSave + poorBaseSave, 0, 20);

                pf1eParallelLeveling.logging.info(`Processing Total Non-Epic ${save} Save`, { totalNonEpicGoodSave, totalNonEpicPoorSave });

                finalSaves[save].base.good = goodBaseSave;
                finalSaves[save].base.poor = poorBaseSave;
                finalSaves[save].prestige.good = goodPrestigeSave;
                finalSaves[save].prestige.poor = poorPrestigeSave;
                finalSaves[save].total.good = totalNonEpicGoodSave;
                finalSaves[save].total.poor = totalNonEpicPoorSave;

                const saveValue = Math.floor(finalSaves[save].total.good / 2 + finalSaves[save].total.poor / 3);

                pf1eParallelLeveling.logging.info(`Calculated ${save} save`, { finalSaves: finalSaves[save], saveValue });

                let saveChange = new pf1.components.ItemChange({
                    formula: saveValue,
                    target: save,
                    type: "untypedPerm",
                    flavor: `Class ${save} Save (${finalSaves[save].base.good}/${finalSaves[save].prestige.good}/${finalSaves[save].base.poor}/${finalSaves[save].prestige.poor})`
                });

                pf1eParallelLeveling.logging.info(`Calculated ${save} save change`, saveChange);

                changes.push(saveChange);
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

            const babChange = new pf1.components.ItemChange({
                formula: finalBAB.base.total + finalBAB.prestige.total,
                target: "bab",
                type: "untypedPerm",
                flavor: `Class BAB (${finalBAB.base.high}/${finalBAB.base.medium}/${finalBAB.base.low}/${finalBAB.prestige.high}/${finalBAB.prestige.medium}/${finalBAB.prestige.low})`
            });

            pf1eParallelLeveling.logging.info(`Calculated BAB change`, babChange);

            changes.push(
                babChange
            );

            pf1eParallelLeveling.logging.info("Applied parallel BAB and saves", {
                bab: finalBAB,
                saves: finalSaves
            });
        },
        "WRAPPER"
    );
});

