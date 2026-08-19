import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import OpenAI from "openai";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

// ============================================================
// CONFIG
// ============================================================

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.6-terra";
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
const OPENAI_IMAGE_QUALITY = ["low", "medium", "high"].includes(
  String(process.env.OPENAI_IMAGE_QUALITY || "low").toLowerCase()
)
  ? String(process.env.OPENAI_IMAGE_QUALITY || "low").toLowerCase()
  : "low";
const AUTO_IMAGE_LIMIT = 3;
const SCENE_COOLDOWN_MS = 10 * 60 * 1000;
const PORTRAIT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

if (!DISCORD_TOKEN) throw new Error("Missing DISCORD_TOKEN.");
if (!DISCORD_CLIENT_ID) throw new Error("Missing DISCORD_CLIENT_ID.");

const fallbackDataFile = path.join(process.cwd(), "dnd-data.json");
const preferredDataFile = "/data/dnd-data.json";
const DATA_FILE =
  process.env.DATA_FILE ||
  (fs.existsSync("/data") ? preferredDataFile : fallbackDataFile);

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ============================================================
// GAME CONSTANTS
// ============================================================

const ANCESTRIES = [
  ["Human", "🧑"],
  ["Elf", "🧝"],
  ["Dwarf", "⛏️"],
  ["Half-Orc", "🪓"],
  ["Tiefling", "🔥"],
  ["Dragonborn", "🐉"],
  ["Halfling", "🍀"],
  ["Custom", "✨"],
];

const BACKGROUNDS = [
  "Soldier",
  "Criminal",
  "Hunter",
  "Scholar",
  "Noble",
  "Outlander",
  "Entertainer",
  "Acolyte",
];

const CLASS_DATA = {
  Fighter: {
    emoji: "⚔️",
    hitDie: 10,
    baseHp: 12,
    ac: 16,
    stats: { STR: 3, DEX: 1, CON: 2, INT: 0, WIS: 1, CHA: 0 },
    loadouts: {
      "Sword & Shield": ["Longsword", "Shield", "Chain Shirt", "Explorer's Pack"],
      "Great Weapon": ["Greatsword", "Chain Shirt", "Explorer's Pack", "2 Healing Draughts"],
      Archer: ["Longbow", "Shortsword", "Leather Armor", "Quiver", "Explorer's Pack"],
    },
    abilities: ["Second Wind", "Weapon Training"],
  },
  Barbarian: {
    emoji: "🪓",
    hitDie: 12,
    baseHp: 14,
    ac: 14,
    stats: { STR: 3, DEX: 1, CON: 3, INT: -1, WIS: 1, CHA: 0 },
    loadouts: {
      Berserker: ["Greataxe", "2 Handaxes", "Explorer's Pack"],
      Raider: ["Battleaxe", "Shield", "4 Javelins", "Explorer's Pack"],
      "Wild Hunter": ["Greatclub", "Shortbow", "Hunting Pack", "2 Healing Draughts"],
    },
    abilities: ["Rage", "Reckless Strike"],
  },
  Rogue: {
    emoji: "🗡️",
    hitDie: 8,
    baseHp: 10,
    ac: 14,
    stats: { STR: 0, DEX: 3, CON: 1, INT: 1, WIS: 1, CHA: 2 },
    loadouts: {
      Thief: ["Rapier", "Dagger", "Leather Armor", "Thieves' Tools", "Burglar's Pack"],
      Scout: ["Shortbow", "2 Daggers", "Leather Armor", "Scout Pack"],
      Duelist: ["Rapier", "Shortsword", "Leather Armor", "Explorer's Pack"],
    },
    abilities: ["Sneak Attack", "Cunning Action"],
  },
  Ranger: {
    emoji: "🏹",
    hitDie: 10,
    baseHp: 12,
    ac: 14,
    stats: { STR: 1, DEX: 3, CON: 2, INT: 0, WIS: 2, CHA: 0 },
    loadouts: {
      Hunter: ["Longbow", "Shortsword", "Leather Armor", "Hunting Pack"],
      Wanderer: ["Longsword", "Shield", "Leather Armor", "Explorer's Pack"],
      Scout: ["2 Shortswords", "Shortbow", "Leather Armor", "Scout Pack"],
    },
    abilities: ["Hunter's Mark", "Trailwise"],
  },
  Wizard: {
    emoji: "🧙",
    hitDie: 6,
    baseHp: 8,
    ac: 11,
    stats: { STR: -1, DEX: 1, CON: 1, INT: 3, WIS: 2, CHA: 0 },
    loadouts: {
      Scholar: ["Quarterstaff", "Spellbook", "Component Pouch", "Scholar's Pack"],
      Wanderer: ["Dagger", "Spellbook", "Arcane Focus", "Explorer's Pack"],
      "Battle Mage": ["Quarterstaff", "Spellbook", "Arcane Focus", "2 Healing Draughts"],
    },
    abilities: ["Arcane Recovery", "Spellcasting"],
    spells: ["Fire Bolt", "Mage Hand", "Magic Missile", "Shield", "Detect Magic"],
  },
  Cleric: {
    emoji: "✨",
    hitDie: 8,
    baseHp: 10,
    ac: 16,
    stats: { STR: 1, DEX: 0, CON: 2, INT: 0, WIS: 3, CHA: 1 },
    loadouts: {
      Guardian: ["Mace", "Shield", "Scale Armor", "Holy Symbol", "Priest's Pack"],
      Healer: ["Mace", "Shield", "Leather Armor", "Holy Symbol", "Healer's Kit"],
      Pilgrim: ["Warhammer", "Shield", "Scale Armor", "Holy Symbol", "Explorer's Pack"],
    },
    abilities: ["Divine Spark", "Spellcasting"],
    spells: ["Sacred Flame", "Guidance", "Healing Word", "Bless", "Sanctuary"],
  },
  Bard: {
    emoji: "🎵",
    hitDie: 8,
    baseHp: 10,
    ac: 13,
    stats: { STR: 0, DEX: 2, CON: 1, INT: 1, WIS: 0, CHA: 3 },
    loadouts: {
      Minstrel: ["Rapier", "Lute", "Leather Armor", "Entertainer's Pack"],
      Storyteller: ["Shortsword", "Flute", "Leather Armor", "Scholar's Pack"],
      Wanderer: ["Rapier", "Drum", "Leather Armor", "Explorer's Pack"],
    },
    abilities: ["Bardic Inspiration", "Spellcasting"],
    spells: ["Vicious Mockery", "Minor Illusion", "Healing Word", "Dissonant Whispers", "Charm"],
  },
  Warlock: {
    emoji: "🌑",
    hitDie: 8,
    baseHp: 10,
    ac: 13,
    stats: { STR: 0, DEX: 2, CON: 1, INT: 1, WIS: 0, CHA: 3 },
    loadouts: {
      Occultist: ["Dagger", "Arcane Focus", "Leather Armor", "Scholar's Pack"],
      Hexblade: ["Longsword", "Arcane Focus", "Leather Armor", "Explorer's Pack"],
      Wanderer: ["Light Crossbow", "Dagger", "Arcane Focus", "Explorer's Pack"],
    },
    abilities: ["Eldritch Blast", "Pact Magic"],
    spells: ["Eldritch Blast", "Mage Hand", "Hex", "Armor of Shadows", "Charm"],
  },
};

const STAT_STYLES = {
  Recommended: null,
  Balanced: { STR: 2, DEX: 2, CON: 2, INT: 1, WIS: 1, CHA: 1 },
  Random: null,
};

const SKILL_TO_ABILITY = {
  Athletics: "STR",
  Acrobatics: "DEX",
  SleightOfHand: "DEX",
  Stealth: "DEX",
  Arcana: "INT",
  History: "INT",
  Investigation: "INT",
  Nature: "INT",
  Religion: "INT",
  AnimalHandling: "WIS",
  Insight: "WIS",
  Medicine: "WIS",
  Perception: "WIS",
  Survival: "WIS",
  Deception: "CHA",
  Intimidation: "CHA",
  Performance: "CHA",
  Persuasion: "CHA",
  Strength: "STR",
  Dexterity: "DEX",
  Constitution: "CON",
  Intelligence: "INT",
  Wisdom: "WIS",
  Charisma: "CHA",
  Attack: "STR",
  RangedAttack: "DEX",
  SpellAttack: "INT",
};

// ============================================================
// DATA STORE
// ============================================================

function defaultData() {
  return {
    version: 1,
    characters: {},
    parties: {},
    campaigns: {},
  };
}

let data = loadData();

function ensureDataDirectory() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadData() {
  try {
    ensureDataDirectory();
    if (!fs.existsSync(DATA_FILE)) return defaultData();
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      ...defaultData(),
      ...parsed,
      characters: parsed.characters || {},
      parties: parsed.parties || {},
      campaigns: parsed.campaigns || {},
    };
  } catch (err) {
    console.error("Failed to load data:", err);
    return defaultData();
  }
}

