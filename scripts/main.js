console.log("Pf1e Parallel Leveling loaded.");

/**
 * Get XP requirement for the next level based on PF1e's system config
 * @param {number} level - Current class level
 * @returns {number} - XP required for the next level
 */
function getXpForNextLevel(level) {
    const config = game.settings.get("pf1", "experienceConfig");
    if (!config || config.disable) return 0;

    let formula;

    if (config.track === "custom") {
        formula = config.custom?.formula;
    } else {
        const progression = game.system.config.experience.progression;
        formula = progression?.[config.track]?.formula;
    }

    if (!formula) return 0;

    try {
        const context = { level: level + 1 };
        return Roll.safeEval(formula, context);
    } catch (e) {
        console.error("Failed to evaluate XP formula:", formula, e);
        return 0;
    }
}

/**
 * Hook into PF1e character sheets to show XP requirements and disable level-up buttons
 */
Hooks.on("renderActorSheet", async (app, html, data) => {
    const actor = app.actor;
    if (!actor || actor.type !== "character") return;

    const xp = getProperty(actor.system, "details.xp.value") || 0;

    const table = html.find(".class-list");
    const classRows = table.find("tr");
    if (!classRows.length) return;

    // Add header column for XP Needed if not already present
    const headerRow = table.find("thead tr");
    if (headerRow.length && headerRow.find("th.xp-needed-header").length === 0) {
        headerRow.append('<th class="xp-needed-header">XP Needed</th>');
    }

    // Add column content per class
    classRows.each((i, row) => {
        const $row = $(row);
        if ($row.closest("thead").length) return; // skip header row

        const classNameInput = $row.find("input[name$='.name']");
        const levelInput = $row.find("input[name$='.level']");
        const className = classNameInput.val()?.trim();
        const level = parseInt(levelInput.val() || "1");

        if (!className || isNaN(level)) return;

        const nextXp = getXpForNextLevel(level);
        const xpNeeded = nextXp;

        // Remove old cell and inject XP Needed cell
        $row.find("td.xp-next").remove();
        $row.append(`<td class="xp-next">${xpNeeded}</td>`);

        // Disable level up if insufficient XP
        const levelUpBtn = $row.find(".level-up");
        if (levelUpBtn.length) {
            levelUpBtn.prop("disabled", xp < nextXp);
        }
    });
});
