const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync('index.html', 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1]
  .replace(/\n\s*init\(\);\s*$/, '') + `\n\nglobalThis.__app = {\n  state,\n  defaultBuild,\n  displayNameFor,\n  metaFor,\n  getAvailableOptionsForPicker,\n  renderBuildRow,\n  renderPrintBuild,\n  buildMatchesGunSearch,\n  getPngExportModel\n};`;

const elements = new Map();
const makeElement = (id = '') => ({
  id,
  textContent: '',
  innerHTML: '',
  value: '',
  dataset: {},
  style: {},
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  addEventListener() {},
  querySelector() { return null; },
  querySelectorAll() { return []; },
  setAttribute() {},
  removeAttribute() {},
  getBoundingClientRect() { return { left: 0, top: 0, width: 120, height: 36, bottom: 36 }; },
});
const documentStub = {
  body: makeElement('body'),
  documentElement: makeElement('html'),
  createElement: () => makeElement(),
  querySelector(selector) {
    if (!elements.has(selector)) elements.set(selector, makeElement(selector));
    return elements.get(selector);
  },
  querySelectorAll() { return []; },
  addEventListener() {},
};

documentStub.documentElement.dataset = {};

const storage = new Map();
const context = {
  console,
  crypto: { randomUUID: () => 'test-id' },
  localStorage: {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
  },
  document: documentStub,
  window: { innerWidth: 1280, innerHeight: 720, addEventListener() {}, print() {} },
  Blob: function Blob() {},
  URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
  setTimeout,
  fetch: async () => ({ ok: true, json: async () => [] }),
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(script, context);

const app = context.__app;
app.state.data = {
  mods: [
    { id: 'blaze-blessing-general', name: 'Blaze Blessing', category: 'Weapon Mod', slot: 'Weapon', variant: 'General', rarity: 'legendary' },
    { id: 'blaze-blessing-violent', name: 'Blaze Blessing', category: 'Weapon Mod', slot: 'Weapon', variant: 'Violent', rarity: 'legendary' },
    { id: 'covered-advance-general', name: 'Covered Advance', category: 'Armor Mod', slot: 'Shoes', variant: 'General', rarity: 'legendary' },
    { id: 'covered-advance-violent', name: 'Covered Advance', category: 'Armor Mod', slot: 'Shoes', variant: 'Violent', rarity: 'legendary' },
  ],
  weapons: [
    { id: 'gun-a', name: 'Gun A', type: 'SMG', rarity: 'legendary' },
    { id: 'gun-b', name: 'Gun B', type: 'AR', rarity: 'epic' },
    { id: 'm416-silent-anabasis', name: 'M416 - Silent Anabasis', type: 'Assault Rifle', rarity: 'legendary' },
  ],
  armor: [], deviations: [], cradle: [], food: []
};

assert.strictEqual(app.displayNameFor(app.state.data.mods[0], 'weaponMods'), 'Blaze Blessing - General');
assert.strictEqual(app.metaFor(app.state.data.mods[1], 'weaponMods'), 'Legendary');
assert(!app.metaFor(app.state.data.mods[1], 'weaponMods').includes('Weapon Mod'));
assert(!app.metaFor(app.state.data.mods[1], 'weaponMods').includes('Weapon'));

const build = app.defaultBuild();
build.guns.primary = 'gun-a';
build.weaponMods.primary = 'blaze-blessing-general';
build.armorSlots.shoes.mod = 'covered-advance-general';
build.cradle = ['slot-a', '', '', '', '', '', '', ''];
build.food.main1 = 'food-a';
app.state.builds = [build];

const m416Build = app.defaultBuild();
m416Build.guns.primary = 'm416-silent-anabasis';

assert(app.buildMatchesGunSearch(m416Build, 'silent'), 'gun search matches primary gun name');
assert(app.buildMatchesGunSearch(m416Build, 'assault'), 'gun search matches gun metadata');
assert(!app.buildMatchesGunSearch(build, 'silent'), 'gun search excludes builds without matching guns');

let filtered = app.getAvailableOptionsForPicker(build, 'guns.secondary', 'weapons').map(item => item.id);
assert(!filtered.includes('gun-a'));
assert(filtered.includes('gun-b'));

filtered = app.getAvailableOptionsForPicker(build, 'weaponMods.secondary', 'weaponMods').map(item => item.id);
assert(!filtered.includes('blaze-blessing-general'));
assert(filtered.includes('blaze-blessing-violent'));

filtered = app.getAvailableOptionsForPicker(build, 'armorSlots.shoes.mod', 'armorMods:Shoes').map(item => item.id);
assert(filtered.includes('covered-advance-general'), 'current selected value remains available when editing its own picker');
assert(filtered.includes('covered-advance-violent'));

const rowHtml = app.renderBuildRow(build);
assert(html.includes('<th class="col-food">Food</th>'), 'food column exists');
assert(html.includes('<th class="col-chef">Chef</th>'), 'chef column exists');
assert(rowHtml.includes('<td class="col-food"'), 'row has a food cell');
assert(rowHtml.includes('<td class="col-chef"'), 'row has a chef cell');
assert(rowHtml.indexOf('Main 1') < rowHtml.indexOf('<td class="col-chef"'), 'main food stays in food column');
assert(rowHtml.indexOf('Main 2') < rowHtml.indexOf('<td class="col-chef"'), 'main food stays in food column');
assert(rowHtml.indexOf('Chef 1') > rowHtml.indexOf('<td class="col-chef"'), 'chef 1 moved to chef column');
assert(rowHtml.indexOf('Chef 2') > rowHtml.indexOf('<td class="col-chef"'), 'chef 2 moved to chef column');

const printHtml = app.renderPrintBuild(build, 0);
assert(printHtml.includes('<h3>Food</h3>'), 'print output keeps food section');
assert(printHtml.includes('<h3>Chef</h3>'), 'print output has separate chef section');
assert(printHtml.indexOf('Main 1') < printHtml.indexOf('<h3>Chef</h3>'), 'print food section only contains main food before chef section');
assert(printHtml.indexOf('Chef 1') > printHtml.indexOf('<h3>Chef</h3>'), 'print chef section contains chef items');

const pngModel = app.getPngExportModel(build, 0);
assert.strictEqual(pngModel.title, 'Build 1 — High HP');
assert(pngModel.sections.some(section => section.title === 'Gun'), 'PNG model includes gun section');
assert(pngModel.sections.some(section => section.title === 'Build Type'), 'PNG model includes centered build type section');
assert(pngModel.sections.some(section => section.title === 'Chef'), 'PNG model includes chef section');
assert(pngModel.sections.flatMap(section => section.items).some(item => item.name === 'Gun A'), 'PNG model includes selected gun names');

assert(html.includes('id="gunSearch"'), 'gun search input exists');
assert(html.includes('id="exportAllPngBtn"'), 'export all PNG button exists');
assert(html.includes('data-action="export-row-png"'), 'per-row PNG export action exists');
assert(html.includes('text-align-last: center'), 'build type select is centered');
assert(html.includes('id="themeToggleBtn"'), 'theme toggle button exists');
assert(html.includes('data-theme="light"'), 'light cream theme CSS exists');
assert(html.includes('sticky'), 'sticky tooltip support exists');

console.log('ui-regression tests passed');