let saveTimer = null;

function saveDataSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveData, 150);
}

function saveData() {
  try {
    ensureDataDirectory();
    const temp = `${DATA_FILE}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(temp, DATA_FILE);
  } catch (err) {
    console.error("Failed to save data:", err);
  }
}

// ============================================================
// HELPERS
// ============================================================

function uid() {
  return crypto.randomBytes(6).toString("hex");
}

function partyCode() {
  let code = "";
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function truncate(text, max = 1000) {
  const s = String(text ?? "");
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

function cleanPlayerText(text) {
  return String(text || "")
    .replace(/<@!?\d+>/g, "")
    .trim()
    .slice(0, 1200);
}

function rollDie(sides) {
  return Math.floor(Math.random() * sides) + 1;
}

function parseDice(expression) {
  const cleaned = String(expression || "d20")
    .toLowerCase()
    .replace(/\s+/g, "");

  const match = cleaned.match(/^(\d*)d(4|6|8|10|12|20|100)([+-]\d+)?$/);
  if (!match) return null;

  const count = clamp(parseInt(match[1] || "1", 10), 1, 20);
  const sides = parseInt(match[2], 10);
  const modifier = parseInt(match[3] || "0", 10);

  return { count, sides, modifier };
}

function rollDice(expression) {
  const parsed = parseDice(expression);
  if (!parsed) return null;

  const rolls = [];
  for (let i = 0; i < parsed.count; i++) rolls.push(rollDie(parsed.sides));
  const raw = rolls.reduce((a, b) => a + b, 0);
  const total = raw + parsed.modifier;

  return { ...parsed, rolls, raw, total };
}

function formatModifier(n) {
  return n >= 0 ? `+${n}` : `${n}`;
}

function statsForClass(className, style) {
  const classData = CLASS_DATA[className];
  if (!classData) return { STR: 0, DEX: 0, CON: 0, INT: 0, WIS: 0, CHA: 0 };

  if (style === "Balanced") return { ...STAT_STYLES.Balanced };

  if (style === "Random") {
    const pool = [3, 2, 2, 1, 1, 0];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const keys = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];
    return Object.fromEntries(keys.map((key, i) => [key, pool[i]]));
  }

  return { ...classData.stats };
}

function getCharacter(guildId, userId) {
  return data.characters[`${guildId}:${userId}`] || null;
}

function setCharacter(guildId, userId, character) {
  data.characters[`${guildId}:${userId}`] = character;
  saveDataSoon();
}

function getPartyByMember(guildId, userId) {
  return Object.values(data.parties).find(
    (p) => p.guildId === guildId && p.memberIds.includes(userId)
  );
}

function getPartyByCode(guildId, code) {
  const upper = String(code || "").toUpperCase();
  return Object.values(data.parties).find(
    (p) => p.guildId === guildId && p.code === upper
  );
}

function getActiveCampaignForChannel(guildId, channelId) {
  return Object.values(data.campaigns).find(
    (c) =>
      c.guildId === guildId &&
      c.channelId === channelId &&
      c.status === "active"
  );
}

function getCampaignForParty(partyId) {
  return Object.values(data.campaigns)
    .filter((c) => c.partyId === partyId && c.status !== "ended")
    .sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;
}

// Find the exact pending roll for a player. We prefer the active campaign in
// the channel where /roll was used, then fall back to any active/saved
// campaign for that party that is actually holding that player's pending
// check. This prevents an older/newer duplicate campaign from stealing /roll.
function findPendingCheckCampaign(guildId, channelId, partyId, userId) {
  const candidates = Object.values(data.campaigns)
    .filter(
      (c) =>
        c.guildId === guildId &&
        c.partyId === partyId &&
        c.status !== "ended" &&
        c.pendingChecks?.[userId]
    )
    .sort((a, b) => {
      const aSameChannel = a.channelId === channelId ? 1 : 0;
      const bSameChannel = b.channelId === channelId ? 1 : 0;
      if (aSameChannel !== bSameChannel) return bSameChannel - aSameChannel;

      const aActive = a.status === "active" ? 1 : 0;
      const bActive = b.status === "active" ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;

      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });

  const campaign = candidates[0] || null;
  return campaign
    ? { campaign, pending: campaign.pendingChecks[userId] }
    : { campaign: null, pending: null };
}

function appendLog(campaign, entry) {
  campaign.log ||= [];
  campaign.log.push({
    at: Date.now(),
    ...entry,
  });
  if (campaign.log.length > 80) campaign.log = campaign.log.slice(-80);
  campaign.updatedAt = Date.now();
  saveDataSoon();
}

function makeCharacterEmbed(character, ownerName = "") {
  const classInfo = CLASS_DATA[character.className] || { emoji: "🧙" };

  const statLine = Object.entries(character.stats)
    .map(([k, v]) => `**${k}** ${formatModifier(v)}`)
    .join("  |  ");

  const embed = new EmbedBuilder()
    .setTitle(`${classInfo.emoji} ${character.name}`)
    .setDescription(
      `Level ${character.level} ${character.ancestry} ${character.className}\n` +
      `**Background:** ${character.background}`
    )
    .addFields(
      {
        name: "❤️ Health",
        value: `${character.hp}/${character.maxHp} HP`,
        inline: true,
      },
      {
        name: "🛡️ Armor Class",
        value: `${character.ac}`,
        inline: true,
      },
      {
        name: "⭐ XP",
        value: `${character.xp}`,
        inline: true,
      },
      {
        name: "📊 Stats",
        value: statLine,
      },
      {
        name: "🎒 Equipment",
        value: character.inventory.join(", ") || "None",
      },
      {
        name: "✨ Abilities",
        value: character.abilities.join(", ") || "None",
      },
      {
        name: "🎯 Goal",
        value: truncate(character.goal, 500),
        inline: true,
      },
      {
        name: "😨 Fear",
        value: truncate(character.fear, 500),
        inline: true,
      },
      {
        name: "🗣️ Quirk",
        value: truncate(character.quirk, 500),
        inline: true,
      },
      {
        name: "📖 Backstory",
        value: truncate(character.backstory, 1000),
      }
    );

  if (character.spells?.length) {
    embed.addFields({
      name: "🔮 Spells",
      value: character.spells.join(", "),
    });
  }

  if (ownerName) embed.setFooter({ text: `Player: ${ownerName}` });
  return embed;
}

function makeInventoryEmbed(character) {
  return new EmbedBuilder()
    .setTitle(`🎒 ${character.name}'s Inventory`)
    .setDescription(
      character.inventory.length
        ? character.inventory.map((x, i) => `**${i + 1}.** ${x}`).join("\n")
        : "This pack is empty."
    )
    .addFields({
      name: "💰 Gold",
      value: `${character.gold}`,
      inline: true,
    });
}

async function sendLong(channel, text, options = {}) {
  const content = String(text || "").trim();
  if (!content) return;

  const chunks = [];
  let remaining = content;

  while (remaining.length > 1900) {
    let cut = remaining.lastIndexOf("\n", 1900);
    if (cut < 1000) cut = remaining.lastIndexOf(" ", 1900);
    if (cut < 1000) cut = 1900;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) chunks.push(remaining);

  for (let i = 0; i < chunks.length; i++) {
    await channel.send({
      content: chunks[i],
      allowedMentions: options.allowedMentions || { parse: [] },
    });
  }
}

function partyMembersContext(party) {
  return party.memberIds
    .map((userId) => {
      const c = getCharacter(party.guildId, userId);
      if (!c) return null;
      return {
        userId,
        name: c.name,
        ancestry: c.ancestry,
        className: c.className,
        level: c.level,
        hp: c.hp,
        maxHp: c.maxHp,
        ac: c.ac,
        stats: c.stats,
        background: c.background,
        goal: c.goal,
        fear: c.fear,
        quirk: c.quirk,
        secret: c.secret,
        inventory: c.inventory,
        abilities: c.abilities,
        spells: c.spells || [],
      };
    })
    .filter(Boolean);
}

function recentCampaignContext(campaign, limit = 20) {
  return (campaign.log || []).slice(-limit).map((e) => {
    if (e.type === "player") {
      return `${e.characterName || "Player"}: ${e.text}`;
    }
    if (e.type === "dm") {
      return `DM: ${e.text}`;
    }
    if (e.type === "roll") {
      return `ROLL: ${e.characterName} ${e.checkName} = ${e.total} (${e.outcome})`;
    }
    if (e.type === "system") {
      return `SYSTEM: ${e.text}`;
    }
    return JSON.stringify(e);
  });
}

// ============================================================
// CINEMATIC IMAGE SYSTEM
// ============================================================

const imageCooldowns = new Map();

function cooldownKey(type, guildId, userId) {
  return `${type}:${guildId}:${userId}`;
}

function remainingCooldown(type, guildId, userId, durationMs) {
  const last = imageCooldowns.get(cooldownKey(type, guildId, userId)) || 0;
  return Math.max(0, durationMs - (Date.now() - last));
}

function markImageCooldown(type, guildId, userId) {
  imageCooldowns.set(cooldownKey(type, guildId, userId), Date.now());
}

function formatCooldown(ms) {
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

function visualPartyContext(party) {
  return party.memberIds
    .map((userId) => {
      const c = getCharacter(party.guildId, userId);
      if (!c) return null;
      return `${c.name}: ${c.ancestry} ${c.className}; appearance: ${c.appearance}; equipment: ${c.inventory.slice(0, 5).join(", ")}`;
    })
    .filter(Boolean)
    .join("\n");
}

function recentSceneText(campaign, limit = 8) {
  return (campaign.log || [])
    .filter((e) => e.type === "dm" || e.type === "player" || e.type === "roll")
    .slice(-limit)
    .map((e) => {
      if (e.type === "dm") return `Dungeon Master: ${e.text}`;
      if (e.type === "player") return `${e.characterName}: ${e.text}`;
      if (e.type === "roll") {
        return `${e.characterName} rolled ${e.checkName}: ${e.total} (${e.outcome})`;
      }
      return "";
    })
    .join("\n");
}

function cinematicPrompt(sceneDescription, party, extra = "") {
  return `
Create a cinematic fantasy tabletop RPG illustration for a D&D-style Discord campaign.

VISUAL STYLE:
- Highly detailed cinematic fantasy concept art.
- Dramatic believable lighting, atmospheric depth, rich environmental storytelling.
- Mature adventurous fantasy tone, not childish and not comedic unless the scene itself is comedic.
- Wide cinematic composition unless specifically requested otherwise.
- Keep recurring player characters faithful to the descriptions below.
- Do not add captions, labels, logos, UI, borders, watermarks, stat blocks, dice, or readable text.
- Do not invent extra party members.

PARTY VISUAL REFERENCES:
${visualPartyContext(party) || "No party visual references available."}

CURRENT SCENE:
${sceneDescription}

${extra}
`.trim();
}

async function generateImageBuffer(prompt, {
  size = "1536x1024",
  quality = OPENAI_IMAGE_QUALITY,
} = {}) {
  if (!openai) {
    throw new Error("OpenAI is not configured.");
  }

  const result = await openai.images.generate({
    model: OPENAI_IMAGE_MODEL,
    prompt,
    size,
    quality,
    output_format: "jpeg",
    output_compression: 85,
  });

  const base64 = result.data?.[0]?.b64_json;
  if (!base64) throw new Error("Image API returned no image data.");
  return Buffer.from(base64, "base64");
}

function imageTypeLabel(type) {
  return (
    {
      location: "Major Location",
      npc: "Important NPC",
      monster: "Creature Reveal",
      discovery: "Major Discovery",
      cinematic: "Cinematic Moment",
    }[type] || "Cinematic Scene"
  );
}

async function sendGeneratedImage(channel, {
  title = "Cinematic Scene",
  prompt,
  filename = "campaign-scene.jpg",
  size = "1536x1024",
  quality = OPENAI_IMAGE_QUALITY,
}) {
  const buffer = await generateImageBuffer(prompt, { size, quality });
  const attachment = new AttachmentBuilder(buffer, { name: filename });

  await channel.send({
    content: `🖼️ **${title}**`,
    files: [attachment],
  });
}

async function maybeSendAutomaticImage(channel, campaign, party, imageData) {
  if (!imageData || imageData.image_type === "none" || !imageData.image_prompt) {
    return false;
  }

  campaign.autoImagesUsed ||= 0;
  if (campaign.autoImagesUsed >= AUTO_IMAGE_LIMIT) return false;

  // Reserve the slot immediately to prevent simultaneous messages from creating
  // more than the campaign limit. Give it back if generation fails.
  campaign.autoImagesUsed += 1;
  saveDataSoon();

  try {
    const prompt = cinematicPrompt(
      imageData.image_prompt,
      party,
      "This image represents an important reveal chosen by the Dungeon Master."
    );

    await sendGeneratedImage(channel, {
      title: imageTypeLabel(imageData.image_type),
      prompt,
      filename: `campaign-${campaign.id}-${campaign.autoImagesUsed}.jpg`,
      size: "1536x1024",
    });

    appendLog(campaign, {
      type: "system",
      text: `A cinematic image was generated for: ${imageTypeLabel(imageData.image_type)}.`,
    });
    return true;
  } catch (err) {
    campaign.autoImagesUsed = Math.max(0, (campaign.autoImagesUsed || 1) - 1);
    saveDataSoon();
    console.error("Automatic image generation error:", err);
    await channel.send(
      "⚠️ **The cinematic image couldn't be generated.** The story can continue normally; no automatic image slot was consumed."
    );
    return false;
  }
}

async function handleSceneCommand(interaction) {
  const party = getPartyByMember(interaction.guildId, interaction.user.id);
  if (!party) {
    return interaction.reply({
      ephemeral: true,
      content: "You need to be in a party before using `/scene`.",
    });
  }

  const campaign =
    getActiveCampaignForChannel(interaction.guildId, interaction.channelId) ||
    getCampaignForParty(party.id);

  if (!campaign || campaign.status !== "active") {
    return interaction.reply({
      ephemeral: true,
      content: "Your party needs an active adventure before using `/scene`.",
    });
  }

  if (campaign.partyId !== party.id) {
    return interaction.reply({
      ephemeral: true,
      content: "This channel belongs to a different active party.",
    });
  }

  const remaining = remainingCooldown(
    "scene",
    interaction.guildId,
    campaign.id,
    SCENE_COOLDOWN_MS
  );

  if (remaining > 0) {
    return interaction.reply({
      ephemeral: true,
      content: `🖼️ Your party's **/scene** is on cooldown for another **${formatCooldown(remaining)}**.`,
    });
  }

  await interaction.deferReply();
  markImageCooldown("scene", interaction.guildId, campaign.id);

  try {
    const scene = recentSceneText(campaign, 10) || campaign.summary;
    const prompt = cinematicPrompt(
      scene,
      party,
      "Illustrate the party's CURRENT moment only. Focus on the location, atmosphere, visible NPCs/creatures, and what is happening right now."
    );
    const buffer = await generateImageBuffer(prompt, {
      size: "1536x1024",
    });

    const attachment = new AttachmentBuilder(buffer, {
      name: `scene-${campaign.id}.jpg`,
    });

    await interaction.editReply({
      content: `🖼️ **Current Scene — ${campaign.title}**`,
      files: [attachment],
    });
  } catch (err) {
    // Give the cooldown back when the API itself fails.
    imageCooldowns.delete(cooldownKey("scene", interaction.guildId, campaign.id));
    console.error("/scene image error:", err);
    await interaction.editReply(
      "❌ I couldn't generate the scene image. Check the Railway logs. Your `/scene` cooldown was not consumed."
    );
  }
}

async function handlePortraitCommand(interaction) {
  const character = getCharacter(interaction.guildId, interaction.user.id);

  if (!character) {
    return interaction.reply({
      ephemeral: true,
      content: "Create a character first with `/createcharacter`.",
    });
  }

  const remaining = remainingCooldown(
    "portrait",
    interaction.guildId,
    interaction.user.id,
    PORTRAIT_COOLDOWN_MS
  );

  if (remaining > 0) {
    return interaction.reply({
      ephemeral: true,
      content: `🎨 **/portrait** is on cooldown for another **${formatCooldown(remaining)}**.`,
    });
  }

  await interaction.deferReply();
  markImageCooldown("portrait", interaction.guildId, interaction.user.id);

  try {
    const classInfo = CLASS_DATA[character.className];
    const prompt = `
Create a highly detailed cinematic fantasy character portrait for a tabletop RPG adventurer.

CHARACTER:
Name: ${character.name}
Ancestry: ${character.ancestry}
Class: ${character.className}
Background: ${character.background}
Appearance: ${character.appearance}
Equipment: ${character.inventory.join(", ")}
Personality quirk: ${character.quirk}

ART DIRECTION:
- Full-body or three-quarter heroic fantasy portrait.
- Faithfully follow the supplied physical appearance.
- Show class-appropriate clothing and the listed signature equipment.
- Dramatic fantasy lighting and believable materials.
- Neutral atmospheric fantasy background that does not overpower the character.
- No text, card frame, UI, logo, watermark, labels, or stat blocks.
- Do not visually reveal the character's private secret.
${classInfo?.emoji ? "" : ""}
`.trim();

    const buffer = await generateImageBuffer(prompt, {
      size: "1024x1536",
    });

    const attachment = new AttachmentBuilder(buffer, {
      name: `${character.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-portrait.jpg`,
    });

    await interaction.editReply({
      content: `🎨 **${character.name} — Character Portrait**`,
      files: [attachment],
    });
  } catch (err) {
    imageCooldowns.delete(cooldownKey("portrait", interaction.guildId, interaction.user.id));
    console.error("/portrait image error:", err);
    await interaction.editReply(
      "❌ I couldn't generate the character portrait. Check the Railway logs. Your `/portrait` cooldown was not consumed."
    );
  }
}

// ============================================================
// AI DM
// ============================================================

const DM_INSTRUCTIONS = `
You are the Dungeon Master for a fast-moving, Discord-friendly fantasy tabletop campaign.

STYLE:
- Cinematic fantasy with humor when the players invite it.
- Keep ordinary responses roughly 2-6 short paragraphs.
- Address characters by character name.
- Never control a player character's choices, dialogue, or private thoughts.
- Let creative and ridiculous actions be attempted.
- Do not present fixed multiple-choice options unless clarity truly requires it.
- End with a natural situation for the party to respond to.

RULES:
- The application code is the source of truth for HP, AC, inventory, stats, dice, party membership, and campaign state.
- NEVER invent a dice result.
- NEVER change HP, inventory, gold, XP, spell slots, or stats in narration.
- You may REQUEST one check when an uncertain action has meaningful consequences.
- If no roll is needed, use action_type "none".
- If a roll is needed, use action_type "check" and select the most suitable check.
- Use DCs roughly:
  8 easy, 10 routine, 12 moderate, 14 challenging, 16 hard, 18 very hard, 20+ exceptional.
- Do not reveal the numeric DC in narration.
- A player should not roll for trivial actions.
- A failed check should move the story forward with a consequence, complication, cost, or lost opportunity.
- Never claim a player succeeded or failed before the bot resolves the roll.
- Never reveal a character's private secret unless story events have actually exposed it.
- Weave player goals, fears, quirks, backgrounds, and secrets into the campaign gradually.
- Keep content appropriate for a general Discord gaming server.

CINEMATIC IMAGE RULES:
- Most DM responses MUST use image_type "none".
- Request an automatic image only for a truly memorable visual beat: a major new location reveal, first reveal of an important NPC, boss or major monster reveal, major discovery, or chapter-scale cinematic moment.
- Do not request images for ordinary conversation, routine exploration, normal attacks, small loot, skill checks, or every new room.
- When requesting an image, image_prompt must describe only what should visibly appear. Preserve known character/NPC traits and avoid readable text.
`;

const dmActionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    narration: { type: "string" },
    action_type: { type: "string", enum: ["none", "check"] },
    player_id: { type: "string" },
    check_name: {
      type: "string",
      enum: [
        "Athletics",
        "Acrobatics",
        "SleightOfHand",
        "Stealth",
        "Arcana",
        "History",
        "Investigation",
        "Nature",
        "Religion",
        "AnimalHandling",
        "Insight",
        "Medicine",
        "Perception",
        "Survival",
        "Deception",
        "Intimidation",
        "Performance",
        "Persuasion",
        "Strength",
        "Dexterity",
        "Constitution",
        "Intelligence",
        "Wisdom",
        "Charisma",
        "Attack",
        "RangedAttack",
        "SpellAttack",
        "None",
      ],
    },
    ability: {
      type: "string",
      enum: ["STR", "DEX", "CON", "INT", "WIS", "CHA", "NONE"],
    },
    dc: { type: "integer", minimum: 0, maximum: 30 },
    roll_reason: { type: "string" },
    consequences_success: { type: "string" },
    consequences_failure: { type: "string" },
    image_type: {
      type: "string",
      enum: ["none", "location", "npc", "monster", "discovery", "cinematic"],
    },
    image_prompt: { type: "string" },
  },
  required: [
    "narration",
    "action_type",
    "player_id",
    "check_name",
    "ability",
    "dc",
    "roll_reason",
    "consequences_success",
    "consequences_failure",
    "image_type",
    "image_prompt",
  ],
};

