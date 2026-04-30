const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync('index.html', 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1]
  .replace(/\n\s*init\(\);\s*$/, '') + `\n\nglobalThis.__app = {\n  state,\n  defaultBuild,\n  displayNameFor,\n  metaFor,\n  getAvailableOptionsForPicker\n};`;

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

let filtered = app.getAvailableOptionsForPicker(build, 'guns.secondary', 'weapons').map(item => item.id);
assert(!filtered.includes('gun-a'));
assert(filtered.includes('gun-b'));

filtered = app.getAvailableOptionsForPicker(build, 'weaponMods.secondary', 'weaponMods').map(item => item.id);
assert(!filtered.includes('blaze-blessing-general'));
assert(filtered.includes('blaze-blessing-violent'));

filtered = app.getAvailableOptionsForPicker(build, 'armorSlots.shoes.mod', 'armorMods:Shoes').map(item => item.id);
assert(filtered.includes('covered-advance-general'), 'current selected value remains available when editing its own picker');
assert(filtered.includes('covered-advance-violent'));

assert(html.includes('id="themeToggleBtn"'), 'theme toggle button exists');
assert(html.includes('data-theme="light"'), 'light cream theme CSS exists');
assert(html.includes('sticky'), 'sticky tooltip support exists');

console.log('ui-regression tests passed');
