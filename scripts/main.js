console.log("Pf1e Parallel Leveling loaded.");

Hooks.once("init", () => {
    game.settings.register("pf1e-parallel-leveling", "classXpTables", {
        name: "Class XP Tables",
        hint: "Configure custom XP progressions for each base class. Format: { \"Fighter\": [0, 1000, 2000], \"Wizard\": [0, 3000, 5000] }",
        scope: "world",
        config: true,
        type: Object,
        default: {},
        onChange: value => {
            console.log("Updated class XP tables:", value);
        }
    });
});

/**
 * Uses the Pathfinder 1E XP formula as a fallback.
 * @param {number} level - The level to calculate XP for.
 * @returns {number} - XP required to reach that level.
 */
function pf1eDefaultXpForLevel(level) {
    const progression = game.settings.get("pf1", "xpProgression") || "medium";
    const formulas = {
        fast:   (n) => n * n * 500,
        medium: (n) => n * n * 1000,
        slow:   (n) => n * n * 1500
    };
    const formula = formulas[progression] || formulas.medium;
    return formula(level);
}

/**
 * Retrieves the XP required to reach the next level of a given class.
 * Falls back to PF1E XP progression if no class-specific table exists.
 * @param {string} className - The name of the class.
 * @param {number} level - The current level of the class.
 * @returns {number|null} - XP required for the next level, or null if none.
 */
function getXpForClassAndLevel(className, level) {
    const xpTables = game.settings.get("pf1e-parallel-leveling", "classXpTables") || {};
    const table = xpTables[className];
    if (table && table.length > level) {
        return table[level];
    }

    // Fall back to default PF1E XP progression formula
    return pf1eDefaultXpForLevel(level);
}

/**
 * Enhance class list with XP cost display and gating
 */
Hooks.on("renderActorSheet", async (app, html, data) => {
    const actor = app.actor;
    const system = actor.system;
    const classes = html.find(".class-list");
    const xp = getProperty(system, "details.xp.value");

    if (!classes.length || actor.type !== "character") return;

    // Add new header column
    const headerRow = classes.find("thead tr");
    if (headerRow.find(".next-xp-header").length === 0) {
        headerRow.append(`<th class="next-xp-header">Next XP</th>`);
    }

    // Go through each class row
    classes.find("tbody tr").each((i, row) => {
        const $row = $(row);
        const className = $row.find("input[name$='name']").val()?.trim();
        const levelInput = $row.find("input[name$='level']");
        const level = parseInt(levelInput.val() || "0");
        const nextXp = getXpForClassAndLevel(className, level);

        // Show XP cost
        const xpCell = `<td class="next-xp-cell">${nextXp !== null ? nextXp : "—"}</td>`;
        if ($row.find(".next-xp-cell").length === 0) {
            $row.append(xpCell);
        }

        // Disable level-up button if not enough XP
        const button = $row.find(".class-controls .level-up");
        if (button.length && (nextXp === null || xp < nextXp)) {
            button.prop("disabled", true);
            button.attr("title", "Not enough XP to level up this class");
        }
    });
});