async function aiDMAction(campaign, party, actingUserId, playerText) {
  if (!openai) {
    return {
      narration:
        "⚠️ The AI Dungeon Master is not configured yet. Add `OPENAI_API_KEY` to the bot's environment variables.",
      action_type: "none",
      player_id: "",
      check_name: "None",
      ability: "NONE",
      dc: 0,
      roll_reason: "",
      consequences_success: "",
      consequences_failure: "",
      image_type: "none",
      image_prompt: "",
    };
  }

  const characters = partyMembersContext(party);
  const actingCharacter = getCharacter(campaign.guildId, actingUserId);

  const input = JSON.stringify(
    {
      campaign: {
        title: campaign.title,
        mode: campaign.mode,
        chapter: campaign.chapter,
        summary: campaign.summary,
        location: campaign.location,
      },
      party: characters,
      recentHistory: recentCampaignContext(campaign),
      currentAction: {
        playerId: actingUserId,
        characterName: actingCharacter?.name || "Unknown",
        text: playerText,
      },
      instruction:
        "Continue from the current action. If a meaningful uncertain action requires a roll, request exactly one check for the acting player. Otherwise narrate the result without a check.",
    },
    null,
    2
  );

  const response = await openai.responses.create({
    model: OPENAI_MODEL,
    instructions: DM_INSTRUCTIONS,
    input,
    text: {
      format: {
        type: "json_schema",
        name: "discord_dm_action",
        strict: true,
        schema: dmActionSchema,
      },
    },
  });

  return JSON.parse(response.output_text);
}

const narrationImageSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    narration: { type: "string" },
    image_type: {
      type: "string",
      enum: ["none", "location", "npc", "monster", "discovery", "cinematic"],
    },
    image_prompt: { type: "string" },
  },
  required: ["narration", "image_type", "image_prompt"],
};

async function aiOpening(campaign, party) {
  if (!openai) {
    return {
      narration:
        "⚠️ The campaign has been created, but the AI Dungeon Master is not configured. Add `OPENAI_API_KEY` to Railway and restart the bot.",
      image_type: "none",
      image_prompt: "",
    };
  }

  const input = JSON.stringify(
    {
      mode: campaign.mode,
      party: partyMembersContext(party),
      request:
        "Create the opening scene for a brand-new fantasy adventure. Give the party an immediate situation, mystery, danger, or intriguing NPC. Do not request a dice roll yet. End by asking what the party does. Because this is a chapter-opening cinematic, you MAY request one image if the scene has a strong visual identity.",
    },
    null,
    2
  );

  const response = await openai.responses.create({
    model: OPENAI_MODEL,
    instructions: DM_INSTRUCTIONS,
    input,
    text: {
      format: {
        type: "json_schema",
        name: "campaign_opening",
        strict: true,
        schema: narrationImageSchema,
      },
    },
  });

  return JSON.parse(response.output_text);
}

async function aiResume(campaign, party) {
  if (!openai) {
    return {
      narration: "⚠️ Add `OPENAI_API_KEY` before continuing the campaign.",
      image_type: "none",
      image_prompt: "",
    };
  }

  const input = JSON.stringify(
    {
      campaign: {
        title: campaign.title,
        chapter: campaign.chapter,
        summary: campaign.summary,
        location: campaign.location,
      },
      party: partyMembersContext(party),
      recentHistory: recentCampaignContext(campaign, 30),
      request:
        "Give a short Previously On recap, then re-establish the current scene and ask what the party does. Do not request a roll yet. Usually use image_type none; only request an image if resuming at a major cinematic reveal.",
    },
    null,
    2
  );

  const response = await openai.responses.create({
    model: OPENAI_MODEL,
    instructions: DM_INSTRUCTIONS,
    input,
    text: {
      format: {
        type: "json_schema",
        name: "campaign_resume",
        strict: true,
        schema: narrationImageSchema,
      },
    },
  });

  return JSON.parse(response.output_text);
}

async function aiResolveCheck(campaign, party, rollRecord, pending) {
  if (!openai) {
    return {
      narration:
        rollRecord.outcome === "SUCCESS"
          ? "The attempt succeeds."
          : "The attempt fails, and the situation becomes more complicated.",
      image_type: "none",
      image_prompt: "",
    };
  }

  const input = JSON.stringify(
    {
      campaign: {
        title: campaign.title,
        summary: campaign.summary,
        location: campaign.location,
      },
      party: partyMembersContext(party),
      recentHistory: recentCampaignContext(campaign),
      resolvedCheck: {
        characterName: rollRecord.characterName,
        checkName: rollRecord.checkName,
        naturalRoll: rollRecord.naturalRoll,
        modifier: rollRecord.modifier,
        total: rollRecord.total,
        dc: pending.dc,
        outcome: rollRecord.outcome,
        reason: pending.reason,
        successDirection: pending.successDirection,
        failureDirection: pending.failureDirection,
      },
      request:
        "Narrate the resolved result. Respect the exact success/failure outcome. Do not request another check in this response. Advance the fiction and give the party something to respond to. Only request an image if this resolved check causes a genuinely major reveal.",
    },
    null,
    2
  );

  const response = await openai.responses.create({
    model: OPENAI_MODEL,
    instructions: DM_INSTRUCTIONS,
    input,
    text: {
      format: {
        type: "json_schema",
        name: "resolved_check_narration",
        strict: true,
        schema: narrationImageSchema,
      },
    },
  });

  return JSON.parse(response.output_text);
}

