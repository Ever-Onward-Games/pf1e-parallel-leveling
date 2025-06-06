const pf1eParallelLeveling = {
    logging: {
        log: (message, dataRef, level) => {
            if (!!dataRef) {
                const data = JSON.parse(JSON.stringify(dataRef));
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
    helpers: {
        getDictionaryFlagByKey: (cls, key) => {
            pf1eParallelLeveling.logging.info(`Retrieving dictionary flag "${key}" for class`, cls);
            return cls.system.flags.dictionary[key];
        },

        isMaxLevel: (level, cls) => {
            const maxLevel = pf1eParallelLeveling.helpers.getDictionaryFlagByKey(cls,"Max Level");
            return level >= maxLevel;
        },

        getXpForLevel: (level, track = "medium", formula = "", cls = undefined) => {
            const xpTable = CONFIG.PF1.CHARACTER_EXP_LEVELS?.[track];

            if(cls.system.subType !== "base") {
                return pf1eParallelLeveling.helpers.getPrestigeXpForLevel(level, track, formula, cls);
            }

            if (track !== "custom") {
                if (!xpTable) return 1000;
                if (level < xpTable.length) return xpTable[level] - (level === 0 ? 0 : xpTable[level - 1]);
                return (xpTable[19] - xpTable[18]) * Math.pow(2, level - 19);
            } else {
                if (level < 20)
                    return pf1eParallelLeveling.helpers.getXpForLevelByFormula(formula, level + 1) - pf1eParallelLeveling.helpers.getXpForLevelByFormula(formula, level);
                return (pf1eParallelLeveling.helpers.getXpForLevelByFormula(formula, 20) - pf1eParallelLeveling.helpers.getXpForLevelByFormula(formula, 19)) * Math.pow(2, level - 19);
            }
        },

        getXpForLevelByFormula: (formula, level) => {
            try {
                const roll = new Roll(formula, {level});
                roll.evaluate({async: false});
                return typeof roll.total === "number" && !isNaN(roll.total) ? roll.total : Number.MAX_SAFE_INTEGER;
            } catch (err) {
                pf1eParallelLeveling.logging.error("Error evaluating XP formula", err);
                return Number.MAX_SAFE_INTEGER;
            }
        },

        getPrestigeXpForLevel: (level, track = "medium", formula = "", cls = undefined) => {
            const minLevel = +cls.system?.flags?.dictionary["Min Level"] ?? 20;
            const maxLevel = +cls.system?.flags?.dictionary["Max Level"] ?? 10;
            const tempLevel = Math.floor((((20 - minLevel) /  maxLevel) * (level + 1)) + minLevel);
            const classShim = { system: { subType: "base" }};
            pf1eParallelLeveling.logging.info('Determining XP for Prestige Class', { level, track, formula, tempLevel, minLevel, maxLevel });
            return pf1eParallelLeveling.helpers.getXpForLevel(tempLevel, track, formula, classShim);
        },

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
        },

        stripClassData: (classes, changes) => {
            for(let cls of classes) {
                pf1eParallelLeveling.helpers.stripChanges(changes, cls.name, "untypedPerm", "bab");
                pf1eParallelLeveling.helpers.stripChanges(changes, cls.name, "untypedPerm", "fort");
                pf1eParallelLeveling.helpers.stripChanges(changes, cls.name, "untypedPerm", "ref");
                pf1eParallelLeveling.helpers.stripChanges(changes, cls.name, "untypedPerm", "will");
                pf1eParallelLeveling.helpers.stripChanges(changes, cls.name, "untypedPerm", "hp");
            }
        },

        __getSavingThrowDataInternal: (cls, system, externalAcc) => {
            return Object.keys(system.attributes.savingThrows).reduce((acc, save) => {
                acc[save].good = Math.max(externalAcc[save].good, cls.system.savingThrows[save].value === "high" ? cls.system.level : 0);
                acc[save].poor = Math.max(externalAcc[save].poor, cls.system.savingThrows[save].value !== "high" ? cls.system.level : 0);
                return acc;
            }, externalAcc);
        },

        getSavingThrowData: (classes, system) => {
            return classes.reduce((acc, cls) => {
                if (cls.system.subType !== "base") {
                    return acc;
                }

                return pf1eParallelLeveling.helpers.__getSavingThrowDataInternal(cls, system, acc);
            }, {fort: {good: 0, poor: 0}, ref: {good: 0, poor: 0}, will: {good: 0, poor: 0}});
        },

        applySaveChanges: (savingThrowData, changes) => {
            Object.keys(savingThrowData).forEach(save => {
                const poorSaveLevels = Math.max(savingThrowData[save].poor - savingThrowData[save].good, 0);
                const saveChange = new pf1.components.ItemChange({
                    formula: Math.floor(savingThrowData[save].good / 2 + poorSaveLevels / 3),
                    target: save,
                    type: "untypedPerm",
                    flavor: `Class Save (Good: ${savingThrowData[save].good / 2}, Poor: ${poorSaveLevels / 3})`
                });

                changes.push(saveChange);
            });
        },

        applyBaseAttackBonusChanges: (babData, changes) => {
            const mediumBabLevels = Math.max(babData.medium - babData.high, 0);
            const lowBabLevels = Math.max(babData.low - babData.high - mediumBabLevels, 0);
            const babChange = new pf1.components.ItemChange({
                formula: Math.floor(babData.high + mediumBabLevels * 0.75 + lowBabLevels * 0.5),
                target: "bab",
                type: "untypedPerm",
                flavor: `Class BAB (High: ${babData.high}, Medium: ${mediumBabLevels * 0.75}, Low: ${lowBabLevels * 0.5})`
            });

            changes.push(babChange);
        },

        getBaseAttackBonusData: (classes) => {
            return classes.reduce((acc, cls) => {
                const stackType = cls.system.subType;
                if(stackType !== "base") {
                    return acc;
                }

                acc[cls.system.bab] = Math.max(acc[cls.system.bab], cls.system.level);
                return acc;
            }, { high: 0, medium: 0, low: 0 });
        },

        compareHitDieSize: (die1, die2) => {
            const d1 = +(die1.trim().replace("d", ""));
            const d2 = +(die2.trim().replace("d", ""));
            if(d1 >= d2) {
                return d1;
            }

            return d2;
        },

        __applyHpValues: (hpArray, hitDie, externalAcc) => {
            return hpArray.dieValues.reduce((acc, hp, idx) => {
                hp = +(hp.trim());

                if(idx >= acc.dieTypes.length) {
                    acc.dieTypes.push(hitDie);
                } else {
                    acc.dieTypes[idx] = pf1eParallelLeveling.helpers.compareHitDieSize(acc.dieTypes[idx], hitDie);
                }

                if(idx >= acc.dieValues.length) {
                    acc.dieValues.push(hp);
                    return acc;
                }

                acc.dieValues[idx] = Math.max(acc.dieValues[idx], hp);
                return acc;
            }, externalAcc);
        },

        getHpData: (classes) => {
            return classes.reduce((acc, cls) => {
                if (cls.system.subType !== "base") {
                    return acc;
                }

                pf1eParallelLeveling.helpers.__applyHpValues(
                    pf1eParallelLeveling.helpers.getDictionaryFlagByKey("Hit Die Rolls")?.split(",") ?? [],
                    acc);
            }, { "dieTypes": [], "dieValues": [] });
        },

        applyHpChanges: (hitDice, changes) => {
            const counts = hitDice.dieTypes.reduce((acc, die) => {
                acc[die] = (acc[die] || 0) + 1;
                return acc;
            }, {});

            const formula = Object.entries(counts)
                // Step 3: Sort by die size (numerically extract the number from "dY")
                .sort((a, b) => parseInt(a[0].slice(1)) - parseInt(b[0].slice(1)))
                // Step 4: Format each as "XdY"
                .map(([die, count]) => `${count}${die}`)
                .join('+');

            const hpChange = new pf1.components.ItemChange({
                formula:  hitDice.dieValues.reduce((sum, hp) => {
                    return sum + hp;
                }, 0),
                target: "hp",
                type: "untypedPerm",
                flavor: formula,
            });

            changes.push(hpChange);
        }


    },
    wrappers: {
        ActorSheetPfCharacter: {
          getData: async function (wrapped, ...args) {
              const data = await wrapped(...args);
              if (!data) {
                  pf1eParallelLeveling.logging.warn("getData returned no data");
                  return data;
              }

              pf1eParallelLeveling.logging.info(`getData called for actor "${this.actor?.name}"`);
              data.levelUp = true;
              pf1eParallelLeveling.logging.info("Forced data.levelUp = true");

              return data;
          }
        },
        ItemClassPF: {
            prepareDerivedData: function (wrapped, ...args) {
                wrapped.call(this, ...args);
                pf1eParallelLeveling.logging.info(`prepareDerivedData called`, {context: this, args});
                for (const save of ["fort", "ref", "will"]) {
                    this.system.savingThrows[save].base = 0;
                }

                this.system.babBase = 0;
            },
        },
        BaseCharacterPF: {
           prepareTypeChanges: function (wrapped, ...args) {
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

               pf1eParallelLeveling.helpers.stripClassData(classes, changes);

               const savingThrowData = pf1eParallelLeveling.helpers.getSavingThrowData(classes, system);
               pf1eParallelLeveling.helpers.applySaveChanges(savingThrowData, changes);

               const baseAttackBonusData = pf1eParallelLeveling.helpers.getBaseAttackBonusData(classes);
               pf1eParallelLeveling.helpers.applyBaseAttackBonusChanges(baseAttackBonusData, changes);

               const hpData = pf1eParallelLeveling.helpers.getHpData(classes);
               pf1eParallelLeveling.helpers.applyHpChanges(hpData, changes);
           }
        }
    },

    initHook: async () => {

        libWrapper.register(
            "pf1e-parallel-leveling",
            "pf1.documents.item.ItemClassPF.prototype.prepareDerivedData",
            pf1eParallelLeveling.wrappers.ItemClassPF.prepareDerivedData,
            "WRAPPER"
        );


        libWrapper.register(
            "pf1e-parallel-leveling",
            "pf1.documents.actor.abstract.BaseCharacterPF.prototype._prepareTypeChanges",
            pf1eParallelLeveling.wrappers.BaseCharacterPF.prepareTypeChanges,
            "WRAPPER"
        );
    },

    preUpdateItemHook: async function (item, update) {
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

        const xpCost = pf1eParallelLeveling.helpers.getXpForLevel(oldLevel, track, formula, item);
        await pf1eParallelLeveling.helpers.deductXpFromActor(actor, xpCost, `level-up from ${oldLevel} → ${newLevel}`);
    },

    createItemHook: async function (item) {
        if (item.type !== "class" || !item.actor || item.actor.type !== "character") return;

        const classLevel = item.system?.level ?? 0;
        if (classLevel !== 1) return;

        const actor = item.actor;

        let track = "medium", formula = "";
        try {
            const config = game.settings.get("pf1", "experienceConfig");
            track = config?.track ?? "medium";
            formula = config?.custom?.formula ?? "";
        } catch (ex) {
            pf1eParallelLeveling.logging.error("Failed to get XP config.");
            throw ex;
        }

        const fullCost = pf1eParallelLeveling.helpers.getXpForLevel(1, track, formula, item);
        const halfCost = Math.floor(fullCost / 2);

        await pf1eParallelLeveling.helpers.deductXpFromActor(actor, halfCost, `new level 1 class "${item.name}"`);
    },

    readyHook: async function () {
        libWrapper.register(
            "pf1e-parallel-leveling", // Your module ID
            "pf1.applications.actor.ActorSheetPFCharacter.prototype.getData", // Target method path
            pf1eParallelLeveling.wrappers.ActorSheetPfCharacter.getData, // Wrapper function
            "WRAPPER"
        );

        libWrapper.register(
            "pf1e-parallel-leveling", // Your module ID
            "pf1.applications.LevelUpForm.prototype._getHealthRoll",
            (wrapped, ...args) => {
                const data = wrapped(...args);
                pf1eParallelLeveling.logging.info("Health roll data retrieved", { context: this, data, args });
            },
        );
    },

    renderActorSheetPFCharacterHook: function (sheet, html) {
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
            const xpRequired = pf1eParallelLeveling.helpers.getXpForLevel(currentLevel, track, formula, classItem);
            const isMaxLevel = pf1eParallelLeveling.helpers.isMaxLevel(currentLevel, classItem)
            const canLevel = !isMaxLevel && (xp >= xpRequired);

            $btn.prop("disabled", !canLevel);
            $btn.attr("title", isMaxLevel ? "This class is maximum level." : (canLevel ? "Click to level up" : `Requires ${xpRequired} XP`));
        });

        pf1eParallelLeveling.logging.info(`Finished processing actor sheet for ${actor.name}`);
    },
}

pf1eParallelLeveling.logging.info("Initializing.");

// ───────────────────────────────────────────────────────────
// 🎛️ UI: Level-up logic and XP gate
Hooks.on("renderActorSheetPFCharacter", pf1eParallelLeveling.renderActorSheetPFCharacterHook);

Hooks.on("preUpdateItem", pf1eParallelLeveling.preUpdateItemHook);

Hooks.on("createItem", pf1eParallelLeveling.createItemHook);

Hooks.once("ready", pf1eParallelLeveling.readyHook);


Hooks.once("init", pf1eParallelLeveling.initHook);

