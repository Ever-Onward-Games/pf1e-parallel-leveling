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

    isMaxLevel: (level, cls) => {
        const maxLevel = cls.system.flags.dictionary["Max Level"] ?? (cls.system.subType === "base" ? 20 : 10)
        return level >= maxLevel;
    },

    // ───────────────────────────────────────────────────────────
    // 🧰 Utility: Calculate XP cost for leveling
    getXpForLevel: (level, track = "medium", formula = "", cls = undefined) => {
        const xpTable = CONFIG.PF1.CHARACTER_EXP_LEVELS?.[track];

        if(cls.system.subType !== "base") {
            const minLevel = cls.system?.flags?.dictionary["Min Level"] ?? 20;
            const maxLevel = cls.system?.flags?.dictionary["Max Level"] ?? 10;
            const tempLevel = (((20 - minLevel) /  maxLevel) * (level + 1)) + minLevel;
            const classShim = { system: { subType: "base" }};
            return pf1eParallelLeveling.getXpForLevel(tempLevel, track, formula, classShim);
        }

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
    },

    stripChanges: (changes, flavor = undefined, type = undefined, target = undefined) => {
        for (let i = changes.length - 1; i >= 0; i--) {
            if (
                (flavor === undefined || changes[i].flavor === flavor)
                && (type === undefined || changes[i].type === type)
                && (target === undefined || changes[i].target === target)) {
                pf1eParallelLeveling.logging.info(`Removing existing change.`, { flavor, type, target, change: changes[i] });
                changes.splice(i, 1);
            }
        }
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
        const xpRequired = pf1eParallelLeveling.getXpForLevel(currentLevel, track, formula, classItem);
        const isMaxLevel = pf1eParallelLeveling.isMaxLevel(currentLevel, classItem)
        const canLevel = !isMaxLevel && (xp >= xpRequired);

        $btn.prop("disabled", !canLevel);
        $btn.attr("title", isMaxLevel ? "This class is maximum level." : (canLevel ? "Click to level up" : `Requires ${xpRequired} XP`));
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

    const xpCost = pf1eParallelLeveling.getXpForLevel(oldLevel, track, formula, item);
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
            pf1eParallelLeveling.logging.info(`prepareDerivedData called`,  { context: this, args });
            for (const save of ["fort", "ref", "will"]) {
                this.system.savingThrows[save].base = 0;
            }

            this.system.babBase = 0;
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
                high: 0,
                medium: 0,
                low: 0,
            };
            const baseSaves = {
                fort: {
                    good: 0,
                    poor: 0
                },
                ref: {
                    good: 0,
                    poor: 0
                },
                will: {
                    good: 0,
                    poor: 0
                }
            };

            for (const cls of classes) {
                pf1eParallelLeveling.logging.info(`Start processing class ${cls.name} for parallel leveling`, { cls, baseSaves: JSON.parse(JSON.stringify(baseSaves)), bab: JSON.parse(JSON.stringify(bab)) });
                const classLvl = cls.system.level ?? 0;
                const classBab = cls.system.bab;
                const stackType = cls.system.subType === "prestige"
                    ? "prestige"
                    : cls.system.subType === "mythic"
                        ? "mythic"
                        : "base";
                const saveTypes = Object.keys(system.attributes.savingThrows);

                pf1eParallelLeveling.stripChanges(changes, cls.name, "untypedPerm", "bab");

                for(const save of saveTypes) {
                    pf1eParallelLeveling.stripChanges(changes, cls.name, "untypedPerm", save);
                }

                if(stackType !== "base") {
                    continue;
                }

                for (const save of saveTypes) {
                    const hasGoodSave = cls.system.savingThrows[save].value === "high";

                    pf1eParallelLeveling.logging.info('Class Save Processing', { class: cls, save, hasGoodSave, saveData: cls.system.savingThrows[save] });

                    baseSaves[save].good = hasGoodSave ? Math.max(baseSaves[save].good, classLvl) : baseSaves[save].good;
                    baseSaves[save].poor = !hasGoodSave ? Math.max(baseSaves[save].poor, classLvl) : baseSaves[save].poor;

                    pf1eParallelLeveling.logging.info(`Processed ${save} save for class ${cls.name}`, JSON.parse(JSON.stringify(baseSaves)));
                }

                bab[classBab] = Math.max(bab[classBab], classLvl);

                pf1eParallelLeveling.logging.info(`Processed class ${cls.name} for parallel leveling`, { bab: JSON.parse(JSON.stringify(bab)), baseSaves: JSON.parse(JSON.stringify(baseSaves)) });
            }

            pf1eParallelLeveling.logging.info("Finished all classes", { bab: JSON.parse(JSON.stringify(bab)), baseSaves: JSON.parse(JSON.stringify(baseSaves)) });

            const finalSaves = {
                fort: {
                    good: 0,
                    poor: 0
                },
                ref: {
                    good: 0,
                    poor: 0
                },
                will: {
                    good: 0,
                    poor: 0
                }
            }

            for(let save of Object.keys(baseSaves)) {
                const saveData = baseSaves[save];
                pf1eParallelLeveling.logging.info(`Processing ${save} Save Data`, saveData);

                const goodBaseSave = saveData.good;
                const poorBaseSave = Math.max(saveData.poor - goodBaseSave, 0);

                pf1eParallelLeveling.logging.info(`Processing Base Class ${save} Save`, { goodBaseSave, poorBaseSave });

                finalSaves[save].good = goodBaseSave;
                finalSaves[save].poor = poorBaseSave;

                const saveValue = Math.floor(finalSaves[save].good / 2 + finalSaves[save].poor / 3);

                pf1eParallelLeveling.logging.info(`Calculated ${save} save`, { finalSaves: finalSaves[save], saveValue });

                let saveChange = new pf1.components.ItemChange({
                    formula: saveValue,
                    target: save,
                    type: "untypedPerm",
                    flavor: `Class ${save} Save (${finalSaves[save].good}/${finalSaves[save].poor})`
                });

                pf1eParallelLeveling.logging.info(`Calculated ${save} save change`, saveChange);

                changes.push(saveChange);
            }

            const highBabLevels = Math.clamp(bab.high, 0, 20);
            const mediumBabLevels = Math.clamp(bab.medium + highBabLevels, 0, 20) - highBabLevels;
            const lowBabLevels = Math.clamp(bab.low + highBabLevels + mediumBabLevels, 0, 20) - highBabLevels - mediumBabLevels;

            pf1eParallelLeveling.logging.info("Finished calculating BAB levels", { highBabLevels, mediumBabLevels, lowBabLevels });

            const finalBAB = {
                high: highBabLevels,
                medium: mediumBabLevels,
                low: lowBabLevels
            };

            const babChange = new pf1.components.ItemChange({
                formula: Math.floor(finalBAB.high + finalBAB.medium * 0.75 + finalBAB.low * 0.5),
                target: "bab",
                type: "untypedPerm",
                flavor: `Class BAB (${finalBAB.high}/${finalBAB.medium}/${finalBAB.low})`
            });

            pf1eParallelLeveling.logging.info(`Calculated BAB change`, babChange);

            changes.push(
                babChange
            );

            pf1eParallelLeveling.logging.info("Applied parallel BAB and saves", {
                bab: finalBAB,
                saves: finalSaves
            });

            pf1eParallelLeveling.logging.info("Process complete", changes);
        },
        "WRAPPER"
    );
});