async function aiCharacterStory(draft) {
  if (!openai) {
    return {
      backstory:
        `${draft.name} became an adventurer after leaving behind a life as a ${draft.background.toLowerCase()}. ` +
        `Their journey is driven by one purpose: ${draft.goal}. Their fear of ${draft.fear} is never far away, ` +
        `and companions quickly learn one peculiar truth: ${draft.quirk}.`,
      secret:
        "You possess a strange old token whose origin you cannot explain. It sometimes grows warm near ancient magic.",
    };
  }

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      backstory: { type: "string" },
      secret: { type: "string" },
    },
    required: ["backstory", "secret"],
  };

  const response = await openai.responses.create({
    model: OPENAI_MODEL,
    instructions: `
You create concise fantasy RPG character hooks for a Discord campaign.
Write a 90-160 word backstory using the player's supplied details.
Then create one private secret in 1-3 sentences.
The secret should be a future story hook, not a mechanical advantage.
Do not decide future plot outcomes.
Keep it suitable for a general gaming community.
`,
    input: JSON.stringify(draft, null, 2),
    text: {
      format: {
        type: "json_schema",
        name: "character_story",
        strict: true,
        schema,
      },
    },
  });

  return JSON.parse(response.output_text);
}

// ============================================================
// CHARACTER CREATION
// ============================================================

const creationSessions = new Map();

function sessionKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function createClassMenu(userId) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`cc_class:${userId}`)
    .setPlaceholder("Choose a class")
    .addOptions(
      Object.entries(CLASS_DATA).map(([name, d]) => ({
        label: name,
        value: name,
        emoji: d.emoji,
        description: `Start as a ${name}`,
      }))
    );

  return new ActionRowBuilder().addComponents(menu);
}

function createAncestryMenu(userId) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`cc_ancestry:${userId}`)
    .setPlaceholder("Choose an ancestry")
    .addOptions(
      ANCESTRIES.map(([name, emoji]) => ({
        label: name,
        value: name,
        emoji,
      }))
    );

  return new ActionRowBuilder().addComponents(menu);
}

function createBackgroundMenu(userId) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`cc_background:${userId}`)
    .setPlaceholder("Choose a background")
    .addOptions(
      BACKGROUNDS.map((name) => ({
        label: name,
        value: name,
      }))
    );

  return new ActionRowBuilder().addComponents(menu);
}

function createStatsMenu(userId) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`cc_stats:${userId}`)
    .setPlaceholder("Choose a stat style")
    .addOptions([
      {
        label: "Recommended",
        value: "Recommended",
        emoji: "⭐",
        description: "Best stats automatically chosen for your class.",
      },
      {
        label: "Balanced",
        value: "Balanced",
        emoji: "⚖️",
        description: "A well-rounded character.",
      },
      {
        label: "Random",
        value: "Random",
        emoji: "🎲",
        description: "Randomized modifiers for a little chaos.",
      },
    ]);

  return new ActionRowBuilder().addComponents(menu);
}

function createLoadoutMenu(userId, className) {
  const loadouts = CLASS_DATA[className]?.loadouts || {};
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`cc_loadout:${userId}`)
    .setPlaceholder("Choose starting equipment")
    .addOptions(
      Object.entries(loadouts).map(([name, items]) => ({
        label: name,
        value: name,
        description: truncate(items.join(", "), 95),
      }))
    );

  return new ActionRowBuilder().addComponents(menu);
}

async function startCharacterCreation(interaction) {
  const existing = getCharacter(interaction.guildId, interaction.user.id);

  const modal = new ModalBuilder()
    .setCustomId(`cc_details:${interaction.user.id}`)
    .setTitle(existing ? "Rebuild Your Adventurer" : "Create Your Adventurer");

  const name = new TextInputBuilder()
    .setCustomId("name")
    .setLabel("Character name")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(40);

  const appearance = new TextInputBuilder()
    .setCustomId("appearance")
    .setLabel("Appearance in one sentence")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(300);

  const goal = new TextInputBuilder()
    .setCustomId("goal")
    .setLabel("What does your character want most?")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(300);

  const fear = new TextInputBuilder()
    .setCustomId("fear")
    .setLabel("What is your character afraid of?")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(150);

  const quirk = new TextInputBuilder()
    .setCustomId("quirk")
    .setLabel("One strange personality quirk")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(300);

  modal.addComponents(
    new ActionRowBuilder().addComponents(name),
    new ActionRowBuilder().addComponents(appearance),
    new ActionRowBuilder().addComponents(goal),
    new ActionRowBuilder().addComponents(fear),
    new ActionRowBuilder().addComponents(quirk)
  );

  await interaction.showModal(modal);
}

async function handleCharacterDetails(interaction) {
  const ownerId = interaction.customId.split(":")[1];
  if (interaction.user.id !== ownerId) return;

  const draft = {
    guildId: interaction.guildId,
    userId: interaction.user.id,
    name: interaction.fields.getTextInputValue("name").trim(),
    appearance: interaction.fields.getTextInputValue("appearance").trim(),
    goal: interaction.fields.getTextInputValue("goal").trim(),
    fear: interaction.fields.getTextInputValue("fear").trim(),
    quirk: interaction.fields.getTextInputValue("quirk").trim(),
    ancestry: null,
    className: null,
    background: null,
    statStyle: null,
    loadout: null,
  };

  creationSessions.set(sessionKey(interaction.guildId, interaction.user.id), draft);

  await interaction.reply({
    ephemeral: true,
    content:
      `🧙 **Creating ${draft.name}**\n\n` +
      `**Step 1/5 — Choose your ancestry.**`,
    components: [createAncestryMenu(interaction.user.id)],
  });
}

