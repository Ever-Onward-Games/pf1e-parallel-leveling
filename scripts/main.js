console.log("Pf1e Parallel Leveling loaded.");

Hooks.on("renderActorSheet", (sheet, html) => {
    const actor = sheet.actor;
    if (!actor) return;

    // Safely get XP value
    const xp = actor.system?.details?.xp?.value ?? 0;

    // Clean XP display (remove /max XP)
    const xpField = html.find(".xp");
    if (xpField.length) {
        xpField.text(xp.toLocaleString());
    }

    // Safely get XP progression settings
    let xpConfig, track;
    try {
        xpConfig = game.settings.get("pf1", "experienceConfig");
        track = xpConfig?.track ?? "medium";
    } catch (err) {
        console.warn("Pf1e Parallel Leveling: Failed to load XP config. Defaulting to medium.", err);
        track = "medium";
        xpConfig = null;
    }

    const progression = CONFIG?.PF1?.progression ?? {};

    // Show and update built-in Level Up buttons
    html.find("button.level-up").show().each((_, btn) => {
        const $btn = $(btn);
        const classId = $btn.data("itemId");
        const classItem = actor.items.get(classId);
        if (!classItem) return;

        const level = classItem.system.level ?? 0;
        const nextLevel = level + 1;

        let requiredXP;

        // Handle custom formula or track table
        if (track === "custom" && xpConfig?.custom?.formula) {
            try {
                const formula = xpConfig.custom.formula;
                const roll = new Roll(formula, { level: nextLevel }).evaluate({ async: false });
                requiredXP = roll.total;
            } catch (err) {
                console.warn("Pf1e Parallel Leveling: Invalid XP formula. Fallback to infinity.", err);
                requiredXP = Number.MAX_SAFE_INTEGER;
            }
        } else {
            requiredXP = progression[track]?.[nextLevel] ?? Number.MAX_SAFE_INTEGER;
        }

        // Enable or disable the button
        if (xp < requiredXP) {
            $btn.prop("disabled", true);
            $btn.attr("title", `Requires ${requiredXP} XP`);
        } else {
            $btn.prop("disabled", false);
            $btn.attr("title", `Click to level up ${classItem.name}`);
        }
    });
});
