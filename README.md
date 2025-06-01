# Pf1e Parallel Leveling

A FoundryVTT module for the Pathfinder 1st Edition (PF1e) system that enables **parallel class progression**. Designed for expanded gameplay beyond traditional leveling, inspired by Gestalt rules.

## ✨ Features

- Characters can level base classes in parallel instead of in sequence
- XP is tracked separately per class (internally)
- XP cost for next level is shown on the character sheet
- "Level Up" buttons are only enabled if the character has sufficient XP
- Automatically respects system-wide XP progression (Fast, Medium, Slow, Custom Formula)
- Lightweight and unobtrusive — integrates directly into the standard PF1e character sheet

## 💡 Use Case

Example:
- A Barbarian with 2000 XP can choose to level to **Barbarian 2** _or_ pick up **Rogue 1**
- New class levels grant class features but **do not** stack hit dice or BAB
- Designed for flexible, multiclass-heavy campaigns

## 🛠 Installation

1. In FoundryVTT, go to **Add-on Modules → Install Module**
2. Paste the Manifest URL: https://raw.githubusercontent.com/Ever-Onward-Games/pf1e-parallel-leveling/main/module.json
3. Click **Install**

To install manually:
- Download the [latest release](https://github.com/Ever-Onward-Games/pf1e-parallel-leveling/releases)
- Extract into your `Data/modules` directory

## 📁 File Structure

- `scripts/main.js`: Core logic and UI injection
- `styles/style.css`: Optional visual tweaks
- `module.json`: Manifest file

## 🔄 Auto-Releases

Every push to `main` automatically:
- Bumps the version
- Creates a GitHub Release
- Packages and publishes the latest `.zip` and `module.json`

## 🔧 Requirements

- FoundryVTT Core v13+
- Pathfinder 1e System (`pf1`)

## 📣 Feedback / Issues

Report bugs or request features via [GitHub Issues](https://github.com/Ever-Onward-Games/pf1e-parallel-leveling/issues)

---

**Author**: Charles Hunter  
**License**: MIT