async function handleCharacterSelect(interaction) {
  const [kind, ownerId] = interaction.customId.split(":");
  if (interaction.user.id !== ownerId) {
    return interaction.reply({
      ephemeral: true,
      content: "That character creator belongs to another player.",
    });
  }

  const key = sessionKey(interaction.guildId, interaction.user.id);
  const draft = creationSessions.get(key);

  if (!draft) {
    return interaction.update({
      content: "⚠️ This character-creation session expired. Run `/createcharacter` again.",
      components: [],
    });
  }

  const value = interaction.values[0];

  if (kind === "cc_ancestry") {
    draft.ancestry = value;
    return interaction.update({
      content:
        `🧙 **Creating ${draft.name}**\n\n` +
        `✅ Ancestry: **${draft.ancestry}**\n\n` +
        `**Step 2/5 — Choose your class.**`,
      components: [createClassMenu(interaction.user.id)],
    });
  }

  if (kind === "cc_class") {
    draft.className = value;
    return interaction.update({
      content:
        `🧙 **Creating ${draft.name}**\n\n` +
        `✅ Ancestry: **${draft.ancestry}**\n` +
        `✅ Class: **${draft.className}**\n\n` +
        `**Step 3/5 — Choose your background.**`,
      components: [createBackgroundMenu(interaction.user.id)],
    });
  }

  if (kind === "cc_background") {
    draft.background = value;
    return interaction.update({
      content:
        `🧙 **Creating ${draft.name}**\n\n` +
        `✅ Ancestry: **${draft.ancestry}**\n` +
        `✅ Class: **${draft.className}**\n` +
        `✅ Background: **${draft.background}**\n\n` +
        `**Step 4/5 — Choose how your stats are assigned.**`,
      components: [createStatsMenu(interaction.user.id)],
    });
  }

  if (kind === "cc_stats") {
    draft.statStyle = value;
    return interaction.update({
      content:
        `🧙 **Creating ${draft.name}**\n\n` +
        `✅ Ancestry: **${draft.ancestry}**\n` +
        `✅ Class: **${draft.className}**\n` +
        `✅ Background: **${draft.background}**\n` +
        `✅ Stats: **${draft.statStyle}**\n\n` +
        `**Step 5/5 — Choose your starting loadout.**`,
      components: [createLoadoutMenu(interaction.user.id, draft.className)],
    });
  }

  if (kind === "cc_loadout") {
    draft.loadout = value;
    await interaction.update({
      content: `✨ **Finishing ${draft.name}...**\nCreating your backstory and private character secret.`,
      components: [],
    });

    try {
      const story = await aiCharacterStory(draft);
      const classData = CLASS_DATA[draft.className];
      const stats = statsForClass(draft.className, draft.statStyle);
      const inventory = [...classData.loadouts[draft.loadout]];

      const character = {
        id: uid(),
        guildId: interaction.guildId,
        userId: interaction.user.id,
        name: draft.name,
        ancestry: draft.ancestry,
        className: draft.className,
        background: draft.background,
        appearance: draft.appearance,
        goal: draft.goal,
        fear: draft.fear,
        quirk: draft.quirk,
        secret: story.secret,
        backstory: story.backstory,
        statStyle: draft.statStyle,
        stats,
        level: 1,
        xp: 0,
        hp: classData.baseHp,
        maxHp: classData.baseHp,
        ac: classData.ac,
        gold: 10,
        inventory,
        abilities: [...classData.abilities],
        spells: [...(classData.spells || [])],
        conditions: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      setCharacter(interaction.guildId, interaction.user.id, character);
      creationSessions.delete(key);

      await interaction.followUp({
        ephemeral: true,
        embeds: [makeCharacterEmbed(character, interaction.user.username)],
      });

      const secretEmbed = new EmbedBuilder()
        .setTitle(`🔒 ${character.name}'s Private Secret`)
        .setDescription(character.secret)
        .setFooter({ text: "The AI DM knows this. Other players do not." });

      try {
        await interaction.user.send({ embeds: [secretEmbed] });
        await interaction.followUp({
          ephemeral: true,
          content:
            "✅ **Character saved!** I also sent your private character secret by DM.",
        });
      } catch {
        await interaction.followUp({
          ephemeral: true,
          content:
            "✅ **Character saved!** I couldn't DM you, so your secret is shown privately below.",
          embeds: [secretEmbed],
        });
      }
    } catch (err) {
      console.error("Character finalization error:", err);
      await interaction.followUp({
        ephemeral: true,
        content:
          "❌ I couldn't finish the character. Check the bot logs and your OpenAI configuration, then run `/createcharacter` again.",
      });
    }
  }
}

// ============================================================
// PARTY SYSTEM
// ============================================================

function partyEmbed(party) {
  const members = party.memberIds
    .map((id) => {
      const c = getCharacter(party.guildId, id);
      const leader = id === party.leaderId ? " 👑" : "";
      return c ? `${c.name} — Lv.${c.level} ${c.className}${leader}` : `<@${id}>${leader}`;
    })
    .join("\n");

  return new EmbedBuilder()
    .setTitle(`⚔️ ${party.name}`)
    .setDescription(members || "No members")
    .addFields(
      { name: "Party Code", value: `\`${party.code}\``, inline: true },
      { name: "Players", value: `${party.memberIds.length}/5`, inline: true }
    )
    .setFooter({ text: "Share the party code with friends so they can /party join." });
}

async function handlePartyCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  if (sub === "create") {
    const character = getCharacter(guildId, userId);
    if (!character) {
      return interaction.reply({
        ephemeral: true,
        content: "Create a character first with `/createcharacter`.",
      });
    }

    if (getPartyByMember(guildId, userId)) {
      return interaction.reply({
        ephemeral: true,
        content: "You're already in a party. Leave it before creating another.",
      });
    }

    const party = {
      id: uid(),
      guildId,
      code: partyCode(),
      name: interaction.options.getString("name") || `${character.name}'s Party`,
      leaderId: userId,
      memberIds: [userId],
      createdAt: Date.now(),
    };

    data.parties[party.id] = party;
    saveDataSoon();

    return interaction.reply({
      embeds: [partyEmbed(party)],
    });
  }

  if (sub === "join") {
    const character = getCharacter(guildId, userId);
    if (!character) {
      return interaction.reply({
        ephemeral: true,
        content: "Create a character first with `/createcharacter`.",
      });
    }

    if (getPartyByMember(guildId, userId)) {
      return interaction.reply({
        ephemeral: true,
        content: "You're already in a party.",
      });
    }

    const code = interaction.options.getString("code");
    const party = getPartyByCode(guildId, code);

    if (!party) {
      return interaction.reply({
        ephemeral: true,
        content: "I couldn't find a party with that code.",
      });
    }

    if (party.memberIds.length >= 5) {
      return interaction.reply({
        ephemeral: true,
        content: "That party already has 5 players.",
      });
    }

    party.memberIds.push(userId);
    saveDataSoon();

    return interaction.reply({
      content: `⚔️ **${character.name} joined ${party.name}!**`,
      embeds: [partyEmbed(party)],
    });
  }

  if (sub === "leave") {
    const party = getPartyByMember(guildId, userId);
    if (!party) {
      return interaction.reply({
        ephemeral: true,
        content: "You're not currently in a party.",
      });
    }

    const active = getCampaignForParty(party.id);
    if (active?.status === "active") {
      return interaction.reply({
        ephemeral: true,
        content: "You can't leave while your party has an active adventure. The leader can `/adventure end` first.",
      });
    }

    party.memberIds = party.memberIds.filter((id) => id !== userId);

    if (!party.memberIds.length) {
      delete data.parties[party.id];
    } else if (party.leaderId === userId) {
      party.leaderId = party.memberIds[0];
    }

    saveDataSoon();
    return interaction.reply({
      content: "👋 You left the party.",
      ephemeral: true,
    });
  }

  if (sub === "status") {
    const party = getPartyByMember(guildId, userId);
    if (!party) {
      return interaction.reply({
        ephemeral: true,
        content: "You're not currently in a party.",
      });
    }

    return interaction.reply({
      embeds: [partyEmbed(party)],
      ephemeral: true,
    });
  }
}

// ============================================================
// CAMPAIGN SYSTEM
// ============================================================

const campaignQueues = new Map();

function enqueueCampaign(campaignId, task) {
  const previous = campaignQueues.get(campaignId) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(task)
    .catch((err) => console.error(`Campaign ${campaignId} queue error:`, err))
    .finally(() => {
      if (campaignQueues.get(campaignId) === next) {
        campaignQueues.delete(campaignId);
      }
    });

  campaignQueues.set(campaignId, next);
  return next;
}

function modeLabel(mode) {
  return (
    {
      oneshot: "⚡ One-Shot",
      adventure: "⚔️ Adventure",
      quest: "🏰 Quest",
      campaign: "🐉 Campaign",
    }[mode] || mode
  );
}

async function handleAdventureCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const party = getPartyByMember(guildId, userId);

  if (!party) {
    return interaction.reply({
      ephemeral: true,
      content: "You need a party first. Use `/party create` or `/party join`.",
    });
  }

  if (party.leaderId !== userId && sub !== "status") {
    return interaction.reply({
      ephemeral: true,
      content: "Only the party leader can start, continue, or end an adventure.",
    });
  }

  if (sub === "start") {
    const existing = getCampaignForParty(party.id);
    if (existing?.status === "active") {
      return interaction.reply({
        ephemeral: true,
        content: `Your party already has an active campaign in <#${existing.channelId}>.`,
      });
    }

    const mode = interaction.options.getString("mode") || "adventure";
    const campaign = {
      id: uid(),
      guildId,
      partyId: party.id,
      channelId: interaction.channelId,
      status: "active",
      mode,
      title: `${party.name}: ${modeLabel(mode)}`,
      chapter: 1,
      location: "Unknown",
      summary: "The adventure has just begun.",
      pendingChecks: {},
      autoImagesUsed: 0,
      log: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    data.campaigns[campaign.id] = campaign;
    saveDataSoon();

    await interaction.deferReply();

    try {
      const opening = await aiOpening(campaign, party);
      appendLog(campaign, { type: "dm", text: opening.narration });

      await interaction.editReply({
        content:
          `# 🎲 ${modeLabel(mode)} Begins!\n` +
          `**Party:** ${party.name}\n\n` +
          `${opening.narration}`,
      });

      await maybeSendAutomaticImage(
        interaction.channel,
        campaign,
        party,
        opening
      );
    } catch (err) {
      console.error("Adventure opening error:", err);
      await interaction.editReply(
        "❌ The campaign was created, but the AI DM couldn't produce the opening. Check the logs/OpenAI key and use `/adventure continue`."
      );
    }
    return;
  }

  if (sub === "continue") {
    const campaign = getCampaignForParty(party.id);
    if (!campaign) {
      return interaction.reply({
        ephemeral: true,
        content: "This party doesn't have a saved adventure yet.",
      });
    }

    campaign.channelId = interaction.channelId;
    campaign.status = "active";
    campaign.pendingChecks ||= {};
    saveDataSoon();

    await interaction.deferReply();

    try {
      const resumed = await aiResume(campaign, party);
      appendLog(campaign, { type: "dm", text: resumed.narration });
      await interaction.editReply({
        content: `# 📖 Previously On...\n\n${resumed.narration}`,
      });

      await maybeSendAutomaticImage(
        interaction.channel,
        campaign,
        party,
        resumed
      );
      return;
    } catch (err) {
      console.error("Adventure continue error:", err);
      return interaction.editReply("❌ The AI DM couldn't continue the adventure.");
    }
  }

  if (sub === "end") {
    const campaign = getCampaignForParty(party.id);
    if (!campaign) {
      return interaction.reply({
        ephemeral: true,
        content: "There is no saved adventure to end.",
      });
    }

    campaign.status = "ended";
    appendLog(campaign, {
      type: "system",
      text: "The party ended this campaign.",
    });
    saveDataSoon();

    return interaction.reply({
      content: `🏁 **${campaign.title} has ended.**`,
    });
  }

  if (sub === "status") {
    const campaign = getCampaignForParty(party.id);
    if (!campaign) {
      return interaction.reply({
        ephemeral: true,
        content: "Your party doesn't have a saved adventure yet.",
      });
    }

    const pendingCount = Object.keys(campaign.pendingChecks || {}).length;

    const embed = new EmbedBuilder()
      .setTitle(`📖 ${campaign.title}`)
      .addFields(
        { name: "Status", value: campaign.status, inline: true },
        { name: "Chapter", value: `${campaign.chapter}`, inline: true },
        { name: "Pending Rolls", value: `${pendingCount}`, inline: true },
        {
          name: "Cinematic Images",
          value: `${campaign.autoImagesUsed || 0}/${AUTO_IMAGE_LIMIT} automatic`,
          inline: true,
        },
        { name: "Location", value: campaign.location || "Unknown" },
        { name: "Summary", value: truncate(campaign.summary, 1000) }
      );

    return interaction.reply({ ephemeral: true, embeds: [embed] });
  }
}

