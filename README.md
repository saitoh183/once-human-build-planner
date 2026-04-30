# Once Human Build Planner

Static one-page build planner for Once Human gun builds, using [OHDB / Once Human Database](https://www.oncehumandb.com/) as the source data.

## Features

- One table row per build
- Columns match the mockup:
  - Gun
  - Build type
  - Weapon
  - Mask
  - Head
  - Legs
  - Shoes
  - Top
  - Deviation
  - Cradle
  - Food
- Build type choices: `High HP` / `Low HP`
- Gun column: primary + secondary gun selectors
- Weapon column: primary + secondary weapon mod selectors
- Armor slot columns: armor/set selector + matching armor mod selector
- Cradle column: 8 compact icon slots
- Food column: 2 main food slots + 2 Chef extra slots
- Hover tooltips with effect text and a compact `Link` anchor
- Local browser persistence via `localStorage`
- Save/load backup JSON
- Export one row or all rows to PDF using landscape print CSS

## Run locally

Because the app loads `data/*.json`, serve the directory instead of opening `index.html` directly:

```bash
cd ~/git/once-human-build-planner
python3 -m http.server 8080
```

Then open:

```text
http://127.0.0.1:8080/
```

## Refresh OHDB data

```bash
cd ~/git/once-human-build-planner
python3 tools/refresh-ohdb-data.py
```

Generated files:

```text
data/weapons.json
data/armor.json
data/mods.json
data/deviations.json
data/cradle.json
data/food.json
```

Current source pages:

```text
https://www.oncehumandb.com/weapons
https://www.oncehumandb.com/armor
https://www.oncehumandb.com/mods
https://www.oncehumandb.com/deviations
https://www.oncehumandb.com/cradle-overrides
https://www.oncehumandb.com/items
```

## PDF export note

The app uses:

```css
@page {
  size: A4 landscape;
  margin: 8mm;
}
```

Chrome/Edge usually respect this when saving to PDF. Browser print engines remain browser print engines, because apparently we are still paying for old sins.
