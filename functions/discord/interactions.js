import { InteractionResponseType, InteractionType, verifyKey } from 'discord-interactions';

const EPHEMERAL = 1 << 6;
const COMMAND_NAME = 'searchbuild';
const BUILD_STATE_KEY = 'builds';
const MAX_BUTTON_RESULTS = 25;
const DATA_FILES = {
  weapons: '/data/weapons.json',
  armor: '/data/armor.json',
  mods: '/data/mods.json',
  animalSkins: '/data/animal-skins.json',
  calibrations: '/data/calibrations.json',
  deviations: '/data/deviations.json',
  cradle: '/data/cradle.json',
  food: '/data/food.json'
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

async function verifyDiscordRequest(request, publicKey) {
  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');
  const body = await request.text();

  if (!signature || !timestamp || !publicKey) {
    return { isValid: false, body };
  }

  const isValid = await verifyKey(body, signature, timestamp, publicKey);
  return { isValid, body };
}

async function ensureSchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
}

async function loadBuilds(db) {
  await ensureSchema(db);
  const row = await db.prepare('SELECT value FROM app_state WHERE key = ?').bind(BUILD_STATE_KEY).first();
  if (!row?.value) return [];

  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function loadPlannerData(request) {
  const entries = await Promise.all(Object.entries(DATA_FILES).map(async ([key, path]) => {
    const response = await fetch(new URL(path, request.url));
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    return [key, await response.json()];
  }));
  return Object.fromEntries(entries);
}

function optionValue(interaction, name) {
  return interaction.data?.options?.find(option => option.name === name)?.value || '';
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function includesTerm(value, term) {
  return normalize(value).includes(normalize(term));
}

function byId(data, collection, id) {
  return (data[collection] || []).find(item => item.id === id) || null;
}

function displayName(item, collection) {
  if (!item) return '—';
  if (collection === 'mods' && item.variant) return `${item.name} - ${item.variant}`;
  if (collection === 'calibrations') return String(item.name || '').replace(/^Calibration Blueprint -\s*/i, '') || '—';
  return item.name || '—';
}

function buildTitle(build, index) {
  const name = String(build.name || '').trim();
  return name || `Build ${index + 1}: ${build.buildType || 'Build'}`;
}

function buildMatches(build, data, gunQuery, hpSelection) {
  if (build.buildType !== hpSelection) return false;

  const primary = byId(data, 'weapons', build.guns?.primary);
  const secondary = byId(data, 'weapons', build.guns?.secondary);
  return includesTerm(displayName(primary, 'weapons'), gunQuery)
    || includesTerm(displayName(secondary, 'weapons'), gunQuery);
}

function compactLine(label, value) {
  return `**${label}:** ${value || '—'}`;
}

function itemLine(label, data, collection, id) {
  return compactLine(label, displayName(byId(data, collection, id), collection));
}

function armorLine(slotLabel, slot, data) {
  const armor = displayName(byId(data, 'armor', slot?.armor), 'armor');
  const skin = displayName(byId(data, 'animalSkins', slot?.animalSkin), 'animalSkins');
  const mod = displayName(byId(data, 'mods', slot?.mod), 'mods');
  return `**${slotLabel}:** ${armor} / ${skin} / ${mod}`;
}

function buildEmbed(build, index, data) {
  const title = buildTitle(build, index);
  const primaryGun = byId(data, 'weapons', build.guns?.primary);
  const secondaryGun = byId(data, 'weapons', build.guns?.secondary);
  const armor = build.armorSlots || {};
  const cradle = (build.cradle || []).map((id, i) => `${i + 1}. ${displayName(byId(data, 'cradle', id), 'cradle')}`).join('\n') || '—';

  return {
    title: `Once Human Build: ${title}`,
    color: 0xf0b429,
    thumbnail: primaryGun?.imageUrl ? { url: primaryGun.imageUrl } : undefined,
    fields: [
      { name: 'Build Type', value: build.buildType || '—', inline: true },
      { name: 'Guns', value: [
        itemLine('Primary', data, 'weapons', build.guns?.primary),
        itemLine('Secondary', data, 'weapons', build.guns?.secondary)
      ].join('\n'), inline: false },
      { name: 'Weapon Mods', value: [
        itemLine('Primary', data, 'mods', build.weaponMods?.primary),
        itemLine('Secondary', data, 'mods', build.weaponMods?.secondary)
      ].join('\n'), inline: false },
      { name: 'Calibrations', value: [
        itemLine('Primary', data, 'calibrations', build.calibrations?.primary),
        itemLine('Secondary', data, 'calibrations', build.calibrations?.secondary)
      ].join('\n'), inline: false },
      { name: 'Armor', value: [
        armorLine('Mask', armor.mask, data),
        armorLine('Head', armor.head, data),
        armorLine('Legs', armor.legs, data),
        armorLine('Shoes', armor.shoes, data),
        armorLine('Top', armor.top, data)
      ].join('\n').slice(0, 1024), inline: false },
      { name: 'Deviation', value: displayName(byId(data, 'deviations', build.deviation), 'deviations'), inline: true },
      { name: 'Cradle', value: cradle.slice(0, 1024), inline: false },
      { name: 'Food', value: [
        itemLine('Main 1', data, 'food', build.food?.main1),
        itemLine('Main 2', data, 'food', build.food?.main2),
        itemLine('Chef 1', data, 'food', build.food?.chef1),
        itemLine('Chef 2', data, 'food', build.food?.chef2)
      ].join('\n'), inline: false }
    ],
    footer: { text: `Build ID: ${build.id}` }
  };
}

function buildUrl(siteUrl, build, data) {
  const primary = byId(data, 'weapons', build.guns?.primary);
  const secondary = byId(data, 'weapons', build.guns?.secondary);
  const gun = primary?.name || secondary?.name || '';
  const url = new URL(siteUrl || 'https://ohbuild.saitohsmedia.com/');
  if (gun) url.searchParams.set('gun', gun);
  if (build.buildType) url.searchParams.set('hp', build.buildType);
  if (build.id) url.searchParams.set('build', build.id);
  return url.toString();
}

function buildComponents(build, data, siteUrl) {
  const openUrl = buildUrl(siteUrl, build, data);
  const exportUrl = new URL(openUrl);
  exportUrl.searchParams.set('export', 'png');

  return [{
    type: 1,
    components: [
      { type: 2, style: 5, label: 'Open Build', url: openUrl },
      { type: 2, style: 5, label: 'Export PNG', url: exportUrl.toString() }
    ]
  }];
}

function resultButtons(matches) {
  const rows = [];
  for (let i = 0; i < Math.min(matches.length, MAX_BUTTON_RESULTS); i += 5) {
    rows.push({
      type: 1,
      components: matches.slice(i, i + 5).map(match => ({
        type: 2,
        style: 1,
        label: buildTitle(match.build, match.index).slice(0, 80),
        custom_id: `build:${match.build.id}`
      }))
    });
  }
  return rows;
}

function ephemeral(data) {
  return jsonResponse({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { flags: EPHEMERAL, ...data }
  });
}

async function handleSearch(interaction, context, request) {
  if (context.env.ALLOWED_CHANNEL_ID && interaction.channel_id !== context.env.ALLOWED_CHANNEL_ID) {
    return ephemeral({ content: 'This command is only enabled in the Once Human build channel.' });
  }

  const gunQuery = optionValue(interaction, 'gun');
  const hpSelection = optionValue(interaction, 'hp');
  const builds = await loadBuilds(context.env.DB);
  const data = await loadPlannerData(request);
  const matches = builds
    .map((build, index) => ({ build, index }))
    .filter(match => buildMatches(match.build, data, gunQuery, hpSelection));

  if (!matches.length) {
    return ephemeral({ content: `No ${hpSelection} builds found for gun search: **${gunQuery}**.` });
  }

  if (matches.length === 1) {
    const { build, index } = matches[0];
    return ephemeral({ embeds: [buildEmbed(build, index, data)], components: buildComponents(build, data, context.env.SITE_URL) });
  }

  return ephemeral({
    embeds: [{
      title: `${matches.length} builds found`,
      description: `Gun: **${gunQuery}**\nHP: **${hpSelection}**\n\nPick a build below.`,
      color: 0xf0b429,
      fields: matches.slice(0, MAX_BUTTON_RESULTS).map(match => ({
        name: buildTitle(match.build, match.index),
        value: `Build ${match.index + 1}`,
        inline: true
      })),
      footer: matches.length > MAX_BUTTON_RESULTS ? { text: `Showing first ${MAX_BUTTON_RESULTS} results.` } : undefined
    }],
    components: resultButtons(matches)
  });
}

async function handleComponent(interaction, context, request) {
  if (context.env.ALLOWED_CHANNEL_ID && interaction.channel_id !== context.env.ALLOWED_CHANNEL_ID) {
    return ephemeral({ content: 'This command is only enabled in the Once Human build channel.' });
  }

  const customId = interaction.data?.custom_id || '';
  if (!customId.startsWith('build:')) {
    return ephemeral({ content: 'Unknown build action.' });
  }

  const buildId = customId.slice('build:'.length);
  const builds = await loadBuilds(context.env.DB);
  const data = await loadPlannerData(request);
  const index = builds.findIndex(build => build.id === buildId);
  const build = builds[index];
  if (!build) return ephemeral({ content: 'That build no longer exists.' });

  return ephemeral({
    embeds: [buildEmbed(build, index, data)],
    components: buildComponents(build, data, context.env.SITE_URL)
  });
}

export async function onRequestPost(context) {
  const verification = await verifyDiscordRequest(context.request, context.env.DISCORD_PUBLIC_KEY);
  if (!verification.isValid) return new Response('Bad request signature', { status: 401 });

  const interaction = JSON.parse(verification.body);
  if (interaction.type === InteractionType.PING) {
    return jsonResponse({ type: InteractionResponseType.PONG });
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND && interaction.data?.name === COMMAND_NAME) {
    return handleSearch(interaction, context, context.request);
  }

  if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
    return handleComponent(interaction, context, context.request);
  }

  return ephemeral({ content: 'Unsupported interaction.' });
}

export async function onRequestGet() {
  return new Response('Once Human Build Planner Discord endpoint is alive. POST Discord interactions here.', { status: 200 });
}