async function processPlayerAction(message, campaign, party) {
  const character = getCharacter(message.guildId, message.author.id);
  if (!character) return;

  const text = cleanPlayerText(message.content);
  if (!text) return;

  if (campaign.pendingChecks?.[message.author.id]) {
    await message.reply(
      `🎲 **${character.name} already has a roll waiting.** Use \`/roll\` before taking another uncertain action.`
    );
    return;
  }

  appendLog(campaign, {
    type: "player",
    userId: message.author.id,
    characterName: character.name,
    text,
  });

  try {
    await message.channel.sendTyping();
    const result = await aiDMAction(
      campaign,
      party,
      message.author.id,
      text
    );

    appendLog(campaign, { type: "dm", text: result.narration });
    await sendLong(message.channel, `🎭 **Dungeon Master**\n\n${result.narration}`);

    await maybeSendAutomaticImage(
      message.channel,
      campaign,
      party,
      result
    );

    if (
      result.action_type === "check" &&
      result.player_id === message.author.id &&
      result.check_name !== "None"
    ) {
      const ability =
        result.ability !== "NONE"
          ? result.ability
          : SKILL_TO_ABILITY[result.check_name] || "WIS";

      campaign.pendingChecks ||= {};
      campaign.pendingChecks[message.author.id] = {
        id: uid(),
        checkName: result.check_name,
        ability,
        dice: "1d20",
        dc: clamp(result.dc, 5, 30),
        reason: result.roll_reason,
        successDirection: result.consequences_success,
        failureDirection: result.consequences_failure,
        channelId: message.channelId,
        createdAt: Date.now(),
      };

      saveDataSoon();

      const checkEmbed = new EmbedBuilder()
        .setTitle(`🎲 ${character.name} — Roll Required!`)
        .setDescription(result.roll_reason || "The outcome is uncertain.")
        .addFields(
          {
            name: "Check",
            value: result.check_name.replace(/([a-z])([A-Z])/g, "$1 $2"),
            inline: true,
          },
          {
            name: "Die to Roll",
            value: "🎲 **1d20**",
            inline: true,
          },
          {
            name: "Modifier",
            value: `${ability} ${formatModifier(character.stats[ability] || 0)}`,
            inline: true,
          }
        )
        .setFooter({
          text: "Use /roll — the bot will automatically roll the required 1d20. The DC is hidden.",
        });

      await message.channel.send({ embeds: [checkEmbed] });
    }
  } catch (err) {
    console.error("AI DM action error:", err);
    await message.channel.send(
      "⚠️ **The Dungeon Master hit a snag.** Your action is saved, but the AI response failed. Try sending the action again in a moment."
    );
  }
}

// ============================================================
// ROLLS
// ============================================================

async function handleRollCommand(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const character = getCharacter(guildId, userId);

  if (!character) {
    return interaction.reply({
      ephemeral: true,
      content: "Create a character first with `/createcharacter`.",
    });
  }

  const customDice = interaction.options.getString("dice");
  const party = getPartyByMember(guildId, userId);

  // IMPORTANT: locate the campaign that ACTUALLY owns this player's pending
  // check instead of simply grabbing the most recently updated campaign.
  const pendingLookup = party
    ? findPendingCheckCampaign(guildId, interaction.channelId, party.id, userId)
    : { campaign: null, pending: null };

  const campaign = pendingLookup.campaign;
  const pending = pendingLookup.pending;

  // If the DM is waiting on a check, don't let a custom/manual dice expression
  // accidentally bypass it. /roll with no dice resolves the requested check.
  if (pending && customDice) {
    return interaction.reply({
      ephemeral: true,
      content:
        `🎲 **${character.name} already has a ${pending.checkName.replace(/([a-z])([A-Z])/g, "$1 $2")} check waiting.**\n` +
        `The required roll is **${pending.dice || "1d20"}**. Use \`/roll\` with no dice entered and the bot will roll it automatically.`,
    });
  }

  // No pending DM check = generic/manual dice roller.
  if (!pending) {
    const expression = customDice || "d20";
    const rolled = rollDice(expression);

    if (!rolled) {
      return interaction.reply({
        ephemeral: true,
        content:
          "Use dice like `d20`, `2d6`, `d8+3`, or `4d6-1`. Up to 20 dice at once.",
      });
    }

    const list = rolled.rolls.join(", ");
    const modText =
      rolled.modifier === 0 ? "" : ` ${formatModifier(rolled.modifier)}`;

    return interaction.reply({
      content:
        `🎲 **${character.name} rolled ${expression}!**\n` +
        `Dice: [${list}]${modText}\n` +
        `# **${rolled.total}**`,
    });
  }

  // Pending DM checks specify their own die. Ability/skill/attack checks are
  // currently 1d20, but storing the expression makes this ready for other
  // requested roll types later.
  const diceExpression = pending.dice || "1d20";
  const rolled = rollDice(diceExpression);

  if (!rolled) {
    console.error("Invalid pending dice expression:", pending);
    return interaction.reply({
      ephemeral: true,
      content:
        "⚠️ The DM requested a roll, but its dice information is invalid. Your roll was **not** consumed.",
    });
  }

  const modifier = character.stats[pending.ability] || 0;
  const naturalRoll = rolled.rolls[0];
  const total = rolled.raw + modifier;
  const outcome = total >= pending.dc ? "SUCCESS" : "FAILURE";

  // Only consume the pending check AFTER we have a valid roll.
  delete campaign.pendingChecks[userId];

  const rollRecord = {
    type: "roll",
    userId,
    characterName: character.name,
    checkName: pending.checkName,
    ability: pending.ability,
    dice: diceExpression,
    naturalRoll,
    modifier,
    total,
    outcome,
  };

  appendLog(campaign, rollRecord);
  saveDataSoon();

  const natText =
    diceExpression === "1d20" && naturalRoll === 20
      ? "\n🌟 **NATURAL 20!**"
      : diceExpression === "1d20" && naturalRoll === 1
        ? "\n💀 **NATURAL 1!**"
        : "";

  const resultEmoji = outcome === "SUCCESS" ? "✅" : "❌";

  await interaction.reply({
    content:
      `🎲 **${character.name} — ${pending.checkName.replace(/([a-z])([A-Z])/g, "$1 $2")}**\n` +
      `Required Die: **${diceExpression}**\n` +
      `Natural Roll: **${naturalRoll}**\n` +
      `${pending.ability}: **${formatModifier(modifier)}**\n` +
      `Total: **${total}**${natText}\n\n` +
      `${resultEmoji} **${outcome}**`,
  });

  try {
    const resolved = await aiResolveCheck(campaign, party, rollRecord, pending);
    appendLog(campaign, { type: "dm", text: resolved.narration });
    await sendLong(
      interaction.channel,
      `🎭 **Dungeon Master**\n\n${resolved.narration}`
    );

    await maybeSendAutomaticImage(
      interaction.channel,
      campaign,
      party,
      resolved
    );
  } catch (err) {
    console.error("Resolve-check narration error:", err);
    await interaction.followUp(
      "⚠️ The roll was saved correctly, but the Dungeon Master's follow-up narration failed."
    );
  }
}

