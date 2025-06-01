console.log("Pf1e Parallel Leveling loaded.");

Hooks.on("renderActorSheet", (sheet, html, data) => {
    const actor = sheet.actor;

    // -- Clean up XP display (remove "/max")
    const xp = actor.system?.details?.xp?.value ?? 0;
    const xpField = html.find(".xp");
    if (xpField.length) {
        xpField.text(xp.toLocaleString());
    }

    // -- Get XP config
    const xpConfig = game.settings.get("pf1", "experienceConfig");
    const track = xpConfig.track;

    // -- Show and configure Level Up buttons
    html.find("button.level-up").show().each((_, btn) => {
        const $btn = $(btn);
        const classId = $btn.data("itemId");
        const classItem = actor.items.get(classId);
        if (!classItem) return;

        const level = classItem.system.level ?? 0;
        const nextLevel = level + 1;

        let requiredXP;
        if (track === "custom" && xpConfig.custom?.formula) {
            try {
                const formula = xpConfig.custom.formula;
                requiredXP = new Roll(formula, { level: nextLevel }).evaluate({ async: false }).total;
            } catch (err) {
                console.warn("Pf1e Parallel Leveling | Invalid custom XP formula", err);
                requiredXP = Number.MAX_SAFE_INTEGER; // fail-safe
            }
        } else {
            requiredXP = CONFIG.PF1.progression[track]?.[nextLevel] ?? Number.MAX_SAFE_INTEGER;
        }

        if (xp < requiredXP) {
            $btn.prop("disabled", true);
            $btn.attr("title", `Requires ${requiredXP} XP`);
        } else {
            $btn.prop("disabled", false);
            $btn.attr("title", `Click to level up ${classItem.name}`);
        }
    });
});