// ============================================================
// RECAP
// ============================================================

async function handleRecap(interaction) {
  const party = getPartyByMember(interaction.guildId, interaction.user.id);

  if (!party) {
    return interaction.reply({
      ephemeral: true,
      content: "You're not in a party.",
    });
  }

  const campaign = getCampaignForParty(party.id);
  if (!campaign) {
    return interaction.reply({
      ephemeral: true,
      content: "Your party doesn't have a campaign yet.",
    });
  }

  const recent = recentCampaignContext(campaign, 14).join("\n");
  const text =
    recent ||
    campaign.summary ||
    "The party's tale has only just begun.";

  return interaction.reply({
    ephemeral: true,
    embeds: [
      new EmbedBuilder()
        .setTitle(`📜 ${campaign.title} — Recent Events`)
        .setDescription(truncate(text, 4000)),
    ],
  });
}

// ============================================================
// SLASH COMMANDS
// ============================================================

const commands = [
  new SlashCommandBuilder()
    .setName("createcharacter")
    .setDescription("Create or rebuild your adventurer."),

  new SlashCommandBuilder()
    .setName("character")
    .setDescription("View a character sheet.")
    .addUserOption((o) =>
      o
        .setName("player")
        .setDescription("Whose character to view")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("inventory")
    .setDescription("View your character's inventory."),

  new SlashCommandBuilder()
    .setName("party")
    .setDescription("Create, join, leave, or inspect an adventuring party.")
    .addSubcommand((s) =>
      s
        .setName("create")
        .setDescription("Create a new party.")
        .addStringOption((o) =>
          o
            .setName("name")
            .setDescription("Party name")
            .setMaxLength(50)
            .setRequired(false)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("join")
        .setDescription("Join a party using its code.")
        .addStringOption((o) =>
          o
            .setName("code")
            .setDescription("Six-character party code")
            .setRequired(true)
            .setMaxLength(6)
        )
    )
    .addSubcommand((s) =>
      s.setName("leave").setDescription("Leave your current party.")
    )
    .addSubcommand((s) =>
      s.setName("status").setDescription("View your current party.")
    ),

  new SlashCommandBuilder()
    .setName("adventure")
    .setDescription("Start, continue, end, or inspect your AI-DM adventure.")
    .addSubcommand((s) =>
      s
        .setName("start")
        .setDescription("Start a new adventure in this channel.")
        .addStringOption((o) =>
          o
            .setName("mode")
            .setDescription("Adventure length/style")
            .setRequired(true)
            .addChoices(
              { name: "⚡ One-Shot", value: "oneshot" },
              { name: "⚔️ Adventure", value: "adventure" },
              { name: "🏰 Quest", value: "quest" },
              { name: "🐉 Campaign", value: "campaign" }
            )
        )
    )
    .addSubcommand((s) =>
      s
        .setName("continue")
        .setDescription("Resume your saved adventure in this channel.")
    )
    .addSubcommand((s) =>
      s.setName("end").setDescription("End the party's saved adventure.")
    )
    .addSubcommand((s) =>
      s.setName("status").setDescription("View campaign status.")
    ),

  new SlashCommandBuilder()
    .setName("roll")
    .setDescription("Resolve your pending check or roll custom dice.")
    .addStringOption((o) =>
      o
        .setName("dice")
        .setDescription("Optional dice expression, e.g. d20, 2d6, d8+3")
        .setRequired(false)
        .setMaxLength(20)
    ),

  new SlashCommandBuilder()
    .setName("recap")
    .setDescription("View recent events from your party's campaign."),

  new SlashCommandBuilder()
    .setName("scene")
    .setDescription("Generate a cinematic image of the current campaign scene."),

  new SlashCommandBuilder()
    .setName("portrait")
    .setDescription("Generate a cinematic portrait of your saved character."),

  new SlashCommandBuilder()
    .setName("dndhelp")
    .setDescription("Show the D&D bot quick-start guide."),
].map((c) => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

  if (DISCORD_GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID),
      { body: commands }
    );
    console.log(`Registered ${commands.length} guild commands.`);
  } else {
    await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), {
      body: commands,
    });
    console.log(`Registered ${commands.length} global commands.`);
  }
}

// ============================================================
// INTERACTION HANDLER
// ============================================================

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (!interaction.guildId) {
        return interaction.reply({
          ephemeral: true,
          content: "This game is designed to run inside a Discord server.",
        });
      }

      switch (interaction.commandName) {
        case "createcharacter":
          return startCharacterCreation(interaction);

        case "character": {
          const target = interaction.options.getUser("player") || interaction.user;
          const character = getCharacter(interaction.guildId, target.id);

          if (!character) {
            return interaction.reply({
              ephemeral: target.id === interaction.user.id,
              content:
                target.id === interaction.user.id
                  ? "You don't have a character yet. Use `/createcharacter`."
                  : `${target.username} doesn't have a character yet.`,
            });
          }

          return interaction.reply({
            embeds: [makeCharacterEmbed(character, target.username)],
          });
        }

        case "inventory": {
          const character = getCharacter(interaction.guildId, interaction.user.id);
          if (!character) {
            return interaction.reply({
              ephemeral: true,
              content: "Create a character first with `/createcharacter`.",
            });
          }
          return interaction.reply({
            ephemeral: true,
            embeds: [makeInventoryEmbed(character)],
          });
        }

        case "party":
          return handlePartyCommand(interaction);

        case "adventure":
          return handleAdventureCommand(interaction);

        case "roll":
          return handleRollCommand(interaction);

        case "recap":
          return handleRecap(interaction);

        case "scene":
          return handleSceneCommand(interaction);

        case "portrait":
          return handlePortraitCommand(interaction);

        case "dndhelp":
          return interaction.reply({
            ephemeral: true,
            embeds: [
              new EmbedBuilder()
                .setTitle("🐉 AI Dungeon Master — Quick Start")
                .setDescription(
                  "**1.** `/createcharacter` — Build your adventurer.\n" +
                  "**2.** `/party create` — Make a party and share its code.\n" +
                  "**3.** Friends use `/party join`.\n" +
                  "**4.** Party leader uses `/adventure start`.\n" +
                  "**5.** Talk normally in the adventure channel to tell the DM what your character does.\n" +
                  "**6.** When the DM requests a check, use `/roll`.\n" +
                  "**7.** `/character`, `/inventory`, `/recap`, and `/adventure status` show saved information.\n" +
                  "**8.** `/scene` generates the current cinematic scene and `/portrait` creates your character art.\n\n" +
                  "🎲 You can also roll manual dice with `/roll dice:2d6+3`.\n" +
                  `🖼️ Automatic cinematic images are limited to ${AUTO_IMAGE_LIMIT} per campaign.`
                ),
            ],
          });
      }
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("cc_details:")) {
      return handleCharacterDetails(interaction);
    }

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId.startsWith("cc_")
    ) {
      return handleCharacterSelect(interaction);
    }
  } catch (err) {
    console.error("Interaction error:", err);

    const payload = {
      ephemeral: true,
      content: "❌ Something went wrong. Check the Railway logs for the error.",
    };

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload);
      } else {
        await interaction.reply(payload);
      }
    } catch (replyErr) {
      console.error("Could not send interaction error reply:", replyErr);
    }
  }
});

// ============================================================
// NATURAL-LANGUAGE GAMEPLAY
// ============================================================

client.on(Events.MessageCreate, async (message) => {
  if (!message.guildId || message.author.bot) return;

  const campaign = getActiveCampaignForChannel(
    message.guildId,
    message.channelId
  );

  if (!campaign) return;

  const party = data.parties[campaign.partyId];
  if (!party) return;
  if (!party.memberIds.includes(message.author.id)) return;

  const character = getCharacter(message.guildId, message.author.id);
  if (!character) return;

  // Let players use ordinary chat for out-of-character messages by starting with //
  if (message.content.trim().startsWith("//")) return;

  await enqueueCampaign(campaign.id, () =>
    processPlayerAction(message, campaign, party)
  );
});

// ============================================================
// READY / STARTUP
// ============================================================

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  console.log(`Data file: ${DATA_FILE}`);
  console.log(`OpenAI model: ${OPENAI_MODEL}`);
  console.log(`OpenAI image model: ${OPENAI_IMAGE_MODEL}`);
  console.log(`Image quality: ${OPENAI_IMAGE_QUALITY}`);
  console.log(`AI configured: ${openai ? "YES" : "NO"}`);
});

process.on("SIGINT", () => {
  saveData();
  process.exit(0);
});

process.on("SIGTERM", () => {
  saveData();
  process.exit(0);
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

// Register commands first, then log in.
await registerCommands();
await client.login(DISCORD_TOKEN);
