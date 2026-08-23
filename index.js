import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import OpenAI from "openai";
import express from "express";
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
const DICE_BRIDGE_SECRET = process.env.DICE_BRIDGE_SECRET || "";
const HTTP_PORT = Number(process.env.PORT || 3000);
const PARTY_ACTION_WINDOW_MS = 20 * 1000;
const DOWNTIME_AFTER_ACTION_BEATS = 3;
const MAX_COMBAT_ENEMIES = 6;

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
// CHARACTER PROGRESSION
// ============================================================

// Standard D&D-style cumulative XP thresholds.
const XP_THRESHOLDS = {
  1: 0,
  2: 300,
  3: 900,
  4: 2700,
  5: 6500,
  6: 14000,
  7: 23000,
  8: 34000,
  9: 48000,
  10: 64000,
  11: 85000,
  12: 100000,
  13: 120000,
  14: 140000,
  15: 165000,
  16: 195000,
  17: 225000,
  18: 265000,
  19: 305000,
  20: 355000,
};

const MAX_CHARACTER_LEVEL = 20;

const CAMPAIGN_COMPLETION_XP = {
  oneshot: 150,
  adventure: 250,
  quest: 400,
  campaign: 500,
};

function proficiencyBonusForLevel(level) {
  return Math.min(6, 2 + Math.floor((Math.max(1, level) - 1) / 4));
}

function xpForNextLevel(level) {
  if (level >= MAX_CHARACTER_LEVEL) return null;
  return XP_THRESHOLDS[level + 1] ?? null;
}

function normalizeCharacterProgression(character) {
  character.level = clamp(Number(character.level || 1), 1, MAX_CHARACTER_LEVEL);
  character.xp = Math.max(0, Number(character.xp || 0));
  character.levelUpHistory ||= [];
  return character;
}

function hpGainForLevel(character) {
  const classData = CLASS_DATA[character.className];
  const hitDie = Number(classData?.hitDie || 8);
  const conMod = Number(character.stats?.CON || 0);

  // Fixed average roll: d6=4, d8=5, d10=6, d12=7, then CON.
  return Math.max(1, Math.floor(hitDie / 2) + 1 + conMod);
}

function progressionSummary(character) {
  normalizeCharacterProgression(character);

  if (character.level >= MAX_CHARACTER_LEVEL) {
    return `Level **20** • **${character.xp.toLocaleString()} XP** • MAX LEVEL`;
  }

  const next = xpForNextLevel(character.level);
  return (
    `Level **${character.level}** • ` +
    `**${character.xp.toLocaleString()} / ${next.toLocaleString()} XP**`
  );
}

function awardCharacterXP(character, amount, reason = "") {
  normalizeCharacterProgression(character);

  const gained = Math.max(0, Math.floor(Number(amount || 0)));
  const oldLevel = character.level;
  const oldProf = proficiencyBonusForLevel(oldLevel);

  character.xp += gained;

  const levelUps = [];

  while (
    character.level < MAX_CHARACTER_LEVEL &&
    character.xp >= XP_THRESHOLDS[character.level + 1]
  ) {
    const fromLevel = character.level;
    character.level += 1;

    const hpGain = hpGainForLevel(character);
    character.maxHp += hpGain;
    character.hp = Math.min(character.maxHp, character.hp + hpGain);

    const entry = {
      at: Date.now(),
      fromLevel,
      toLevel: character.level,
      hpGain,
      reason,
    };

    character.levelUpHistory.push(entry);
    levelUps.push(entry);
  }

  character.updatedAt = Date.now();

  return {
    gained,
    reason,
    oldLevel,
    newLevel: character.level,
    oldProf,
    newProf: proficiencyBonusForLevel(character.level),
    levelUps,
    nextXP: xpForNextLevel(character.level),
  };
}

function levelUpEmbed(character, progression) {
  const classInfo = CLASS_DATA[character.className] || { emoji: "🧙" };
  const totalHpGained = progression.levelUps.reduce(
    (sum, x) => sum + x.hpGain,
    0
  );

  const fields = [
    {
      name: "❤️ Maximum HP",
      value: `+${totalHpGained} → **${character.maxHp} HP**`,
      inline: true,
    },
    {
      name: "⭐ XP",
      value:
        character.level >= MAX_CHARACTER_LEVEL
          ? `${character.xp.toLocaleString()} • MAX LEVEL`
          : `${character.xp.toLocaleString()} / ${progression.nextXP.toLocaleString()}`,
      inline: true,
    },
  ];

  if (progression.newProf > progression.oldProf) {
    fields.push({
      name: "🎯 Proficiency Bonus",
      value: `+${progression.oldProf} → **+${progression.newProf}**`,
      inline: true,
    });
  }

  return new EmbedBuilder()
    .setTitle(
      `🎉 LEVEL UP! ${classInfo.emoji} ${character.name} reached Level ${character.level}!`
    )
    .setDescription(
      `Your adventures are making ${character.name} stronger. ` +
      `Leveling is automatic; your character sheet has already been updated.`
    )
    .addFields(fields);
}

async function announceXP(channel, character, progression, {
  compact = false,
} = {}) {
  if (!progression?.gained) return;

  const nextText =
    character.level >= MAX_CHARACTER_LEVEL
      ? "MAX LEVEL"
      : `${character.xp.toLocaleString()} / ${progression.nextXP.toLocaleString()} XP`;

  if (!compact) {
    await channel.send({
      content:
        `⭐ **${character.name} earned ${progression.gained} XP!**` +
        (progression.reason ? ` — ${progression.reason}` : "") +
        `\n${nextText}`,
      allowedMentions: { parse: [] },
    });
  }

  if (progression.levelUps.length) {
    await channel.send({
      embeds: [levelUpEmbed(character, progression)],
      allowedMentions: { parse: [] },
    });
  }
}

// ============================================================
// MULTIPLAYER PARTY ACTION WINDOW
// ============================================================
//
// Exploration/social play is batched for 20 seconds after the MOST RECENT
// party message. Any new participant message resets the window.
//
// /ready marks a participant ready. Only players who actually contributed to
// the current batch count toward readiness. If every participant is ready,
// the DM processes the batch immediately.
//
// Pending DM rolls pause batch resolution. Players may keep declaring actions
// while a roll is pending, but the DM will not advance past the unresolved roll.

const partyActionWindows = new Map();

function getPartyWindow(campaignId) {
  return partyActionWindows.get(campaignId) || null;
}

function ensurePartyWindow(campaign, channel) {
  let windowState = partyActionWindows.get(campaign.id);

  if (!windowState) {
    windowState = {
      campaignId: campaign.id,
      guildId: campaign.guildId,
      channelId: campaign.channelId,
      channel,
      actions: [],
      participants: new Set(),
      ready: new Set(),
      timer: null,
      deadline: null,
      processing: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    partyActionWindows.set(campaign.id, windowState);
  } else if (channel) {
    windowState.channel = channel;
  }

  return windowState;
}

function clearPartyWindowTimer(windowState) {
  if (windowState?.timer) {
    clearTimeout(windowState.timer);
    windowState.timer = null;
  }

  if (windowState) windowState.deadline = null;
}

function pendingRollCount(campaign) {
  return Object.keys(campaign.pendingChecks || {}).length;
}

function partyWindowParticipants(windowState) {
  return [...(windowState?.participants || [])];
}

function everyoneInWindowReady(windowState) {
  const participants = partyWindowParticipants(windowState);
  return (
    participants.length > 0 &&
    participants.every((userId) => windowState.ready.has(userId))
  );
}

function partyWindowRemainingSeconds(windowState) {
  if (!windowState?.deadline) return null;
  return Math.max(0, Math.ceil((windowState.deadline - Date.now()) / 1000));
}

function schedulePartyWindow(campaign, party, channel) {
  const windowState = getPartyWindow(campaign.id);
  if (!windowState || windowState.processing || !windowState.actions.length) {
    return;
  }

  clearPartyWindowTimer(windowState);

  // Never advance the fiction while the DM is waiting on a roll.
  if (pendingRollCount(campaign) > 0) {
    return;
  }

  if (everyoneInWindowReady(windowState)) {
    windowState.timer = setTimeout(() => {
      processPartyActionWindow(campaign.id).catch((err) =>
        console.error("Immediate ready-window processing error:", err)
      );
    }, 50);
    windowState.deadline = Date.now() + 50;
    return;
  }

  windowState.deadline = Date.now() + PARTY_ACTION_WINDOW_MS;

  windowState.timer = setTimeout(() => {
    processPartyActionWindow(campaign.id).catch((err) =>
      console.error("Party action-window processing error:", err)
    );
  }, PARTY_ACTION_WINDOW_MS);
}

function addActionToPartyWindow(message, campaign, party) {
  const character = getCharacter(message.guildId, message.author.id, message.channelId);
  if (!character) return null;

  const text = cleanPlayerText(message.content);
  if (!text) return null;

  const windowState = ensurePartyWindow(campaign, message.channel);

  windowState.actions.push({
    userId: message.author.id,
    characterName: character.name,
    text,
    messageId: message.id,
    createdAt: Date.now(),
  });

  windowState.participants.add(message.author.id);

  // If this player says anything after /ready, they are no longer ready.
  windowState.ready.delete(message.author.id);

  windowState.updatedAt = Date.now();

  schedulePartyWindow(campaign, party, message.channel);
  return windowState;
}

function readyStatusDescription(windowState, campaign, party) {
  const participants = partyWindowParticipants(windowState);

  if (!participants.length) {
    return "There are no party actions waiting for the Dungeon Master.";
  }

  const lines = participants.map((userId) => {
    const character = getCharacter(campaign.guildId, userId, campaign.channelId);
    const label = character?.name || `<@${userId}>`;
    return `${windowState.ready.has(userId) ? "✅" : "⏳"} **${label}**`;
  });

  if (pendingRollCount(campaign) > 0) {
    lines.push(
      "",
      `🎲 The DM is waiting for **${pendingRollCount(campaign)} unresolved roll${pendingRollCount(campaign) === 1 ? "" : "s"}** before continuing.`
    );
  } else {
    const remaining = partyWindowRemainingSeconds(windowState);
    lines.push(
      "",
      everyoneInWindowReady(windowState)
        ? "⚡ **Everyone participating is ready. The DM is responding now.**"
        : `⏱️ DM responds after **20 seconds of silence**${remaining !== null ? ` • about **${remaining}s** remaining` : ""}.`
    );
  }

  return lines.join("\n");
}

async function handleReadyCommand(interaction) {
  const party = getPartyByMember(interaction.guildId, interaction.user.id, interaction.channelId);

  if (!party) {
    return interaction.reply({
      ephemeral: true,
      content: "You need to be in a party before using `/ready`.",
    });
  }

  const campaign = getActiveCampaignForChannel(
    interaction.guildId,
    interaction.channelId
  );

  if (!campaign || campaign.partyId !== party.id) {
    return interaction.reply({
      ephemeral: true,
      content: "Use `/ready` in your party's active adventure channel.",
    });
  }

  const windowState = getPartyWindow(campaign.id);

  if (!windowState || !windowState.actions.length) {
    return interaction.reply({
      ephemeral: true,
      content:
        "There are no party actions waiting right now. Say what your character does first, then use `/ready`.",
    });
  }

  if (!windowState.participants.has(interaction.user.id)) {
    return interaction.reply({
      ephemeral: true,
      content:
        "Only players who contributed to the current action window need to use `/ready`.",
    });
  }

  windowState.ready.add(interaction.user.id);
  windowState.updatedAt = Date.now();

  schedulePartyWindow(campaign, party, interaction.channel);

  return interaction.reply({
    content:
      `⚔️ **Party Ready Check**\n\n` +
      readyStatusDescription(windowState, campaign, party),
    allowedMentions: { parse: [] },
  });
}

async function aiDMPartyAction(campaign, party, actions) {
  if (!openai) {
    return {
      narration:
        "⚠️ The AI Dungeon Master is not configured yet. Add `OPENAI_API_KEY` to Railway.",
      action_type: "none",
      player_id: "",
      check_name: "None",
      ability: "NONE",
      roll_mode: "normal",
      dc: 0,
      roll_reason: "",
      consequences_success: "",
      consequences_failure: "",
      scene_mode: "action",
      combat_enemy_name: "",
      combat_enemy_archetype: "none",
      combat_enemy_count: 0,
      image_type: "none",
      image_prompt: "",
    };
  }

  const participants = actions.map((action) => ({
    playerId: action.userId,
    characterName: action.characterName,
    text: action.text,
  }));

  const input = JSON.stringify(
    {
      campaign: {
        title: campaign.title,
        mode: campaign.mode,
        chapter: campaign.chapter,
        summary: campaign.summary,
        location: campaign.location,
      },
      pacing: campaignPacingContext(campaign),
      party: partyMembersContext(party),
      recentHistory: recentCampaignContext(campaign),
      partyActions: participants,
      instruction:
        "Resolve these party declarations together as one tabletop scene. Respect each player's declared action. Do not invent actions for players. " +
        "If pacing.downtimeActive is true, prioritize conversation, rest, personal interaction, planning, food, watch shifts, and character moments; do not inject a new emergency unless the players clearly leave safety or seek danger. " +
        "If pacing.downtimeStronglyDue is true and there is no immediate unresolved danger, you MUST create a meaningful downtime/social beat instead of another action escalation. " +
        "If genuine hostilities begin, use action_type combat_start and provide enemy name/archetype/count; do not resolve combat yourself. " +
        "If one meaningful uncertain non-combat action needs a roll, request exactly one check for the most appropriate PARTICIPATING player. " +
        "If multiple players are helping the same task, reflect that help narratively but still request no more than one check. " +
        "Otherwise narrate the combined result without a check.",
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
        name: "discord_dm_party_action",
        strict: true,
        schema: dmActionSchema,
      },
    },
  });

  return JSON.parse(response.output_text);
}

async function processPartyActionWindow(campaignId) {
  const windowState = getPartyWindow(campaignId);
  if (!windowState || windowState.processing || !windowState.actions.length) {
    return;
  }

  const campaign = data.campaigns[campaignId];
  if (!campaign || campaign.status !== "active") {
    clearPartyWindowTimer(windowState);
    partyActionWindows.delete(campaignId);
    return;
  }

  const party = data.parties[campaign.partyId];
  if (!party) return;

  // Pending check protection: preserve queued actions until the roll resolves.
  if (pendingRollCount(campaign) > 0) {
    clearPartyWindowTimer(windowState);
    return;
  }

  clearPartyWindowTimer(windowState);
  windowState.processing = true;

  // Atomically detach the batch so new messages can begin the NEXT window.
  const actions = [...windowState.actions];

  windowState.actions = [];
  windowState.participants = new Set();
  windowState.ready = new Set();

  const channel =
    windowState.channel ||
    (await client.channels.fetch(windowState.channelId).catch(() => null));

  try {
    for (const action of actions) {
      appendLog(campaign, {
        type: "player",
        userId: action.userId,
        characterName: action.characterName,
        text: action.text,
      });
    }

    if (!channel?.isTextBased()) {
      throw new Error("Party action-window channel is unavailable.");
    }

    await channel.sendTyping();

    const result = await aiDMPartyAction(campaign, party, actions);

    appendLog(campaign, {
      type: "dm",
      text: result.narration,
    });

    await sendLong(
      channel,
      `🎭 **Dungeon Master**\n\n${result.narration}`
    );

    await maybeSendAutomaticImage(
      channel,
      campaign,
      party,
      result
    );

    if (result.action_type === "combat_start") {
      recordScenePacing(campaign, "combat");
      await startCombatFromDM(campaign, party, channel, result);
      return;
    }

    recordScenePacing(
      campaign,
      result.scene_mode || "action"
    );

    if (result.scene_mode === "downtime") {
      await sendDowntimeBanner(
        channel,
        campaign,
        "The scene has reached a natural lull."
      );
    }

    const participatingIds = new Set(actions.map((action) => action.userId));

    if (
      result.action_type === "check" &&
      participatingIds.has(result.player_id) &&
      result.check_name !== "None"
    ) {
      const targetCharacter = getCharacter(
        campaign.guildId,
        result.player_id,
        campaign.channelId
      );

      if (targetCharacter) {
        const ability =
          result.ability !== "NONE"
            ? result.ability
            : SKILL_TO_ABILITY[result.check_name] || "WIS";

        campaign.pendingChecks ||= {};

        campaign.pendingChecks[result.player_id] = {
          id: uid(),
          checkName: result.check_name,
          ability,
          dice: "1d20",
          rollMode: normalizeRollMode(result.roll_mode),
          dc: clamp(result.dc, 5, 30),
          reason: result.roll_reason,
          successDirection: result.consequences_success,
          failureDirection: result.consequences_failure,
          channelId: campaign.channelId,
          createdAt: Date.now(),
        };

        saveDataSoon();

        const pending = campaign.pendingChecks[result.player_id];

        const checkEmbed = new EmbedBuilder()
          .setTitle(`🎲 ${targetCharacter.name} — Roll Required!`)
          .setDescription(result.roll_reason || "The outcome is uncertain.")
          .addFields(
            {
              name: "Check",
              value: result.check_name.replace(/([a-z])([A-Z])/g, "$1 $2"),
              inline: true,
            },
            {
              name: "Die",
              value: "🎲 **1d20**",
              inline: true,
            },
            {
              name: "Modifier",
              value: `${ability} ${formatModifier(targetCharacter.stats[ability] || 0)}`,
              inline: true,
            },
            {
              name: "Roll Mode",
              value:
                `${rollModeEmoji(pending.rollMode)} **${rollModeLabel(pending.rollMode)}**
` +
                rollModeInstruction(pending.rollMode),
              inline: false,
            }
          )
          .setFooter({
            text:
              "3D Dice is experimental. Reliable fallback: type /roll. The DC is hidden.",
          });

        await channel.send({
          embeds: [checkEmbed],
          components: [make3DDiceButton(pending)],
          allowedMentions: { parse: [] },
        });

        await channel.send({
          content:
            `🎲 **${targetCharacter.name}:** if the 3D Dice Activity does not work, simply type **\`/roll\`** in this channel. ` +
            "The bot will automatically use the correct d20 and modifier.",
          allowedMentions: { parse: [] },
        });
      }
    }
  } catch (err) {
    console.error("Party action-window DM error:", err);

    if (channel?.isTextBased()) {
      await channel.send(
        "⚠️ **The Dungeon Master hit a snag processing the party's actions.** Your messages were saved. Try another action in a moment."
      );
    }
  } finally {
    windowState.processing = false;

    // New messages may have arrived while the AI was responding.
    if (windowState.actions.length) {
      schedulePartyWindow(campaign, party, channel);
    } else {
      partyActionWindows.delete(campaignId);
    }
  }
}

function resumePartyWindowAfterRoll(campaign) {
  const windowState = getPartyWindow(campaign.id);

  if (!windowState || !windowState.actions.length) return;
  if (pendingRollCount(campaign) > 0) return;

  const party = data.parties[campaign.partyId];
  if (!party) return;

  schedulePartyWindow(campaign, party, windowState.channel);
}

// ============================================================
// DOWNTIME / PACING
// ============================================================

function normalizeCampaignPacing(campaign) {
  campaign.pacing ||= {
    actionBeats: 0,
    downtimeActive: false,
    lastDowntimeAt: 0,
    lastCombatAt: 0,
  };

  campaign.pacing.actionBeats = Math.max(
    0,
    Number(campaign.pacing.actionBeats || 0)
  );
  campaign.pacing.downtimeActive = Boolean(campaign.pacing.downtimeActive);
  campaign.pacing.lastDowntimeAt = Number(campaign.pacing.lastDowntimeAt || 0);
  campaign.pacing.lastCombatAt = Number(campaign.pacing.lastCombatAt || 0);

  return campaign.pacing;
}

function campaignPacingContext(campaign) {
  const pacing = normalizeCampaignPacing(campaign);

  return {
    actionBeatsSinceDowntime: pacing.actionBeats,
    downtimeActive: pacing.downtimeActive,
    downtimeStronglyDue:
      pacing.actionBeats >= DOWNTIME_AFTER_ACTION_BEATS,
  };
}

function recordScenePacing(campaign, sceneMode = "action") {
  const pacing = normalizeCampaignPacing(campaign);

  if (sceneMode === "downtime") {
    pacing.actionBeats = 0;
    pacing.downtimeActive = true;
    pacing.lastDowntimeAt = Date.now();
  } else if (sceneMode === "combat") {
    pacing.downtimeActive = false;
    pacing.lastCombatAt = Date.now();
    pacing.actionBeats += 1;
  } else {
    if (pacing.downtimeActive && sceneMode === "action") {
      // The players have chosen to move the story out of downtime.
      pacing.downtimeActive = false;
    }
    pacing.actionBeats += 1;
  }

  campaign.updatedAt = Date.now();
  saveDataSoon();
}

async function sendDowntimeBanner(channel, campaign, reason = "") {
  normalizeCampaignPacing(campaign);

  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle("🌙 Downtime")
        .setDescription(
          (reason
            ? `${reason}\n\n`
            : "") +
          "The immediate pressure has eased. **Nothing is forcing the party forward right now.** " +
          "This is a good time to talk in character, eat, tend wounds, investigate belongings, " +
          "visit NPCs, make plans, keep watch, or sleep.\n\n" +
          "The DM will let this scene breathe until the party chooses to move on."
        )
        .setFooter({
          text:
            "Use normal messages for roleplay • /rest short or /rest long when appropriate • /ready still works",
        }),
    ],
    allowedMentions: { parse: [] },
  });
}

async function handleRestCommand(interaction) {
  const party = getPartyByMember(interaction.guildId, interaction.user.id, interaction.channelId);

  if (!party) {
    return interaction.reply({
      ephemeral: true,
      content: "You need to be in a party before resting.",
    });
  }

  const campaign = getActiveCampaignForChannel(
    interaction.guildId,
    interaction.channelId
  );

  if (!campaign || campaign.partyId !== party.id) {
    return interaction.reply({
      ephemeral: true,
      content: "Use `/rest` in your active adventure channel.",
    });
  }

  if (campaign.combat?.active) {
    return interaction.reply({
      ephemeral: true,
      content: "⚔️ You can't take a rest while combat is active.",
    });
  }

  if (pendingRollCount(campaign) > 0) {
    return interaction.reply({
      ephemeral: true,
      content: "🎲 Resolve the party's pending roll before resting.",
    });
  }

  const type = interaction.options.getString("type", true);
  normalizeCampaignPacing(campaign);

  const results = [];

  for (const memberId of party.memberIds) {
    const character = getCharacter(interaction.guildId, memberId, interaction.channelId);
    if (!character) continue;

    const before = character.hp;

    if (type === "long") {
      character.hp = character.maxHp;
    } else {
      const classData = CLASS_DATA[character.className];
      const hitDie = Number(classData?.hitDie || 8);
      const heal = Math.max(
        1,
        Math.floor(hitDie / 2) + 1 + Number(character.stats?.CON || 0)
      );
      character.hp = Math.min(character.maxHp, character.hp + heal);
    }

    restoreAbilityUses(character, type);

    results.push(
      `**${character.name}:** ${before} → **${character.hp}/${character.maxHp} HP**`
    );
  }

  campaign.pacing.actionBeats = 0;
  campaign.pacing.downtimeActive = true;
  campaign.pacing.lastDowntimeAt = Date.now();

  appendLog(campaign, {
    type: "system",
    text:
      type === "long"
        ? "The party completed a long rest."
        : "The party completed a short rest.",
  });

  saveDataSoon();

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle(type === "long" ? "🌙 Long Rest" : "🔥 Short Rest")
        .setDescription(
          (type === "long"
            ? "The party settles in and gets meaningful sleep and recovery."
            : "The party pauses to catch its breath, eat, bandage wounds, and regroup.") +
          `\n\n${results.join("\n")}`
        )
        .setFooter({
          text:
            type === "long"
              ? "HP restored to maximum."
              : "Each character recovered a class-based amount of HP.",
        }),
    ],
  });

  await sendDowntimeBanner(
    interaction.channel,
    campaign,
    type === "long"
      ? "Morning—or whatever passes for it here—comes without an immediate crisis."
      : "For a little while, the party has room to simply be together."
  );
}

// ============================================================
// TURN-BASED COMBAT ENGINE v1
// ============================================================

const ENEMY_ARCHETYPES = {
  minion: {
    label: "Minion",
    acBase: 11,
    hpBase: 4,
    hpPerLevel: 2,
    attackBase: 2,
    damage: "1d4",
    xp: 20,
  },
  skirmisher: {
    label: "Skirmisher",
    acBase: 13,
    hpBase: 8,
    hpPerLevel: 3,
    attackBase: 3,
    damage: "1d6",
    xp: 35,
  },
  brute: {
    label: "Brute",
    acBase: 12,
    hpBase: 14,
    hpPerLevel: 5,
    attackBase: 3,
    damage: "1d8",
    xp: 50,
  },
  caster: {
    label: "Caster",
    acBase: 12,
    hpBase: 7,
    hpPerLevel: 3,
    attackBase: 3,
    damage: "1d8",
    xp: 45,
  },
  boss: {
    label: "Boss",
    acBase: 15,
    hpBase: 28,
    hpPerLevel: 9,
    attackBase: 4,
    damage: "1d10",
    xp: 120,
  },
};

function averagePartyLevel(party, guildId) {
  const levels = party.memberIds
    .map((id) => getCharacter(guildId, id, resolvePartyChannel(party))?.level || 1)
    .filter(Boolean);

  if (!levels.length) return 1;
  return Math.max(
    1,
    Math.round(levels.reduce((sum, level) => sum + level, 0) / levels.length)
  );
}

function makeEnemy({
  name,
  archetype = "skirmisher",
  level = 1,
  number = 1,
}) {
  const template =
    ENEMY_ARCHETYPES[archetype] || ENEMY_ARCHETYPES.skirmisher;

  const proficiency = proficiencyBonusForLevel(level);
  const hp =
    template.hpBase +
    template.hpPerLevel * level +
    (archetype === "boss" ? level * 3 : 0);

  return {
    id: `enemy_${uid()}`,
    name: number > 1 ? `${name} ${number}` : name,
    baseName: name,
    archetype,
    ac:
      template.acBase +
      Math.floor((level - 1) / 5),
    hp,
    maxHp: hp,
    attackBonus: template.attackBase + proficiency,
    damageDice: template.damage,
    xpValue: template.xp + level * 5,
    defeated: false,
  };
}

function combatantLabel(campaign, combatant) {
  if (!combatant) return "Unknown";

  if (combatant.type === "player") {
    return getCharacter(
      campaign.guildId,
      combatant.userId,
      campaign.channelId
    )?.name || "Adventurer";
  }

  const enemy = campaign.combat?.enemies?.find(
    (item) => item.id === combatant.enemyId
  );
  return enemy?.name || "Enemy";
}

function currentCombatant(campaign) {
  if (!campaign.combat?.active) return null;
  return campaign.combat.initiative[campaign.combat.turnIndex] || null;
}

function livingEnemies(campaign) {
  return (campaign.combat?.enemies || []).filter(
    (enemy) => !enemy.defeated && enemy.hp > 0
  );
}

function consciousPartyMembers(campaign, party) {
  return party.memberIds
    .map((id) => ({ id, character: getCharacter(campaign.guildId, id, campaign.channelId) }))
    .filter(({ character }) => character && character.hp > 0);
}

function combatDamageDice(character, checkName = "Attack") {
  if (checkName === "SpellAttack") {
    if (character.className === "Wizard" || character.className === "Warlock") {
      return "1d10";
    }
    return "1d8";
  }

  if (checkName === "RangedAttack") return "1d8";

  switch (character.className) {
    case "Barbarian":
      return "1d12";
    case "Fighter":
      return "1d8";
    case "Rogue":
      return "1d8";
    case "Ranger":
      return "1d8";
    case "Cleric":
      return "1d8";
    case "Paladin":
      return "1d8";
    case "Bard":
      return "1d8";
    default:
      return "1d6";
  }
}

function doubleDamageDice(expression) {
  const match = String(expression).match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if (!match) return expression;

  const count = Number(match[1] || 1);
  const sides = Number(match[2]);
  const modifier = match[3] || "";

  return `${Math.max(1, count * 2)}d${sides}${modifier}`;
}

function combatStatusEmbed(campaign, party) {
  const combat = campaign.combat;
  const current = currentCombatant(campaign);

  const partyLines = party.memberIds.map((userId) => {
    const character = getCharacter(campaign.guildId, userId, campaign.channelId);
    if (!character) return `❔ Unknown adventurer`;

    const position = getCombatPosition(campaign, userId, character);
    return `${character.hp > 0 ? "❤️" : "💀"} **${character.name}** — ${Math.max(0, character.hp)}/${character.maxHp} HP • AC ${character.ac} • ${positionEmoji(position)} ${positionLabel(position)}`;
  });

  const enemyLines = (combat.enemies || []).map((enemy) => {
    return `${enemy.defeated || enemy.hp <= 0 ? "☠️" : "👹"} **${enemy.name}** — ${Math.max(0, enemy.hp)}/${enemy.maxHp} HP`;
  });

  return new EmbedBuilder()
    .setTitle(`⚔️ Combat — Round ${combat.round}`)
    .setDescription(
      `**Current Turn:** ${combatantLabel(campaign, current)}\n\n` +
      `### Party\n${partyLines.join("\n")}\n\n` +
      `### Enemies\n${enemyLines.join("\n")}`
    )
    .setFooter({
      text:
        current?.type === "player"
          ? "Current player: describe your combat action normally in chat."
          : "Enemy turn is resolving automatically.",
    });
}

async function handleCombatStatus(interaction) {
  const party = getPartyByMember(interaction.guildId, interaction.user.id, interaction.channelId);
  const campaign = party
    ? getActiveCampaignForChannel(interaction.guildId, interaction.channelId)
    : null;

  if (!party || !campaign || campaign.partyId !== party.id) {
    return interaction.reply({
      ephemeral: true,
      content: "There is no active party adventure in this channel.",
    });
  }

  if (!campaign.combat?.active) {
    return interaction.reply({
      ephemeral: true,
      content: "There is no active combat encounter.",
    });
  }

  return interaction.reply({
    ephemeral: true,
    embeds: [combatStatusEmbed(campaign, party)],
  });
}

async function startCombatFromDM(campaign, party, channel, result) {
  const level = averagePartyLevel(party, campaign.guildId);
  const requestedCount = clamp(Number(result.combat_enemy_count || 1), 1, MAX_COMBAT_ENEMIES);
  const name = String(result.combat_enemy_name || "Hostile Creature").slice(0, 60);
  const archetype = ENEMY_ARCHETYPES[result.combat_enemy_archetype]
    ? result.combat_enemy_archetype
    : "skirmisher";

  const enemies = Array.from({ length: requestedCount }, (_, index) =>
    makeEnemy({
      name,
      archetype,
      level,
      number: requestedCount > 1 ? index + 1 : 1,
    })
  );

  const initiative = [];

  for (const userId of party.memberIds) {
    const character = getCharacter(campaign.guildId, userId, campaign.channelId);
    if (!character || character.hp <= 0) continue;

    const roll = 1 + Math.floor(Math.random() * 20);
    initiative.push({
      type: "player",
      userId,
      roll,
      modifier: character.stats?.DEX || 0,
      total: roll + (character.stats?.DEX || 0),
    });
  }

  for (const enemy of enemies) {
    const roll = 1 + Math.floor(Math.random() * 20);
    const modifier = Math.max(0, Math.floor(level / 3));
    initiative.push({
      type: "enemy",
      enemyId: enemy.id,
      roll,
      modifier,
      total: roll + modifier,
    });
  }

  initiative.sort((a, b) => b.total - a.total);

  const positions = {};
  const threat = {};
  for (const userId of party.memberIds) {
    const character = getCharacter(campaign.guildId, userId, campaign.channelId);
    if (!character) continue;
    positions[userId] = defaultCombatPosition(character);
    threat[userId] = 0;
  }

  campaign.combat = {
    active: true,
    round: 1,
    turnIndex: 0,
    enemies,
    initiative,
    startedAt: Date.now(),
    threatName: name,
    positions,
    threat,
    effects: {},
    targetMemory: { lastUserId: null, streak: 0 },
    positionMovedRound: {},
  };

  normalizeCampaignPacing(campaign);
  campaign.pacing.downtimeActive = false;
  campaign.pacing.lastCombatAt = Date.now();

  clearPartyWindowTimer(getPartyWindow(campaign.id));
  saveDataSoon();

  const order = initiative
    .map(
      (item, index) =>
        `${index + 1}. **${combatantLabel(campaign, item)}** — ${item.total}`
    )
    .join("\n");

  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle("⚔️ COMBAT BEGINS!")
        .setDescription(
          `${result.narration}\n\n### Initiative\n${order}`
        )
        .setFooter({
          text:
            "Player turns use normal chat. When a roll is requested, /roll is the reliable option.",
        }),
    ],
  });

  await continueCombatTurns(campaign, party, channel);
}

function pickEnemyTarget(campaign, requestedId = "") {
  const living = livingEnemies(campaign);
  if (!living.length) return null;

  return (
    living.find((enemy) => enemy.id === requestedId) ||
    living[0]
  );
}

async function aiDMCombatTurn(campaign, party, character, playerText) {
  if (!openai) {
    return {
      narration: `${character.name} prepares to strike.`,
      action_kind: "attack",
      check_name: "Attack",
      ability: "STR",
      roll_mode: "normal",
      target_id: livingEnemies(campaign)[0]?.id || "",
      roll_reason: "Make an attack roll.",
    };
  }

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      narration: { type: "string" },
      action_kind: {
        type: "string",
        enum: ["attack", "ranged", "spell", "defend", "utility"],
      },
      check_name: {
        type: "string",
        enum: [
          "Attack",
          "RangedAttack",
          "SpellAttack",
          "Athletics",
          "Acrobatics",
          "Arcana",
          "Medicine",
          "None",
        ],
      },
      ability: {
        type: "string",
        enum: ["STR", "DEX", "CON", "INT", "WIS", "CHA", "NONE"],
      },
      roll_mode: {
        type: "string",
        enum: ["normal", "advantage", "disadvantage"],
      },
      target_id: { type: "string" },
      roll_reason: { type: "string" },
    },
    required: [
      "narration",
      "action_kind",
      "check_name",
      "ability",
      "roll_mode",
      "target_id",
      "roll_reason",
    ],
  };

  const response = await openai.responses.create({
    model: OPENAI_MODEL,
    instructions:
      DM_INSTRUCTIONS +
      `
COMBAT TURN RULES:
- This is one player's turn in initiative.
- Interpret only the action they declared.
- Do not resolve an attack hit/miss yourself.
- For a weapon attack use Attack or RangedAttack.
- For an offensive spell requiring an attack use SpellAttack.
- Defend or simple movement may use check_name None.
- target_id MUST be one of the living enemy IDs supplied, unless the action has no target.
- Choose roll_mode using the same advantage/disadvantage rules as normal checks. If neither clearly applies, use normal.
- Keep combat narration short and punchy.
`,
    input: JSON.stringify(
      {
        actingCharacter: {
          name: character.name,
          className: character.className,
          hp: character.hp,
          maxHp: character.maxHp,
          ac: character.ac,
          stats: character.stats,
          abilities: character.abilities,
          spells: character.spells || [],
          inventory: character.inventory,
        },
        livingEnemies: livingEnemies(campaign).map((enemy) => ({
          id: enemy.id,
          name: enemy.name,
          archetype: enemy.archetype,
          hp: enemy.hp,
          maxHp: enemy.maxHp,
        })),
        playerAction: playerText,
      },
      null,
      2
    ),
    text: {
      format: {
        type: "json_schema",
        name: "combat_turn",
        strict: true,
        schema,
      },
    },
  });

  return JSON.parse(response.output_text);
}

async function processCombatPlayerMessage(message, campaign, party) {
  const combat = campaign.combat;
  if (!combat?.active) return;

  if (pendingRollCount(campaign) > 0) {
    const character = getCharacter(message.guildId, message.author.id, message.channelId);

    if (campaign.pendingChecks?.[message.author.id]) {
      await message.reply(
        `🎲 **${character?.name || "You"} still need to resolve your combat roll.** Type **\`/roll\`**.`
      );
    }
    return;
  }

  const turn = currentCombatant(campaign);

  if (!turn || turn.type !== "player") {
    return;
  }

  if (turn.userId !== message.author.id) {
    const actingName = combatantLabel(campaign, turn);
    await message.reply(
      `⏳ It's currently **${actingName}'s turn**. You can keep discussing tactics in voice chat, but combat actions resolve in initiative order.`
    );
    return;
  }

  const character = getCharacter(message.guildId, message.author.id, message.channelId);
  if (!character || character.hp <= 0) {
    await advanceCombatTurn(campaign, party, message.channel);
    return;
  }

  const text = cleanPlayerText(message.content);
  if (!text) return;

  await message.channel.sendTyping();

  try {
    const result = await aiDMCombatTurn(
      campaign,
      party,
      character,
      text
    );

    appendLog(campaign, {
      type: "combat_action",
      userId: message.author.id,
      characterName: character.name,
      text,
    });

    await message.channel.send(
      `⚔️ **${character.name}'s Turn**\n${result.narration}`
    );

    if (
      ["attack", "ranged", "spell"].includes(result.action_kind) &&
      result.check_name !== "None"
    ) {
      const target = pickEnemyTarget(campaign, result.target_id);

      if (!target) {
        await endCombatVictory(campaign, party, message.channel);
        return;
      }

      const ability =
        result.ability === "NONE"
          ? result.check_name === "SpellAttack"
            ? ["Wizard"].includes(character.className)
              ? "INT"
              : ["Cleric", "Ranger"].includes(character.className)
                ? "WIS"
                : "CHA"
            : result.check_name === "RangedAttack"
              ? "DEX"
              : "STR"
          : result.ability;

      campaign.pendingChecks ||= {};
      campaign.pendingChecks[message.author.id] = {
        id: uid(),
        checkName: result.check_name,
        ability,
        dice: "1d20",
        rollMode: combatAttackRollMode(
          campaign,
          message.author.id,
          result.roll_mode,
          result.check_name
        ),
        dc: target.ac,
        reason:
          result.roll_reason ||
          `Attack ${target.name}.`,
        successDirection: `Hit ${target.name}.`,
        failureDirection: `Miss ${target.name}.`,
        channelId: campaign.channelId,
        createdAt: Date.now(),
        combatAttack: true,
        combatTargetId: target.id,
        combatDamageDice: combatDamageDice(
          character,
          result.check_name
        ),
        noCheckXP: true,
      };

      saveDataSoon();

      const pending = campaign.pendingChecks[message.author.id];

      await message.channel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle(
              `🎲 ${character.name} attacks ${target.name}!`
            )
            .setDescription(
              `${pending.reason}\n\n**Target AC:** hidden from the player roll flow`
            )
            .addFields(
              {
                name: "Roll",
                value: "**1d20**",
                inline: true,
              },
              {
                name: "Modifier",
                value: `${ability} ${formatModifier(character.stats[ability] || 0)}`,
                inline: true,
              },
              {
                name: "Roll Mode",
                value:
                  `${rollModeEmoji(pending.rollMode)} **${rollModeLabel(pending.rollMode)}**
` +
                  rollModeInstruction(pending.rollMode),
                inline: false,
              }
            )
            .setFooter({
              text:
                "Type /roll to resolve the attack. 3D Dice remains optional/experimental.",
            }),
        ],
        components: [make3DDiceButton(pending)],
      });

      return;
    }

    // Defend / utility actions do not require a roll in Combat v1.
    if (result.action_kind === "defend") {
      combat.defending ||= {};
      combat.defending[message.author.id] = true;

      await message.channel.send(
        `🛡️ **${character.name} takes a defensive stance.** Their AC is temporarily +2 until their next turn.`
      );
    }

    await advanceCombatTurn(campaign, party, message.channel);
  } catch (err) {
    console.error("Combat player-turn error:", err);
    await message.channel.send(
      "⚠️ The DM couldn't interpret that combat action. Try describing the action again."
    );
  }
}

function effectiveCharacterAC(campaign, userId, character) {
  const defending = Boolean(campaign.combat?.defending?.[userId]);
  return character.ac + (defending ? 2 : 0);
}

async function runEnemyTurn(campaign, party, channel, enemy) {
  const chosen = chooseEnemyTarget(campaign, party, enemy);
  if (!chosen) {
    await endCombatDefeat(campaign, party, channel);
    return;
  }

  const target = { id: chosen.id, character: chosen.character };
  const targetAC = effectiveCharacterAC(campaign, target.id, target.character);
  const effects = getCombatEffects(campaign, target.id);
  const hasAdvantage = Boolean(effects.recklessExposed);
  const attackRolls = hasAdvantage
    ? [1 + Math.floor(Math.random() * 20), 1 + Math.floor(Math.random() * 20)]
    : [1 + Math.floor(Math.random() * 20)];
  const natural = hasAdvantage ? Math.max(...attackRolls) : attackRolls[0];
  const total = natural + enemy.attackBonus;
  const hit = natural === 20 || (natural !== 1 && total >= targetAC);

  let damage = 0;
  let rageReduced = false;
  if (hit) {
    const damageRoll = rollDice(natural === 20 ? doubleDamageDice(enemy.damageDice) : enemy.damageDice);
    damage = Math.max(1, damageRoll?.total || 1);
    if (effects.rage) {
      damage = Math.max(1, Math.floor(damage / 2));
      rageReduced = true;
    }
    target.character.hp = Math.max(0, target.character.hp - damage);
    target.character.updatedAt = Date.now();
  }

  saveDataSoon();

  await channel.send({
    content:
      `👹 **${enemy.name}'s Turn**\n` +
      `🎯 ${enemy.name} ${chosen.reason}: **${target.character.name}** (${positionLabel(chosen.position)}).\n` +
      (hasAdvantage
        ? `🟢 Advantage: **${attackRolls[0]} / ${attackRolls[1]}** → kept **${natural}** + ${enemy.attackBonus} = **${total}** vs AC **${targetAC}**\n`
        : `Attack Roll: **${natural}** + ${enemy.attackBonus} = **${total}** vs AC **${targetAC}**\n`) +
      (hit
        ? `💥 **HIT! ${damage} damage.** ${rageReduced ? "🔥 Rage reduced the damage. " : ""}${target.character.name}: **${target.character.hp}/${target.character.maxHp} HP**`
        : `💨 **MISS!**`) +
      (target.character.hp <= 0 ? `\n💀 **${target.character.name} is down!**` : ""),
    allowedMentions: { parse: [] },
  });
}
async function advanceCombatTurn(campaign, party, channel) {
  const combat = campaign.combat;
  if (!combat?.active) return;

  if (!livingEnemies(campaign).length) {
    await endCombatVictory(campaign, party, channel);
    return;
  }

  if (!consciousPartyMembers(campaign, party).length) {
    await endCombatDefeat(campaign, party, channel);
    return;
  }

  // Clear defend when that player's next turn arrives, handled below.
  let safety = 0;

  while (combat.active && safety++ < 30) {
    combat.turnIndex += 1;

    if (combat.turnIndex >= combat.initiative.length) {
      combat.turnIndex = 0;
      combat.round += 1;

      await channel.send(`## ⚔️ Round ${combat.round}`);
    }

    const turn = currentCombatant(campaign);
    if (!turn) return;

    if (turn.type === "enemy") {
      const enemy = combat.enemies.find(
        (item) => item.id === turn.enemyId
      );

      if (!enemy || enemy.defeated || enemy.hp <= 0) continue;

      await runEnemyTurn(
        campaign,
        party,
        channel,
        enemy
      );

      if (!combat.active) return;
      continue;
    }

    const character = getCharacter(
      campaign.guildId,
      turn.userId,
      campaign.channelId
    );

    if (!character || character.hp <= 0) continue;

    combat.defending ||= {};
    delete combat.defending[turn.userId];
    const effects = getCombatEffects(campaign, turn.userId);
    delete effects.recklessExposed;
    delete effects.recklessNext;

    saveDataSoon();

    await channel.send({
      content:
        `🎯 **${character.name}, it's your turn!**\n` +
        `Describe what you do in normal chat. You can coordinate with the party in voice chat first.`,
      allowedMentions: { parse: [] },
    });

    return;
  }
}

async function continueCombatTurns(campaign, party, channel) {
  const combat = campaign.combat;
  if (!combat?.active) return;

  let safety = 0;

  while (combat.active && safety++ < 30) {
    const turn = currentCombatant(campaign);
    if (!turn) return;

    if (turn.type === "player") {
      const character = getCharacter(
        campaign.guildId,
        turn.userId,
        campaign.channelId
      );

      if (!character || character.hp <= 0) {
        await advanceCombatTurn(campaign, party, channel);
        return;
      }

      await channel.send({
        embeds: [combatStatusEmbed(campaign, party)],
      });

      await channel.send({
        content:
          `🎯 **${character.name}, you're first!** Describe your combat action in normal chat.`,
        allowedMentions: { parse: [] },
      });

      return;
    }

    const enemy = combat.enemies.find(
      (item) => item.id === turn.enemyId
    );

    if (enemy && !enemy.defeated && enemy.hp > 0) {
      await runEnemyTurn(campaign, party, channel, enemy);
    }

    if (!combat.active) return;

    await advanceCombatTurn(campaign, party, channel);
    return;
  }
}

async function resolveCombatAttackAfterRoll({
  interaction,
  campaign,
  party,
  character,
  pending,
  naturalRoll,
  outcome,
}) {
  const combat = campaign.combat;

  if (!combat?.active) {
    return interaction.followUp(
      "⚠️ The attack roll resolved, but the combat encounter is no longer active."
    );
  }

  const enemy = combat.enemies.find(
    (item) => item.id === pending.combatTargetId
  );

  if (!enemy || enemy.defeated || enemy.hp <= 0) {
    await interaction.followUp(
      "⚠️ That target was already defeated. Your turn will advance."
    );
    await advanceCombatTurn(
      campaign,
      party,
      interaction.channel
    );
    return;
  }

  if (outcome === "SUCCESS") {
    const damageExpression =
      naturalRoll === 20
        ? doubleDamageDice(
            pending.combatDamageDice || "1d6"
          )
        : pending.combatDamageDice || "1d6";

    const damageRoll = rollDice(damageExpression);
    const baseDamage = Math.max(1, damageRoll?.total || 1);
    const damageResult = applyCombatDamageBonuses(campaign, party, character, pending, enemy, baseDamage);
    const damage = damageResult.damage;

    enemy.hp = Math.max(0, enemy.hp - damage);

    if (enemy.hp <= 0) {
      enemy.defeated = true;
    }

    saveDataSoon();

    await interaction.followUp({
      content:
        `💥 **${character.name} hits ${enemy.name}!**\n` +
        `${naturalRoll === 20 ? "🌟 **CRITICAL HIT!**\n" : ""}` +
        `Damage: **${damage}** (${damageExpression})\n` +
        (damageResult.bonuses.length ? `${damageResult.bonuses.join(" • ")}\n` : "") +
        `${enemy.name}: **${enemy.hp}/${enemy.maxHp} HP**` +
        (enemy.defeated ? `\n☠️ **${enemy.name} is defeated!**` : ""),
      allowedMentions: { parse: [] },
    });
  } else {
    await interaction.followUp(
      `💨 **${character.name}'s attack misses ${enemy.name}.**`
    );
  }

  if (!livingEnemies(campaign).length) {
    await endCombatVictory(
      campaign,
      party,
      interaction.channel
    );
    return;
  }

  await advanceCombatTurn(
    campaign,
    party,
    interaction.channel
  );
}

async function resolveCombatAttackAfterPhysicalRoll({
  channel,
  campaign,
  party,
  character,
  pending,
  naturalRoll,
  outcome,
}) {
  const combat = campaign.combat;

  if (!combat?.active) {
    await channel.send(
      "⚠️ The attack roll resolved, but the combat encounter is no longer active."
    );
    return;
  }

  const enemy = combat.enemies.find(
    (item) => item.id === pending.combatTargetId
  );

  if (!enemy || enemy.defeated || enemy.hp <= 0) {
    await channel.send(
      "⚠️ That target was already defeated. Your turn will advance."
    );
    await advanceCombatTurn(campaign, party, channel);
    return;
  }

  if (outcome === "SUCCESS") {
    const damageExpression =
      naturalRoll === 20
        ? doubleDamageDice(pending.combatDamageDice || "1d6")
        : pending.combatDamageDice || "1d6";

    const damageRoll = rollDice(damageExpression);
    const baseDamage = Math.max(1, damageRoll?.total || 1);
    const damageResult = applyCombatDamageBonuses(campaign, party, character, pending, enemy, baseDamage);
    const damage = damageResult.damage;

    enemy.hp = Math.max(0, enemy.hp - damage);

    if (enemy.hp <= 0) {
      enemy.defeated = true;
    }

    appendLog(campaign, {
      type: "combat_damage",
      source: "3d_activity",
      userId: character.userId,
      characterName: character.name,
      targetId: enemy.id,
      targetName: enemy.name,
      naturalRoll,
      damage,
      damageExpression,
      defeated: enemy.defeated,
    });

    saveDataSoon();

    await channel.send({
      content:
        `💥 **${character.name} hits ${enemy.name}!**\n` +
        `${naturalRoll === 20 ? "🌟 **CRITICAL HIT!**\n" : ""}` +
        `🎲 Damage: **${damage}** (${damageExpression})\n` +
        (damageResult.bonuses.length ? `${damageResult.bonuses.join(" • ")}\n` : "") +
        `❤️ ${enemy.name}: **${enemy.hp}/${enemy.maxHp} HP**` +
        (enemy.defeated
          ? `\n☠️ **${enemy.name} is defeated!**`
          : ""),
      allowedMentions: { parse: [] },
    });
  } else {
    appendLog(campaign, {
      type: "combat_miss",
      source: "3d_activity",
      userId: character.userId,
      characterName: character.name,
      targetId: enemy.id,
      targetName: enemy.name,
      naturalRoll,
    });

    saveDataSoon();

    await channel.send({
      content: `💨 **${character.name}'s attack misses ${enemy.name}.**`,
      allowedMentions: { parse: [] },
    });
  }

  if (!livingEnemies(campaign).length) {
    await endCombatVictory(campaign, party, channel);
    return;
  }

  await advanceCombatTurn(campaign, party, channel);
}

async function endCombatVictory(campaign, party, channel) {
  const combat = campaign.combat;
  if (!combat?.active) return;

  combat.active = false;
  combat.endedAt = Date.now();
  combat.result = "victory";

  const totalXP = combat.enemies.reduce(
    (sum, enemy) => sum + Number(enemy.xpValue || 0),
    0
  );

  const perCharacterXP = Math.max(
    10,
    Math.floor(totalXP / Math.max(1, party.memberIds.length))
  );

  const levelUps = [];

  for (const userId of party.memberIds) {
    const character = getCharacter(campaign.guildId, userId, campaign.channelId);
    if (!character) continue;

    const progression = awardCharacterXP(
      character,
      perCharacterXP,
      `Combat victory: ${combat.threatName}`
    );

    if (progression.levelUps.length) {
      levelUps.push({ character, progression });
    }
  }

  normalizeCampaignPacing(campaign);
  campaign.pacing.actionBeats = 0;
  campaign.pacing.downtimeActive = true;
  campaign.pacing.lastDowntimeAt = Date.now();

  appendLog(campaign, {
    type: "system",
    text: `Combat ended in victory against ${combat.threatName}.`,
  });

  saveDataSoon();

  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle("🏆 Combat Victory!")
        .setDescription(
          `The final enemy falls. Each party member earns **${perCharacterXP} XP**.\n\n` +
          "The immediate danger is over."
        ),
    ],
  });

  for (const item of levelUps) {
    await channel.send({
      embeds: [levelUpEmbed(item.character, item.progression)],
    });
  }

  await sendDowntimeBanner(
    channel,
    campaign,
    "Adrenaline fades. Weapons lower. For once, nobody is attacking."
  );

  resumePartyWindowAfterRoll(campaign);
}

async function endCombatDefeat(campaign, party, channel) {
  const combat = campaign.combat;
  if (!combat?.active) return;

  combat.active = false;
  combat.endedAt = Date.now();
  combat.result = "defeat";

  normalizeCampaignPacing(campaign);
  campaign.pacing.actionBeats = 0;
  campaign.pacing.downtimeActive = true;

  appendLog(campaign, {
    type: "system",
    text:
      "The entire party was downed in combat. The campaign continues; character death was not applied automatically.",
  });

  saveDataSoon();

  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle("💀 The Party Is Down")
        .setDescription(
          "Every adventurer has been reduced to 0 HP.\n\n" +
          "**Combat v1 does not automatically kill player characters.** " +
          "The DM can continue with capture, rescue, awakening after the battle, or another story consequence."
        ),
    ],
  });

  await sendDowntimeBanner(
    channel,
    campaign,
    "Consciousness eventually returns—or help arrives. The story is not over."
  );
}

// ============================================================
// CLASS ABILITIES + SMART TARGETING v1.8
// ============================================================

const COMBAT_POSITIONS = ["frontline", "midline", "backline"];

const ABILITY_DEFINITIONS = {
  "Second Wind": { type: "active", recharge: "short", maxUses: 1, description: "Heal 1d10 + Fighter level." },
  "Weapon Training": { type: "passive", description: "Passive Fighter combat training." },
  Rage: { type: "active", recharge: "long", maxUses: 2, description: "+2 melee damage and half enemy weapon damage for the encounter." },
  "Reckless Strike": { type: "active", description: "Next melee attack gains Advantage; enemies gain Advantage against you until your next turn." },
  "Sneak Attack": { type: "active", description: "Arm +1d6 on your next qualifying hit this round." },
  "Cunning Action": { type: "active", description: "Quickly reposition between combat distance bands." },
  "Hunter's Mark": { type: "active", recharge: "long", maxUses: 2, description: "Marked enemy takes +1d6 from your successful attacks." },
  Trailwise: { type: "passive", description: "Passive wilderness and tracking expertise." },
  "Arcane Recovery": { type: "active", recharge: "long", maxUses: 1, description: "Tracked magical recovery; full spell-slot integration comes later." },
  Spellcasting: { type: "passive", description: "Spellcasting is interpreted by the DM; full spell-slot tracking comes later." },
  "Divine Spark": { type: "active", recharge: "long", maxUses: 2, description: "Heal yourself or an ally for 1d8 + WIS." },
  "Bardic Inspiration": { type: "active", recharge: "long", maxUses: 3, description: "Tracked inspiration resource; d6 roll integration is the next spell/support pass." },
  "Eldritch Blast": { type: "active", description: "At-will CHA spell attack for 1d10 damage." },
  "Pact Magic": { type: "passive", description: "Pact magic is interpreted by the DM; pact-slot tracking comes later." },
};

function defaultCombatPosition(character) {
  const saved = String(character?.preferredCombatPosition || "").toLowerCase();
  if (COMBAT_POSITIONS.includes(saved)) return saved;
  if (["Fighter", "Barbarian", "Cleric"].includes(character?.className)) return "frontline";
  if (["Wizard", "Warlock"].includes(character?.className)) return "backline";
  return "midline";
}

function positionEmoji(position) {
  return position === "frontline" ? "🛡️" : position === "backline" ? "🏹" : "⚔️";
}

function positionLabel(position) {
  return position === "frontline" ? "Frontline" : position === "backline" ? "Backline" : "Midline";
}

function normalizeAbilityState(character) {
  character.abilityState ||= { uses: {}, active: {} };
  character.abilityState.uses ||= {};
  character.abilityState.active ||= {};

  for (const name of character.abilities || []) {
    const def = ABILITY_DEFINITIONS[name];
    if (!def?.maxUses) continue;
    if (!Number.isFinite(character.abilityState.uses[name])) {
      character.abilityState.uses[name] = def.maxUses;
    } else {
      character.abilityState.uses[name] = Math.max(0, Math.min(def.maxUses, character.abilityState.uses[name]));
    }
  }
  return character.abilityState;
}

function abilityUsesText(character, name) {
  normalizeAbilityState(character);
  const def = ABILITY_DEFINITIONS[name];
  if (!def) return "Available";
  if (def.type === "passive") return "Passive";
  if (!def.maxUses) return "At will";
  return `${character.abilityState.uses[name]}/${def.maxUses} • ${def.recharge === "short" ? "Short/Long Rest" : "Long Rest"}`;
}

function consumeAbilityUse(character, name) {
  normalizeAbilityState(character);
  const def = ABILITY_DEFINITIONS[name];
  if (!def?.maxUses) return true;
  if ((character.abilityState.uses[name] || 0) <= 0) return false;
  character.abilityState.uses[name] -= 1;
  character.updatedAt = Date.now();
  return true;
}

function restoreAbilityUses(character, restType) {
  normalizeAbilityState(character);
  for (const name of character.abilities || []) {
    const def = ABILITY_DEFINITIONS[name];
    if (!def?.maxUses) continue;
    if (restType === "long" || (restType === "short" && def.recharge === "short")) {
      character.abilityState.uses[name] = def.maxUses;
    }
  }
}

function getCombatEffects(campaign, userId) {
  campaign.combat ||= {};
  campaign.combat.effects ||= {};
  campaign.combat.effects[userId] ||= {};
  return campaign.combat.effects[userId];
}

function getCombatPosition(campaign, userId, character) {
  campaign.combat ||= {};
  campaign.combat.positions ||= {};
  campaign.combat.positions[userId] ||= defaultCombatPosition(character);
  return campaign.combat.positions[userId];
}

function isPlayersCombatTurn(campaign, userId) {
  const turn = currentCombatant(campaign);
  return Boolean(turn?.type === "player" && turn.userId === userId);
}

function findEnemyByName(campaign, targetText) {
  const living = livingEnemies(campaign);
  const wanted = String(targetText || "").trim().toLowerCase();
  if (!living.length) return null;
  if (!wanted) return living[0];
  return living.find((e) => e.name.toLowerCase() === wanted)
    || living.find((e) => e.name.toLowerCase().includes(wanted))
    || null;
}

function findPartyCharacterByName(party, guildId, targetText) {
  const wanted = String(targetText || "").trim().toLowerCase();
  if (!wanted) return null;
  return party.memberIds
    .map((userId) => ({ userId, character: getCharacter(guildId, userId, resolvePartyChannel(party)) }))
    .filter((x) => x.character)
    .find((x) => x.character.name.toLowerCase() === wanted || x.character.name.toLowerCase().includes(wanted)) || null;
}

function addCombatThreat(campaign, userId, amount) {
  if (!campaign?.combat?.active) return;
  campaign.combat.threat ||= {};
  campaign.combat.threat[userId] = Number(campaign.combat.threat[userId] || 0) + Math.max(0, Number(amount || 0));
}

function weightedPick(items) {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  if (total <= 0) return items[Math.floor(Math.random() * items.length)] || null;
  let cursor = Math.random() * total;
  for (const item of items) {
    cursor -= Math.max(0, item.weight);
    if (cursor <= 0) return item;
  }
  return items[items.length - 1] || null;
}

function chooseEnemyTarget(campaign, party, enemy) {
  const conscious = consciousPartyMembers(campaign, party);
  if (!conscious.length) return null;

  const combat = campaign.combat;
  combat.threat ||= {};
  combat.targetMemory ||= { lastUserId: null, streak: 0 };

  const tables = {
    minion: { frontline: 4.5, midline: 2.0, backline: 0.8 },
    brute: { frontline: 5.5, midline: 1.8, backline: 0.5 },
    skirmisher: { frontline: 1.4, midline: 3.0, backline: 3.6 },
    caster: { frontline: 0.9, midline: 2.5, backline: 4.2 },
    boss: { frontline: 2.8, midline: 2.8, backline: 2.8 },
  };
  const table = tables[enemy.archetype] || tables.skirmisher;

  const choices = conscious.map(({ id, character }) => {
    const position = getCombatPosition(campaign, id, character);
    const threat = Number(combat.threat[id] || 0);
    const hpRatio = character.maxHp ? character.hp / character.maxHp : 1;
    let weight = Number(table[position] || 1);
    weight *= 1 + Math.min(1.5, threat / (enemy.archetype === "boss" ? 10 : 20));
    weight *= 1 + (1 - hpRatio) * 0.55;
    if (combat.defending?.[id]) weight *= 1.15;
    if (combat.targetMemory.lastUserId === id) {
      weight *= combat.targetMemory.streak >= 2 ? 0.16 : 0.40;
    }
    weight *= 0.75 + Math.random() * 0.5;
    return { id, character, position, threat, weight };
  });

  const chosen = weightedPick(choices);
  if (!chosen) return null;

  if (combat.targetMemory.lastUserId === chosen.id) combat.targetMemory.streak += 1;
  else {
    combat.targetMemory.lastUserId = chosen.id;
    combat.targetMemory.streak = 1;
  }

  let reason = "spots an opening";
  if (["brute", "minion"].includes(enemy.archetype) && chosen.position === "frontline") reason = "presses the frontline";
  else if (["skirmisher", "caster"].includes(enemy.archetype) && chosen.position === "backline") reason = "finds a path toward the backline";
  else if (chosen.threat >= 8) reason = "turns toward the adventurer drawing the most threat";
  else if (chosen.character.hp / chosen.character.maxHp < 0.45) reason = "notices a wounded adventurer";

  return { ...chosen, reason };
}

function combatAttackRollMode(campaign, userId, requestedMode, checkName) {
  const effects = getCombatEffects(campaign, userId);
  if (checkName === "Attack" && effects.recklessNext) {
    effects.recklessNext = false;
    effects.recklessExposed = true;
    return "advantage";
  }
  return normalizeRollMode(requestedMode);
}

function applyCombatDamageBonuses(campaign, party, character, pending, enemy, baseDamage) {
  const effects = getCombatEffects(campaign, character.userId);
  let damage = baseDamage;
  const bonuses = [];

  if (effects.rage && pending.checkName === "Attack") {
    damage += 2;
    bonuses.push("🔥 Rage +2");
  }

  if (effects.huntersMarkTargetId === enemy.id) {
    const extra = rollDice("1d6")?.total || 1;
    damage += extra;
    bonuses.push(`🏹 Hunter's Mark +${extra}`);
  }

  if (effects.sneakAttackArmed && effects.sneakAttackUsedRound !== campaign.combat.round) {
    const allyFrontline = party.memberIds.some((id) => {
      if (id === character.userId) return false;
      const ally = getCharacter(campaign.guildId, id, campaign.channelId);
      return ally && ally.hp > 0 && getCombatPosition(campaign, id, ally) === "frontline";
    });
    if (pending.rollMode === "advantage" || allyFrontline) {
      const extra = rollDice("1d6")?.total || 1;
      damage += extra;
      bonuses.push(`🗡️ Sneak Attack +${extra}`);
      effects.sneakAttackArmed = false;
      effects.sneakAttackUsedRound = campaign.combat.round;
    }
  }

  addCombatThreat(campaign, character.userId, damage);
  return { damage, bonuses };
}

async function handleAbilitiesCommand(interaction) {
  const character = getCharacter(interaction.guildId, interaction.user.id, interaction.channelId);
  if (!character) return interaction.reply({ ephemeral: true, content: "Create a character first with `/createcharacter`." });
  normalizeAbilityState(character);
  const lines = (character.abilities || []).map((name) => {
    const def = ABILITY_DEFINITIONS[name];
    return `**${name}** — ${abilityUsesText(character, name)}\n${def?.description || "Character feature."}`;
  });
  return interaction.reply({
    ephemeral: true,
    embeds: [new EmbedBuilder().setTitle(`✨ ${character.name} — Abilities`).setDescription(lines.join("\n\n") || "No abilities found.").setFooter({ text: "Use /useability with the exact ability name shown here." })],
  });
}

async function handlePositionCommand(interaction) {
  const character = getCharacter(interaction.guildId, interaction.user.id, interaction.channelId);
  if (!character) return interaction.reply({ ephemeral: true, content: "Create a character first." });
  const position = interaction.options.getString("position", true);
  const party = getPartyByMember(interaction.guildId, interaction.user.id, interaction.channelId);
  const campaign = party ? getActiveCampaignForChannel(interaction.guildId, interaction.channelId) : null;

  if (!campaign?.combat?.active) {
    character.preferredCombatPosition = position;
    saveDataSoon();
    return interaction.reply({ ephemeral: true, content: `${positionEmoji(position)} **Default combat position set to ${positionLabel(position)}.**` });
  }

  if (!isPlayersCombatTurn(campaign, interaction.user.id)) {
    return interaction.reply({ ephemeral: true, content: "⏳ Change position on your own turn." });
  }

  campaign.combat.positionMovedRound ||= {};
  if (campaign.combat.positionMovedRound[interaction.user.id] === campaign.combat.round) {
    return interaction.reply({ ephemeral: true, content: "You already changed position this round." });
  }

  campaign.combat.positions[interaction.user.id] = position;
  campaign.combat.positionMovedRound[interaction.user.id] = campaign.combat.round;
  character.preferredCombatPosition = position;
  saveDataSoon();
  return interaction.reply({ content: `${positionEmoji(position)} **${character.name} moves to the ${positionLabel(position)}.**` });
}

async function handleUseAbilityCommand(interaction) {
  const character = getCharacter(interaction.guildId, interaction.user.id, interaction.channelId);
  if (!character) return interaction.reply({ ephemeral: true, content: "Create a character first." });

  const requested = interaction.options.getString("ability", true).trim();
  const targetText = interaction.options.getString("target")?.trim() || "";
  const ability = (character.abilities || []).find((name) => name.toLowerCase() === requested.toLowerCase());
  if (!ability) return interaction.reply({ ephemeral: true, content: `**${requested}** is not on your sheet. Use \`/abilities\` for exact names.` });

  const def = ABILITY_DEFINITIONS[ability];
  if (!def || def.type === "passive") {
    return interaction.reply({ ephemeral: true, content: `ℹ️ **${ability}** is passive. ${def?.description || ""}` });
  }

  const party = getPartyByMember(interaction.guildId, interaction.user.id, interaction.channelId);
  const campaign = party ? getActiveCampaignForChannel(interaction.guildId, interaction.channelId) : null;
  const combat = campaign?.combat?.active ? campaign.combat : null;

  if (ability === "Second Wind") {
    if (!consumeAbilityUse(character, ability)) return interaction.reply({ ephemeral: true, content: "❌ Second Wind is spent until a Short or Long Rest." });
    const heal = (rollDice("1d10")?.total || 1) + character.level;
    const before = character.hp;
    character.hp = Math.min(character.maxHp, character.hp + heal);
    saveDataSoon();
    return interaction.reply({ content: `💨 **${character.name} uses Second Wind!**\n❤️ ${before} → **${character.hp}/${character.maxHp} HP**\nUses remaining: **${character.abilityState.uses[ability]}**` });
  }

  if (ability === "Rage") {
    if (!combat) return interaction.reply({ ephemeral: true, content: "Rage can only be activated during combat." });
    if (!consumeAbilityUse(character, ability)) return interaction.reply({ ephemeral: true, content: "❌ No Rages remain until a Long Rest." });
    getCombatEffects(campaign, interaction.user.id).rage = true;
    saveDataSoon();
    return interaction.reply({ content: `🔥 **${character.name} enters a RAGE!**\nMelee damage **+2** • Enemy weapon damage **halved**\nRages remaining: **${character.abilityState.uses[ability]}**` });
  }

  if (ability === "Reckless Strike") {
    if (!combat || !isPlayersCombatTurn(campaign, interaction.user.id)) return interaction.reply({ ephemeral: true, content: "Use Reckless Strike during your own combat turn." });
    getCombatEffects(campaign, interaction.user.id).recklessNext = true;
    saveDataSoon();
    return interaction.reply({ content: `🪓 **${character.name} attacks recklessly!**\nNext melee attack: **Advantage**. Enemy attacks against you: **Advantage** until your next turn.` });
  }

  if (ability === "Sneak Attack") {
    if (!combat || !isPlayersCombatTurn(campaign, interaction.user.id)) return interaction.reply({ ephemeral: true, content: "Arm Sneak Attack during your combat turn." });
    const effects = getCombatEffects(campaign, interaction.user.id);
    if (effects.sneakAttackUsedRound === combat.round) return interaction.reply({ ephemeral: true, content: "Sneak Attack was already used this round." });
    effects.sneakAttackArmed = true;
    saveDataSoon();
    return interaction.reply({ content: `🗡️ **Sneak Attack armed.** Your next qualifying hit this round deals **+1d6**.` });
  }

  if (ability === "Cunning Action") {
    const position = targetText.toLowerCase();
    if (!COMBAT_POSITIONS.includes(position)) return interaction.reply({ ephemeral: true, content: "Use target `frontline`, `midline`, or `backline`." });
    if (!combat || !isPlayersCombatTurn(campaign, interaction.user.id)) return interaction.reply({ ephemeral: true, content: "Use Cunning Action during your own combat turn." });
    combat.positions[interaction.user.id] = position;
    character.preferredCombatPosition = position;
    saveDataSoon();
    return interaction.reply({ content: `💨 **${character.name} uses Cunning Action** and slips to the **${positionLabel(position)}**.` });
  }

  if (ability === "Hunter's Mark") {
    if (!combat) return interaction.reply({ ephemeral: true, content: "Hunter's Mark currently targets enemies during combat." });
    const enemy = findEnemyByName(campaign, targetText);
    if (!enemy) return interaction.reply({ ephemeral: true, content: "Enemy not found. Use `/combat status` for names." });
    if (!consumeAbilityUse(character, ability)) return interaction.reply({ ephemeral: true, content: "❌ No Hunter's Mark uses remain until a Long Rest." });
    getCombatEffects(campaign, interaction.user.id).huntersMarkTargetId = enemy.id;
    saveDataSoon();
    return interaction.reply({ content: `🏹 **${enemy.name} is marked.** Successful attacks against it deal **+1d6 damage**.\nMarks remaining: **${character.abilityState.uses[ability]}**` });
  }

  if (ability === "Divine Spark") {
    if (!party) return interaction.reply({ ephemeral: true, content: "Join a party first." });
    const target = targetText ? findPartyCharacterByName(party, interaction.guildId, targetText) : { userId: interaction.user.id, character };
    if (!target) return interaction.reply({ ephemeral: true, content: "Party member not found by character name." });
    if (!consumeAbilityUse(character, ability)) return interaction.reply({ ephemeral: true, content: "❌ No Divine Spark uses remain until a Long Rest." });
    const heal = (rollDice("1d8")?.total || 1) + Number(character.stats?.WIS || 0);
    const before = target.character.hp;
    target.character.hp = Math.min(target.character.maxHp, target.character.hp + heal);
    addCombatThreat(campaign, interaction.user.id, Math.max(1, target.character.hp - before) / 2);
    saveDataSoon();
    await interaction.reply({ content: `✨ **${character.name} uses Divine Spark on ${target.character.name}!**\n❤️ ${before} → **${target.character.hp}/${target.character.maxHp} HP**\nUses remaining: **${character.abilityState.uses[ability]}**` });
    if (combat && isPlayersCombatTurn(campaign, interaction.user.id)) await advanceCombatTurn(campaign, party, interaction.channel);
    return;
  }

  if (ability === "Bardic Inspiration") {
    if (!consumeAbilityUse(character, ability)) return interaction.reply({ ephemeral: true, content: "❌ No Bardic Inspiration uses remain until a Long Rest." });
    saveDataSoon();
    return interaction.reply({ content: `🎵 **${character.name} uses Bardic Inspiration.**\nThe use is tracked now; the actual d6 bonus-roll hook will be added with the support/spell resource pass.\nUses remaining: **${character.abilityState.uses[ability]}**` });
  }

  if (ability === "Eldritch Blast") {
    if (!combat || !party || !isPlayersCombatTurn(campaign, interaction.user.id)) return interaction.reply({ ephemeral: true, content: "Use Eldritch Blast during your own combat turn." });
    const enemy = findEnemyByName(campaign, targetText);
    if (!enemy) return interaction.reply({ ephemeral: true, content: "Enemy not found. Use `/combat status` for names." });
    if (campaign.pendingChecks?.[interaction.user.id]) return interaction.reply({ ephemeral: true, content: "Resolve your current pending roll first." });

    campaign.pendingChecks ||= {};
    const pending = {
      id: uid(), checkName: "SpellAttack", ability: "CHA", dice: "1d20", rollMode: "normal", dc: enemy.ac,
      reason: `Blast ${enemy.name} with eldritch power.`, successDirection: `Hit ${enemy.name}.`, failureDirection: `Miss ${enemy.name}.`,
      channelId: campaign.channelId, createdAt: Date.now(), combatAttack: true, combatTargetId: enemy.id,
      combatDamageDice: "1d10", noCheckXP: true,
    };
    campaign.pendingChecks[interaction.user.id] = pending;
    saveDataSoon();
    return interaction.reply({ content: `🌑 **${character.name} casts Eldritch Blast at ${enemy.name}!**\n🎲 Make a **CHA spell attack**.`, components: [make3DDiceButton(pending)] });
  }

  if (ability === "Arcane Recovery") {
    if (!consumeAbilityUse(character, ability)) return interaction.reply({ ephemeral: true, content: "❌ Arcane Recovery is spent until a Long Rest." });
    saveDataSoon();
    return interaction.reply({ content: `🧙 **${character.name} uses Arcane Recovery.** The use is now tracked; full spell-slot recovery plugs into this when spell slots arrive.` });
  }

  return interaction.reply({ ephemeral: true, content: `ℹ️ **${ability}** does not yet have a mechanical handler.` });
}

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

function characterStorageKey(guildId, channelId, userId) {
  return `${guildId}:${channelId}:${userId}`;
}

function legacyCharacterStorageKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function normalizeLoadedCharacter(character, channelId = "") {
  if (!character) return null;

  normalizeCharacterProgression(character);
  normalizeAbilityState(character);
  character.preferredCombatPosition ||= defaultCombatPosition(character);

  if (channelId) character.channelId = channelId;
  return character;
}

function inferLegacyCharacterChannel(guildId, userId) {
  const parties = Object.values(data.parties).filter(
    (party) =>
      party.guildId === guildId &&
      party.memberIds?.includes(userId)
  );

  const campaigns = Object.values(data.campaigns)
    .filter(
      (campaign) =>
        campaign.guildId === guildId &&
        parties.some((party) => party.id === campaign.partyId) &&
        campaign.channelId
    )
    .sort(
      (a, b) =>
        Number(b.updatedAt || b.createdAt || 0) -
        Number(a.updatedAt || a.createdAt || 0)
    );

  return campaigns[0]?.channelId || "";
}

function getCharacter(guildId, userId, channelId = "") {
  if (channelId) {
    const scopedKey = characterStorageKey(
      guildId,
      channelId,
      userId
    );

    const scoped = data.characters[scopedKey] || null;
    if (scoped) {
      return normalizeLoadedCharacter(scoped, channelId);
    }

    const legacyKey = legacyCharacterStorageKey(guildId, userId);
    const legacy = data.characters[legacyKey] || null;

    if (legacy) {
      const inferredChannel =
        legacy.channelId ||
        inferLegacyCharacterChannel(guildId, userId);

      if (
        inferredChannel &&
        inferredChannel !== channelId
      ) {
        return null;
      }

      legacy.channelId = channelId;
      data.characters[scopedKey] = legacy;
      delete data.characters[legacyKey];
      saveDataSoon();

      return normalizeLoadedCharacter(legacy, channelId);
    }

    return null;
  }

  const matches = Object.values(data.characters).filter(
    (character) =>
      character?.guildId === guildId &&
      character?.userId === userId
  );

  if (matches.length === 1) {
    return normalizeLoadedCharacter(
      matches[0],
      matches[0].channelId || ""
    );
  }

  const legacy =
    data.characters[
      legacyCharacterStorageKey(guildId, userId)
    ] || null;

  return legacy
    ? normalizeLoadedCharacter(legacy, legacy.channelId || "")
    : null;
}

function setCharacter(
  guildId,
  userId,
  channelId,
  character
) {
  if (
    character === undefined &&
    channelId &&
    typeof channelId === "object"
  ) {
    character = channelId;
    channelId = character.channelId || "";
  }

  if (!channelId) {
    throw new Error(
      "setCharacter requires a Discord channelId."
    );
  }

  character.guildId = guildId;
  character.userId = userId;
  character.channelId = channelId;

  data.characters[
    characterStorageKey(guildId, channelId, userId)
  ] = character;

  saveDataSoon();
}

function resolvePartyChannel(party) {
  if (!party) return "";
  if (party.channelId) return party.channelId;

  const campaign = Object.values(data.campaigns)
    .filter(
      (item) =>
        item.partyId === party.id &&
        item.channelId
    )
    .sort(
      (a, b) =>
        Number(b.updatedAt || b.createdAt || 0) -
        Number(a.updatedAt || a.createdAt || 0)
    )[0];

  if (campaign?.channelId) {
    party.channelId = campaign.channelId;
    saveDataSoon();
  }

  return party.channelId || "";
}

function getPartyByMember(
  guildId,
  userId,
  channelId = ""
) {
  const matches = Object.values(data.parties).filter(
    (party) =>
      party.guildId === guildId &&
      party.memberIds?.includes(userId)
  );

  if (channelId) {
    const exact =
      matches.find(
        (party) =>
          resolvePartyChannel(party) === channelId
      ) || null;

    if (exact) return exact;

    // Legacy parties created before channel binding can be adopted by the
    // first channel where their existing member uses them.
    const unassigned = matches.filter(
      (party) => !resolvePartyChannel(party)
    );

    if (unassigned.length === 1) {
      unassigned[0].channelId = channelId;
      saveDataSoon();
      return unassigned[0];
    }

    return null;
  }

  return matches.length === 1 ? matches[0] : null;
}

function getPartyByCode(
  guildId,
  code,
  channelId = ""
) {
  const upper = String(code || "").toUpperCase();

  const matches = Object.values(data.parties).filter(
    (party) =>
      party.guildId === guildId &&
      party.code === upper
  );

  if (!channelId) return matches[0] || null;

  const exact =
    matches.find(
      (party) =>
        resolvePartyChannel(party) === channelId
    ) || null;

  if (exact) return exact;

  const unassigned = matches.filter(
    (party) => !resolvePartyChannel(party)
  );

  if (unassigned.length === 1) {
    unassigned[0].channelId = channelId;
    saveDataSoon();
    return unassigned[0];
  }

  return null;
}

function getCharactersForUser(guildId, userId) {
  return Object.values(data.characters)
    .filter(
      (character) =>
        character?.guildId === guildId &&
        character?.userId === userId
    )
    .sort(
      (a, b) =>
        Number(b.updatedAt || b.createdAt || 0) -
        Number(a.updatedAt || a.createdAt || 0)
    );
}

function getActiveCampaignForChannel(guildId, channelId) {
  const campaign =
    Object.values(data.campaigns).find(
      (c) =>
        c.guildId === guildId &&
        c.channelId === channelId &&
        c.status === "active"
    ) || null;

  if (campaign) normalizeCampaignPacing(campaign);
  return campaign;
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
        name: "⭐ Progress",
        value: progressionSummary(character),
        inline: true,
      },
      {
        name: "🎯 Proficiency",
        value: `+${proficiencyBonusForLevel(character.level)}`,
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
      const c = getCharacter(party.guildId, userId, resolvePartyChannel(party));
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
      const c = getCharacter(party.guildId, userId, resolvePartyChannel(party));
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
  const party = getPartyByMember(interaction.guildId, interaction.user.id, interaction.channelId);
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
  const character = getCharacter(interaction.guildId, interaction.user.id, interaction.channelId);

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
// ADVANTAGE / DISADVANTAGE
// ============================================================

function normalizeRollMode(mode) {
  const value = String(mode || "normal").toLowerCase();
  return ["normal", "advantage", "disadvantage"].includes(value)
    ? value
    : "normal";
}

function rollModeEmoji(mode) {
  const value = normalizeRollMode(mode);
  if (value === "advantage") return "🟢";
  if (value === "disadvantage") return "🔴";
  return "⚪";
}

function rollModeLabel(mode) {
  const value = normalizeRollMode(mode);
  if (value === "advantage") return "ADVANTAGE";
  if (value === "disadvantage") return "DISADVANTAGE";
  return "NORMAL";
}

function rollModeInstruction(mode) {
  const value = normalizeRollMode(mode);
  if (value === "advantage") return "Roll 2d20 and keep the HIGHER result.";
  if (value === "disadvantage") return "Roll 2d20 and keep the LOWER result.";
  return "Roll 1d20.";
}

function resolveD20ModeRoll(mode, suppliedRolls = null) {
  const value = normalizeRollMode(mode);
  const needed = value === "normal" ? 1 : 2;

  const rolls = Array.isArray(suppliedRolls)
    ? suppliedRolls
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 20)
        .slice(0, needed)
    : Array.from(
        { length: needed },
        () => 1 + Math.floor(Math.random() * 20)
      );

  if (rolls.length !== needed) return null;

  const kept =
    value === "advantage"
      ? Math.max(...rolls)
      : value === "disadvantage"
        ? Math.min(...rolls)
        : rolls[0];

  return { mode: value, rolls, kept };
}

function formatD20ModeResult(result) {
  if (result.mode === "normal") {
    return `🎲 Roll: **${result.kept}**`;
  }

  const target =
    result.mode === "advantage"
      ? Math.max(...result.rolls)
      : Math.min(...result.rolls);

  let marked = false;
  const shown = result.rolls.map((value) => {
    if (!marked && value === target) {
      marked = true;
      return `**${value} ← kept**`;
    }

    return String(value);
  });

  return (
    `${rollModeEmoji(result.mode)} **${rollModeLabel(result.mode)}**\n` +
    `🎲 Rolls: ${shown.join(" • ")}`
  );
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
- Every requested d20 check MUST choose roll_mode: "normal", "advantage", or "disadvantage".
- Advantage requires a meaningful favorable circumstance such as effective help, superior positioning, surprise, or a relevant feature.
- Disadvantage requires a meaningful hindrance such as poor visibility, awkward positioning, a harmful condition, or a similar obstacle.
- Difficulty alone does NOT create disadvantage; represent ordinary difficulty with the DC.
- If advantage and disadvantage both apply, they cancel and roll_mode must be "normal".
- Use DCs roughly:
  8 easy, 10 routine, 12 moderate, 14 challenging, 16 hard, 18 very hard, 20+ exceptional.
- Do not reveal the numeric DC in narration.
- A player should not roll for trivial actions.
- A failed check should move the story forward with a consequence, complication, cost, or lost opportunity.
- Never claim a player succeeded or failed before the bot resolves the roll.
- Never reveal a character's private secret unless story events have actually exposed it.
- Weave player goals, fears, quirks, backgrounds, and secrets into the campaign gradually.
- Keep content appropriate for a general Discord gaming server.


PACING / DOWNTIME:
- Do NOT run the campaign as nonstop danger, reveals, and urgent objectives.
- After roughly 3 substantial action beats, if there is no immediate unresolved danger, deliberately create a downtime/social beat.
- Downtime can be a campfire, inn, meal, watch shift, safe room, journey pause, morning after a rest, shopping period, quiet travel, or simply a moment after danger.
- During downtime, explicitly give the player characters room to talk to one another. Do not fill every silence with NPC dialogue.
- Do not immediately interrupt downtime with a new attack, alarm, explosion, prophecy, chase, or quest hook.
- If the party chooses to sleep and the location is reasonably safe, let them sleep.
- If downtimeActive is true in the supplied pacing state, preserve the calm scene until the players clearly choose to leave it or seek danger.
- Use scene_mode "downtime" when you intentionally create or preserve such a scene.

COMBAT:
- You may start combat only when hostilities genuinely break out.
- To start combat, return action_type "combat_start".
- For combat_start, supply a concise enemy name, enemy archetype, and count.
- Enemy archetypes: minion, skirmisher, brute, caster, boss.
- The APPLICATION CODE owns enemy AC, HP, initiative, attacks, damage, player HP, and turn order.
- Do not narrate numerical combat outcomes that the code has not resolved.
- When combat is active, the dedicated combat engine handles turns.

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
    action_type: { type: "string", enum: ["none", "check", "combat_start"] },
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
    roll_mode: {
      type: "string",
      enum: ["normal", "advantage", "disadvantage"],
    },
    dc: { type: "integer", minimum: 0, maximum: 30 },
    roll_reason: { type: "string" },
    consequences_success: { type: "string" },
    consequences_failure: { type: "string" },
    scene_mode: {
      type: "string",
      enum: ["action", "downtime", "social", "travel", "combat"],
    },
    combat_enemy_name: { type: "string" },
    combat_enemy_archetype: {
      type: "string",
      enum: ["none", "minion", "skirmisher", "brute", "caster", "boss"],
    },
    combat_enemy_count: { type: "integer", minimum: 0, maximum: 6 },
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
    "roll_mode",
    "dc",
    "roll_reason",
    "consequences_success",
    "consequences_failure",
    "scene_mode",
    "combat_enemy_name",
    "combat_enemy_archetype",
    "combat_enemy_count",
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
      roll_mode: "normal",
      dc: 0,
      roll_reason: "",
      consequences_success: "",
      consequences_failure: "",
      scene_mode: "action",
      combat_enemy_name: "",
      combat_enemy_archetype: "none",
      combat_enemy_count: 0,
      image_type: "none",
      image_prompt: "",
    };
  }

  const characters = partyMembersContext(party);
  const actingCharacter = getCharacter(campaign.guildId, actingUserId, campaign.channelId);

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
    scene_mode: {
      type: "string",
      enum: ["action", "downtime", "social", "travel", "combat"],
    },
    image_type: {
      type: "string",
      enum: ["none", "location", "npc", "monster", "discovery", "cinematic"],
    },
    image_prompt: { type: "string" },
  },
  required: ["narration", "scene_mode", "image_type", "image_prompt"],
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
      scene_mode: "action",
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
      pacing: campaignPacingContext(campaign),
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
        "Narrate the resolved result. Respect the exact success/failure outcome. Do not request another check in this response. " +
        "If pacing.downtimeStronglyDue is true and immediate danger has ended, transition into genuine downtime instead of creating another urgent problem. " +
        "If pacing.downtimeActive is already true, preserve the calm unless this check clearly ends it. " +
        "Only request an image if this resolved check causes a genuinely major reveal.",
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
  const playerBackstory = String(draft.backstoryText || "").trim();
  const backstoryMode = draft.backstoryMode || "ai";

  if (!openai) {
    if (backstoryMode === "custom" && playerBackstory) {
      return {
        backstory: playerBackstory,
        secret:
          "You possess a strange old token whose origin you cannot explain. It sometimes grows warm near ancient magic.",
      };
    }

    return {
      backstory:
        `${draft.name} became an adventurer after leaving behind a life as a ${draft.background.toLowerCase()}. ` +
        `${playerBackstory ? `Their story began with this idea: ${playerBackstory}. ` : ""}` +
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

  const instructions =
    backstoryMode === "custom"
      ? `
You are helping finalize a fantasy tabletop RPG character.

The player has written their OWN backstory.
RULES:
- Preserve the player's backstory faithfully.
- Do NOT rewrite, replace, contradict, shorten, or embellish their backstory.
- Return their supplied backstory as the backstory field.
- Create one private secret in 1-3 sentences that fits naturally with the supplied character and backstory.
- The secret is a future story hook, not a mechanical advantage.
- Do not decide future plot outcomes.
- Keep the secret suitable for a general gaming community.
`
      : `
You create concise fantasy RPG character hooks for a Discord campaign.

The player has supplied a GENERAL BACKSTORY IDEA rather than a finished story.
RULES:
- Write a polished 120-200 word fantasy backstory.
- Use the player's supplied backstory idea as the foundation.
- Incorporate the character's ancestry, class, background, goal, fear, and personality quirk naturally.
- Do not erase or contradict details the player supplied.
- Give the character at least one meaningful past relationship, place, event, or unresolved thread the DM can reference later.
- Do not decide future plot outcomes.
- Then create one private secret in 1-3 sentences.
- The secret should be a future story hook, not a mechanical advantage.
- Keep it suitable for a general gaming community.
`;

  const response = await openai.responses.create({
    model: OPENAI_MODEL,
    instructions,
    input: JSON.stringify(
      {
        name: draft.name,
        ancestry: draft.ancestry,
        className: draft.className,
        background: draft.background,
        appearance: draft.appearance,
        goal: draft.goal,
        fear: draft.fear,
        quirk: draft.quirk,
        backstoryMode,
        playerBackstoryOrIdea: playerBackstory,
      },
      null,
      2
    ),
    text: {
      format: {
        type: "json_schema",
        name: "character_story",
        strict: true,
        schema,
      },
    },
  });

  const story = JSON.parse(response.output_text);

  // Custom mode is player-owned text. Even if the model tries to alter it,
  // the application code keeps the player's exact backstory.
  if (backstoryMode === "custom" && playerBackstory) {
    story.backstory = playerBackstory;
  }

  return story;
}

// ============================================================
// CHARACTER CREATION
// ============================================================

const creationSessions = new Map();

function sessionKey(guildId, channelId, userId) {
  return `${guildId}:${channelId}:${userId}`;
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

function createBackstoryModeMenu(userId) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`cc_backstory:${userId}`)
    .setPlaceholder("How would you like to create your backstory?")
    .addOptions([
      {
        label: "I already have my backstory",
        value: "custom",
        emoji: "📖",
        description: "Type your own backstory exactly as you want it saved.",
      },
      {
        label: "Build one from my idea",
        value: "ai",
        emoji: "✨",
        description: "Give the AI a general idea and it will write the full backstory.",
      },
    ]);

  return new ActionRowBuilder().addComponents(menu);
}

function createCustomBackstoryModal(userId) {
  const modal = new ModalBuilder()
    .setCustomId(`cc_backstory_custom:${userId}`)
    .setTitle("Write Your Backstory");

  const backstory = new TextInputBuilder()
    .setCustomId("backstory")
    .setLabel("Your character's backstory")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(20)
    .setMaxLength(3000)
    .setPlaceholder(
      "Paste or write your character's backstory here. The bot will save it exactly as you write it."
    );

  modal.addComponents(
    new ActionRowBuilder().addComponents(backstory)
  );

  return modal;
}

function createAIBackstoryIdeaModal(userId) {
  const modal = new ModalBuilder()
    .setCustomId(`cc_backstory_ai:${userId}`)
    .setTitle("Create My Backstory");

  const idea = new TextInputBuilder()
    .setCustomId("backstory_idea")
    .setLabel("Give the AI your general backstory idea")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(1000)
    .setPlaceholder(
      "Example: I grew up in a ruined mining town, and my brother vanished beneath the mountain."
    );

  modal.addComponents(
    new ActionRowBuilder().addComponents(idea)
  );

  return modal;
}

async function startCharacterCreation(interaction) {
  const existing = getCharacter(interaction.guildId, interaction.user.id, interaction.channelId);

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
    channelId: interaction.channelId,
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
    backstoryMode: null,
    backstoryText: "",
  };

  creationSessions.set(sessionKey(interaction.guildId, interaction.channelId, interaction.user.id), draft);

  await interaction.reply({
    ephemeral: true,
    content:
      `🧙 **Creating ${draft.name}**\n\n` +
      `**Step 1/6 — Choose your ancestry.**`,
    components: [createAncestryMenu(interaction.user.id)],
  });
}

async function finalizeCharacterCreation(interaction, draft, key) {
  await interaction.reply({
    ephemeral: true,
    content:
      draft.backstoryMode === "custom"
        ? `✨ **Finishing ${draft.name}...**\nSaving your backstory and creating your private character secret.`
        : `✨ **Finishing ${draft.name}...**\nThe AI is writing your backstory and creating your private character secret.`,
  });

  try {
    const story = await aiCharacterStory(draft);
    const classData = CLASS_DATA[draft.className];
    const stats = statsForClass(draft.className, draft.statStyle);
    const inventory = [...classData.loadouts[draft.loadout]];

    const character = {
      id: uid(),
      guildId: interaction.guildId,
      channelId: interaction.channelId,
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
      backstorySource: draft.backstoryMode === "custom" ? "player" : "ai",
      backstoryIdea:
        draft.backstoryMode === "ai"
          ? draft.backstoryText
          : "",
      statStyle: draft.statStyle,
      stats,
      level: 1,
      xp: 0,
      levelUpHistory: [],
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

    setCharacter(
      interaction.guildId,
      interaction.user.id,
      interaction.channelId,
      character
    );

    creationSessions.delete(key);

    await interaction.followUp({
      ephemeral: true,
      content:
        character.backstorySource === "player"
          ? "📖 **Your backstory was saved exactly as you wrote it.**"
          : "✨ **The AI created your backstory from your idea.**",
      embeds: [
        makeCharacterEmbed(
          character,
          interaction.user.username
        ),
      ],
    });

    const secretEmbed = new EmbedBuilder()
      .setTitle(`🔒 ${character.name}'s Private Secret`)
      .setDescription(character.secret)
      .setFooter({
        text:
          "The AI DM knows this. Other players do not.",
      });

    await interaction.followUp({
      ephemeral: true,
      embeds: [secretEmbed],
    });
  } catch (err) {
    console.error("Character finalization error:", err);

    await interaction.followUp({
      ephemeral: true,
      content:
        "❌ I couldn't finish the character. Your creation session is still available; try submitting the backstory again.",
    });
  }
}

async function handleCharacterBackstoryModal(interaction) {
  // Modal IDs are:
  //   cc_backstory_custom:<userId>
  //   cc_backstory_ai:<userId>
  //
  // v1.7 incorrectly split these IDs as if they were
  // "cc_backstory:<mode>:<userId>", which made BOTH backstory
  // options fail the owner/mode check.
  const [modalId, ownerId] = interaction.customId.split(":");

  let mode = null;

  if (modalId === "cc_backstory_custom") {
    mode = "custom";
  } else if (modalId === "cc_backstory_ai") {
    mode = "ai";
  }

  if (!mode || interaction.user.id !== ownerId) {
    return interaction.reply({
      ephemeral: true,
      content:
        "⚠️ I couldn't match this backstory form to your character-creation session. Please run `/createcharacter` again.",
    });
  }

  const key = sessionKey(
    interaction.guildId,
    interaction.user.id
  );

  const draft = creationSessions.get(key);

  if (!draft) {
    return interaction.reply({
      ephemeral: true,
      content:
        "⚠️ This character-creation session expired. Run `/createcharacter` again.",
    });
  }

  if (!draft.loadout) {
    return interaction.reply({
      ephemeral: true,
      content:
        "⚠️ Finish the earlier character-creation steps first.",
    });
  }

  if (mode === "custom") {
    draft.backstoryMode = "custom";
    draft.backstoryText = interaction.fields
      .getTextInputValue("backstory")
      .trim();
  } else if (mode === "ai") {
    draft.backstoryMode = "ai";
    draft.backstoryText = interaction.fields
      .getTextInputValue("backstory_idea")
      .trim();
  } else {
    return interaction.reply({
      ephemeral: true,
      content: "⚠️ Unknown backstory option.",
    });
  }

  creationSessions.set(key, draft);

  return finalizeCharacterCreation(
    interaction,
    draft,
    key
  );
}

async function handleCharacterSelect(interaction) {
  const [kind, ownerId] = interaction.customId.split(":");
  if (interaction.user.id !== ownerId) {
    return interaction.reply({
      ephemeral: true,
      content: "That character creator belongs to another player.",
    });
  }

  const key = sessionKey(interaction.guildId, interaction.channelId, interaction.user.id);
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
        `**Step 2/6 — Choose your class.**`,
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
        `**Step 3/6 — Choose your background.**`,
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
        `**Step 4/6 — Choose how your stats are assigned.**`,
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
        `**Step 5/6 — Choose your starting loadout.**`,
      components: [createLoadoutMenu(interaction.user.id, draft.className)],
    });
  }

  if (kind === "cc_loadout") {
    draft.loadout = value;
    creationSessions.set(key, draft);

    return interaction.update({
      content:
        `🧙 **Creating ${draft.name}**\n\n` +
        `✅ Ancestry: **${draft.ancestry}**\n` +
        `✅ Class: **${draft.className}**\n` +
        `✅ Background: **${draft.background}**\n` +
        `✅ Stats: **${draft.statStyle}**\n` +
        `✅ Loadout: **${draft.loadout}**\n\n` +
        `**Step 6/6 — Create your backstory.**\n\n` +
        `📖 **Already have one?** Type it yourself and it will be saved exactly as written.\n` +
        `✨ **Need help?** Give the AI a general idea and it will turn it into a full character backstory.`,
      components: [
        createBackstoryModeMenu(interaction.user.id),
      ],
    });
  }

  if (kind === "cc_backstory") {
    draft.backstoryMode = value;
    creationSessions.set(key, draft);

    if (value === "custom") {
      try {
        return await interaction.showModal(
          createCustomBackstoryModal(
            interaction.user.id
          )
        );
      } catch (err) {
        console.error("Custom backstory modal open error:", err);

        if (!interaction.replied && !interaction.deferred) {
          return interaction.reply({
            ephemeral: true,
            content:
              "❌ I couldn't open the custom backstory form. Please try selecting **I already have my backstory** again.",
          });
        }

        throw err;
      }
    }

    try {
      return await interaction.showModal(
        createAIBackstoryIdeaModal(
          interaction.user.id
        )
      );
    } catch (err) {
      console.error("AI backstory modal open error:", err);

      if (!interaction.replied && !interaction.deferred) {
        return interaction.reply({
          ephemeral: true,
          content:
            "❌ I couldn't open the AI backstory form. Please try selecting **Build one from my idea** again.",
        });
      }

      throw err;
    }
  }
}

// ============================================================
// PARTY SYSTEM
// ============================================================

function partyEmbed(party) {
  const members = party.memberIds
    .map((id) => {
      const c = getCharacter(party.guildId, id, resolvePartyChannel(party));
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
    const character = getCharacter(guildId, userId, interaction.channelId);
    if (!character) {
      return interaction.reply({
        ephemeral: true,
        content: "Create a character first with `/createcharacter`.",
      });
    }

    if (getPartyByMember(guildId, userId, interaction.channelId)) {
      return interaction.reply({
        ephemeral: true,
        content: "You're already in a party. Leave it before creating another.",
      });
    }

    const party = {
      id: uid(),
      guildId,
      channelId: interaction.channelId,
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
    const character = getCharacter(guildId, userId, interaction.channelId);
    if (!character) {
      return interaction.reply({
        ephemeral: true,
        content: "Create a character first with `/createcharacter`.",
      });
    }

    if (getPartyByMember(guildId, userId, interaction.channelId)) {
      return interaction.reply({
        ephemeral: true,
        content: "You're already in a party.",
      });
    }

    const code = interaction.options.getString("code");
    const party = getPartyByCode(guildId, code, interaction.channelId);

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
    const party = getPartyByMember(guildId, userId, interaction.channelId);
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
    const party = getPartyByMember(guildId, userId, interaction.channelId);
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
  const party = getPartyByMember(guildId, userId, interaction.channelId);

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
    party.channelId = interaction.channelId;
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
      pacing: {
        actionBeats: 0,
        downtimeActive: false,
        lastDowntimeAt: 0,
        lastCombatAt: 0,
      },
      combat: {
        active: false,
      },
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

    if (campaign.channelId !== interaction.channelId) {
      return interaction.reply({
        ephemeral: true,
        content:
          `This saved adventure belongs to <#${campaign.channelId}>. ` +
          "Use `/adventure continue` in that channel so each campaign keeps its own character roster.",
      });
    }

    campaign.status = "active";
    campaign.pendingChecks ||= {};
    normalizeCampaignPacing(campaign);
    campaign.combat ||= { active: false };
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

    const completionXP = CAMPAIGN_COMPLETION_XP[campaign.mode] || 250;
    campaign.completionXPAwarded = true;

    const completionResults = party.memberIds
      .map((memberId) => {
        const memberCharacter = getCharacter(guildId, memberId, campaign.channelId);
        if (!memberCharacter) return null;

        return {
          memberId,
          character: memberCharacter,
          progression: awardCharacterXP(
            memberCharacter,
            completionXP,
            `${modeLabel(campaign.mode)} completed`
          ),
        };
      })
      .filter(Boolean);

    saveDataSoon();

    await interaction.reply({
      content:
        `🏁 **${campaign.title} has ended.**\n` +
        `⭐ Every participating character earned **${completionXP} XP** for completing the adventure.`,
    });

    for (const result of completionResults) {
      if (result.progression.levelUps.length) {
        await interaction.channel.send({
          embeds: [levelUpEmbed(result.character, result.progression)],
        });
      }
    }

    return;
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
  const character = getCharacter(message.guildId, message.author.id, message.channelId);
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
        rollMode: normalizeRollMode(result.roll_mode),
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
          },
          {
            name: "Roll Mode",
            value:
              `${rollModeEmoji(campaign.pendingChecks[message.author.id].rollMode)} **${rollModeLabel(campaign.pendingChecks[message.author.id].rollMode)}**
` +
              rollModeInstruction(campaign.pendingChecks[message.author.id].rollMode),
            inline: false,
          }
        )
        .setFooter({
          text: "Use the 3D Dice button below, or /roll as a fallback. The DC is hidden.",
        });

      await message.channel.send({
        embeds: [checkEmbed],
        components: [make3DDiceButton(campaign.pendingChecks[message.author.id])],
      });
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
  const character = getCharacter(guildId, userId, interaction.channelId);

  if (!character) {
    return interaction.reply({
      ephemeral: true,
      content: "Create a character first with `/createcharacter`.",
    });
  }

  const customDice = interaction.options.getString("dice");
  const party = getPartyByMember(guildId, userId, interaction.channelId);

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

  const diceExpression = pending.dice || "1d20";

  if (diceExpression !== "1d20") {
    return interaction.reply({
      ephemeral: true,
      content:
        "⚠️ This pending check is not a d20 check, so it cannot use advantage/disadvantage yet.",
    });
  }

  const modeResult = resolveD20ModeRoll(pending.rollMode);

  if (!modeResult) {
    return interaction.reply({
      ephemeral: true,
      content:
        "⚠️ The roll mode is invalid. Your pending check was **not** consumed.",
    });
  }

  const modifier = character.stats[pending.ability] || 0;
  const naturalRoll = modeResult.kept;
  const total = naturalRoll + modifier;
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
    rollMode: modeResult.mode,
    rolls: modeResult.rolls,
    naturalRoll,
    modifier,
    total,
    outcome,
  };

  appendLog(campaign, rollRecord);

  const xpAmount =
    pending.noCheckXP
      ? 0
      : outcome === "SUCCESS"
        ? 10 + (naturalRoll === 20 ? 5 : 0)
        : 0;

  const xpProgression = awardCharacterXP(
    character,
    xpAmount,
    naturalRoll === 20
      ? `${pending.checkName} success + Natural 20`
      : `${pending.checkName} success`
  );

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
      `${formatD20ModeResult(modeResult)}\n` +
      `${pending.ability}: **${formatModifier(modifier)}**\n` +
      `Total: **${total}**${natText}\n\n` +
      `${resultEmoji} **${outcome}**` +
      (xpProgression.gained
        ? `\n⭐ **+${xpProgression.gained} XP**`
        : ""),
  });

  if (xpProgression.levelUps.length) {
    await interaction.channel.send({
      embeds: [levelUpEmbed(character, xpProgression)],
    });
  }

  if (pending.combatAttack) {
    await resolveCombatAttackAfterRoll({
      interaction,
      campaign,
      party,
      character,
      pending,
      naturalRoll,
      outcome,
    });
    return;
  }

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

    recordScenePacing(
      campaign,
      resolved.scene_mode || "action"
    );

    if (resolved.scene_mode === "downtime") {
      await sendDowntimeBanner(
        interaction.channel,
        campaign,
        "That moment of tension passes, leaving the party some breathing room."
      );
    }
  } catch (err) {
    console.error("Resolve-check narration error:", err);
    await interaction.followUp(
      "⚠️ The roll was saved correctly, but the Dungeon Master's follow-up narration failed."
    );
  }

  // Any actions declared by other party members while this roll was pending
  // may now begin their normal 20-second multiplayer window.
  resumePartyWindowAfterRoll(campaign);
}

// ============================================================
// LEVEL / PROGRESSION
// ============================================================

async function handleLevelCommand(interaction) {
  const character = getCharacter(interaction.guildId, interaction.user.id, interaction.channelId);

  if (!character) {
    return interaction.reply({
      ephemeral: true,
      content: "Create a character first with `/createcharacter`.",
    });
  }

  const nextXP = xpForNextLevel(character.level);
  const proficiency = proficiencyBonusForLevel(character.level);

  const embed = new EmbedBuilder()
    .setTitle(`⭐ ${character.name} — Character Progression`)
    .setDescription(progressionSummary(character))
    .addFields(
      {
        name: "Current Level",
        value: `${character.level}`,
        inline: true,
      },
      {
        name: "Proficiency Bonus",
        value: `+${proficiency}`,
        inline: true,
      },
      {
        name: "Maximum HP",
        value: `${character.maxHp}`,
        inline: true,
      },
      {
        name: "How XP Is Earned",
        value:
          "✅ Successful DM-requested check: **10 XP**\\n" +
          "🌟 Successful Natural 20: **+5 bonus XP**\\n" +
          "🏁 Finish One-Shot: **150 XP**\\n" +
          "⚔️ Finish Adventure: **250 XP**\\n" +
          "🏰 Finish Quest: **400 XP**\\n" +
          "🐉 Finish Campaign: **500 XP**",
      }
    );

  if (nextXP) {
    embed.addFields({
      name: "Next Level",
      value:
        `Level ${character.level + 1} at **${nextXP.toLocaleString()} XP**\\n` +
        `${Math.max(0, nextXP - character.xp).toLocaleString()} XP remaining`,
    });
  } else {
    embed.addFields({
      name: "Next Level",
      value: "🏆 **MAX LEVEL REACHED**",
    });
  }

  return interaction.reply({
    ephemeral: true,
    embeds: [embed],
  });
}

// ============================================================
// ASK THE DM — OUT-OF-GAME QUESTIONS
// ============================================================

const ASK_DM_INSTRUCTIONS = `
You are the same Dungeon Master who runs this player's Discord D&D adventure,
but this is an OUT-OF-GAME question.

RULES:
- Answer the player's question directly and helpfully.
- Do NOT advance the story.
- Do NOT narrate new events as if they happened.
- Do NOT request or resolve dice rolls.
- Do NOT alter HP, XP, inventory, gold, abilities, campaign state, NPC state, or quests.
- You may explain rules, the player's character sheet, known campaign lore,
  what the player currently remembers/knows, or how a mechanic works.
- You may give strategic options, but never choose an action for the player.
- If the question asks for information their character has not learned, explain
  that you cannot reveal undiscovered campaign information.
- Private character information may be discussed because this response is
  ephemeral and visible only to the asking player.
- Keep answers concise and Discord-friendly.
`;

async function aiAnswerOutOfGameQuestion({
  character,
  party,
  campaign,
  question,
}) {
  if (!openai) {
    return "⚠️ The AI Dungeon Master is not configured.";
  }

  const input = JSON.stringify(
    {
      playerCharacter: character
        ? {
            name: character.name,
            ancestry: character.ancestry,
            className: character.className,
            level: character.level,
            xp: character.xp,
            hp: character.hp,
            maxHp: character.maxHp,
            ac: character.ac,
            stats: character.stats,
            background: character.background,
            goal: character.goal,
            fear: character.fear,
            quirk: character.quirk,
            backstory: character.backstory,
            secret: character.secret,
            inventory: character.inventory,
            abilities: character.abilities,
            spells: character.spells || [],
          }
        : null,
      campaign: campaign
        ? {
            title: campaign.title,
            mode: campaign.mode,
            chapter: campaign.chapter,
            location: campaign.location,
            summary: campaign.summary,
            recentHistory: recentCampaignContext(campaign, 20),
          }
        : null,
      party: party ? partyMembersContext(party) : [],
      question,
      request:
        "Answer this as an out-of-game DM conversation. Do not modify or advance game state.",
    },
    null,
    2
  );

  const response = await openai.responses.create({
    model: OPENAI_MODEL,
    instructions: ASK_DM_INSTRUCTIONS,
    input,
  });

  return response.output_text.trim();
}

async function handleAskDMCommand(interaction) {
  const question = interaction.options.getString("question", true).trim();

  if (!question) {
    return interaction.reply({
      ephemeral: true,
      content: "Ask the DM a question.",
    });
  }

  const character = getCharacter(interaction.guildId, interaction.user.id, interaction.channelId);
  const party = getPartyByMember(interaction.guildId, interaction.user.id, interaction.channelId);
  const campaign = party ? getCampaignForParty(party.id) : null;

  await interaction.deferReply({ ephemeral: true });

  try {
    const answer = await aiAnswerOutOfGameQuestion({
      character,
      party,
      campaign,
      question,
    });

    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("🎭 Ask the Dungeon Master")
          .setDescription(truncate(answer, 4000))
          .setFooter({
            text:
              "Out-of-game answer • Does not advance the story or change game state",
          }),
      ],
    });
  } catch (err) {
    console.error("/askdm error:", err);
    return interaction.editReply(
      "❌ The Dungeon Master couldn't answer that question right now. Check the Railway logs."
    );
  }
}

// ============================================================
// RECAP
// ============================================================

async function handleRecap(interaction) {
  const party = getPartyByMember(interaction.guildId, interaction.user.id, interaction.channelId);

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
    .setName("characters")
    .setDescription("List all of your channel-specific characters in this server."),

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
    .setName("abilities")
    .setDescription("View your class abilities and remaining uses."),

  new SlashCommandBuilder()
    .setName("useability")
    .setDescription("Use one of your active class abilities.")
    .addStringOption((o) =>
      o.setName("ability").setDescription("Exact ability name from /abilities").setRequired(true).setMaxLength(60)
    )
    .addStringOption((o) =>
      o.setName("target").setDescription("Optional enemy, ally, or position target").setRequired(false).setMaxLength(80)
    ),

  new SlashCommandBuilder()
    .setName("position")
    .setDescription("Set your Frontline, Midline, or Backline combat position.")
    .addStringOption((o) =>
      o.setName("position").setDescription("Combat distance band").setRequired(true).addChoices(
        { name: "🛡️ Frontline", value: "frontline" },
        { name: "⚔️ Midline", value: "midline" },
        { name: "🏹 Backline", value: "backline" }
      )
    ),

  new SlashCommandBuilder()
    .setName("ready")
    .setDescription("Mark your current party action as ready for the DM."),

  new SlashCommandBuilder()
    .setName("rest")
    .setDescription("Take a short or long rest during safe downtime.")
    .addStringOption((o) =>
      o
        .setName("type")
        .setDescription("Rest type")
        .setRequired(true)
        .addChoices(
          { name: "🔥 Short Rest", value: "short" },
          { name: "🌙 Long Rest", value: "long" }
        )
    ),

  new SlashCommandBuilder()
    .setName("combat")
    .setDescription("View the current combat encounter.")
    .addSubcommand((s) =>
      s.setName("status").setDescription("Show combatants, HP, and current turn.")
    ),

  new SlashCommandBuilder()
    .setName("level")
    .setDescription("View your level, XP, and progression."),

  new SlashCommandBuilder()
    .setName("askdm")
    .setDescription("Ask the Dungeon Master an out-of-game question privately.")
    .addStringOption((o) =>
      o
        .setName("question")
        .setDescription("Your question for the DM")
        .setRequired(true)
        .setMaxLength(1000)
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

        case "characters": {
          const characters = getCharactersForUser(
            interaction.guildId,
            interaction.user.id
          );

          if (!characters.length) {
            return interaction.reply({
              ephemeral: true,
              content:
                "You don't have any characters yet. Use `/createcharacter` in the channel where you want to play.",
            });
          }

          const description = characters
            .map((character) => {
              const channelText = character.channelId
                ? `<#${character.channelId}>`
                : "Legacy / unassigned channel";

              return (
                `**${character.name}** — Lv.${character.level} ${character.ancestry} ${character.className}\n` +
                `${channelText}`
              );
            })
            .join("\n\n");

          return interaction.reply({
            ephemeral: true,
            embeds: [
              new EmbedBuilder()
                .setTitle("🧙 Your Characters")
                .setDescription(description)
                .setFooter({
                  text:
                    "Each Discord channel has its own character slot.",
                }),
            ],
          });
        }

        case "character": {
          const target = interaction.options.getUser("player") || interaction.user;
          const character = getCharacter(interaction.guildId, target.id, interaction.channelId);

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
          const character = getCharacter(interaction.guildId, interaction.user.id, interaction.channelId);
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

        case "abilities":
          return handleAbilitiesCommand(interaction);

        case "useability":
          return handleUseAbilityCommand(interaction);

        case "position":
          return handlePositionCommand(interaction);

        case "ready":
          return handleReadyCommand(interaction);

        case "rest":
          return handleRestCommand(interaction);

        case "combat":
          return handleCombatStatus(interaction);

        case "level":
          return handleLevelCommand(interaction);

        case "askdm":
          return handleAskDMCommand(interaction);

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
                  "**1.** `/createcharacter` — Build the adventurer for THIS channel. You can have a different character in every D&D channel. Use `/characters` to see them all.\n" +
                  "**2.** `/party create` — Make a party and share its code.\n" +
                  "**3.** Friends use `/party join`.\n" +
                  "**4.** Party leader uses `/adventure start`.\n" +
                  "**5.** Talk normally in the adventure channel. The DM waits **20 seconds after the latest party message** so friends can declare actions together.\n" +
                  "**6.** `/ready` marks your current action ready. If every participating player is ready, the DM responds immediately.\n" +
                  "**7.** When the DM requests a check or combat attack, **`/roll` is the reliable roll command**. The 3D Dice button remains experimental.\n" +
                  "**8.** Combat uses initiative. On your turn, describe your action normally; enemies take turns automatically. `/combat status` shows the encounter.\n" +
                  "**9.** The DM now creates downtime after stretches of action. Use `/rest short` or `/rest long` when the party is safe.\n" +
                  "**10.** `/character`, `/inventory`, `/recap`, and `/adventure status` show saved information.\n" +
                  "**11.** `/level` shows your XP and level progression.\n" +
                  "**12.** `/askdm question:<your question>` privately asks the DM something without advancing the game.\n" +
                  "**13.** `/scene` generates the current cinematic scene and `/portrait` creates your character art.\n\n" +
                  "🎲 You can also roll manual dice with `/roll dice:2d6+3`.\n" +
                  `🖼️ Automatic cinematic images are limited to ${AUTO_IMAGE_LIMIT} per campaign.`
                ),
            ],
          });
      }
    }

    if (
      interaction.isButton() &&
      interaction.customId.startsWith("launch_3d_dice:")
    ) {
      const pendingId = interaction.customId.split(":")[1];
      const party = getPartyByMember(interaction.guildId, interaction.user.id, interaction.channelId);

      if (!party) {
        return interaction.reply({
          ephemeral: true,
          content: "You're not currently in an adventuring party.",
        });
      }

      const found = findPendingCheckCampaign(
        interaction.guildId,
        interaction.channelId,
        party.id,
        interaction.user.id
      );

      if (!found.pending || found.pending.id !== pendingId) {
        return interaction.reply({
          ephemeral: true,
          content:
            "⚠️ That roll is no longer pending. If the DM just requested a new roll, use the newest 3D Dice button.",
        });
      }

      // Discord.js uses the official LAUNCH_ACTIVITY interaction callback.
      return interaction.launchActivity();
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("cc_details:")) {
      return handleCharacterDetails(interaction);
    }

    if (
      interaction.isModalSubmit() &&
      interaction.customId.startsWith("cc_backstory_")
    ) {
      return handleCharacterBackstoryModal(interaction);
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
// 3D DICE ACTIVITY BRIDGE
// ============================================================

function make3DDiceButton(pending) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`launch_3d_dice:${pending.id}`)
      .setLabel(`Roll ${String(pending.dice || "1d20").toUpperCase()} in 3D`)
      .setEmoji("🎲")
      .setStyle(ButtonStyle.Primary)
  );
}

function bridgeAuthorized(req) {
  if (!DICE_BRIDGE_SECRET) return false;
  const supplied = String(req.headers["x-dice-bridge-secret"] || "");
  return supplied.length > 0 && supplied === DICE_BRIDGE_SECRET;
}

function findBridgePending(
  guildId,
  activityChannelId,
  userId,
  expectedPendingId = ""
) {
  const candidates = Object.values(data.campaigns)
    .filter((campaign) => {
      if (
        campaign.guildId !== guildId ||
        campaign.status !== "active" ||
        !campaign.pendingChecks?.[userId]
      ) {
        return false;
      }

      const party = data.parties[campaign.partyId];
      return Boolean(
        party &&
        party.memberIds?.includes(userId)
      );
    })
    .map((campaign) => ({
      campaign,
      party: data.parties[campaign.partyId],
      pending: campaign.pendingChecks[userId],
      character: getCharacter(
        guildId,
        userId,
        campaign.channelId
      ),
    }))
    .filter((item) => item.character);

  if (!candidates.length) {
    return { error: "NO_PENDING_ROLL" };
  }

  if (expectedPendingId) {
    const exact = candidates.find(
      ({ pending }) =>
        pending.id === expectedPendingId
    );

    if (!exact) {
      return { error: "PENDING_ROLL_CHANGED" };
    }

    return {
      ...exact,
      activityChannelId,
    };
  }

  const exactChannel = candidates.find(
    ({ campaign }) =>
      campaign.channelId === activityChannelId
  );

  if (exactChannel) {
    return {
      ...exactChannel,
      activityChannelId,
    };
  }

  candidates.sort(
    (a, b) =>
      Number(b.campaign.updatedAt || 0) -
      Number(a.campaign.updatedAt || 0)
  );

  return {
    ...candidates[0],
    activityChannelId,
  };
}

async function resolvePhysicalD20({
  guildId,
  activityChannelId,
  userId,
  pendingId,
  naturalRoll,
  rolls,
}) {
  const found = findBridgePending(
    guildId,
    activityChannelId,
    userId,
    pendingId
  );

  if (found.error) {
    return { ok: false, error: found.error };
  }

  const { character, party, campaign, pending } = found;

  if ((pending.dice || "1d20") !== "1d20") {
    return { ok: false, error: "UNSUPPORTED_DIE" };
  }

  const modeResult = resolveD20ModeRoll(
    pending.rollMode,
    Array.isArray(rolls) && rolls.length ? rolls : [naturalRoll]
  );

  if (!modeResult) {
    return { ok: false, error: "INVALID_RESULT" };
  }

  // The server independently chooses which physical die counts.
  naturalRoll = modeResult.kept;

  // Consume before AI narration so a duplicate HTTP request cannot resolve twice.
  delete campaign.pendingChecks[userId];

  const modifier = character.stats[pending.ability] || 0;
  const total = naturalRoll + modifier;
  const outcome = total >= pending.dc ? "SUCCESS" : "FAILURE";

  const rollRecord = {
    type: "roll",
    source: "3d_activity",
    userId,
    characterName: character.name,
    checkName: pending.checkName,
    ability: pending.ability,
    dice: pending.dice || "1d20",
    rollMode: modeResult.mode,
    rolls: modeResult.rolls,
    naturalRoll,
    modifier,
    total,
    outcome,
  };

  appendLog(campaign, rollRecord);

  const xpAmount =
    pending.noCheckXP
      ? 0
      : outcome === "SUCCESS"
        ? 10 + (naturalRoll === 20 ? 5 : 0)
        : 0;

  const xpProgression = awardCharacterXP(
    character,
    xpAmount,
    naturalRoll === 20
      ? `${pending.checkName} success + Natural 20`
      : `${pending.checkName} success`
  );

  saveDataSoon();

  // Always send the outcome to the adventure's REAL text channel.
  // The Discord Activity itself may be running inside a voice channel.
  const channel = await client.channels.fetch(campaign.channelId);
  if (!channel?.isTextBased()) {
    return { ok: false, error: "CAMPAIGN_CHANNEL_UNAVAILABLE" };
  }

  const natText =
    naturalRoll === 20
      ? "\n🌟 **NATURAL 20!**"
      : naturalRoll === 1
        ? "\n💀 **NATURAL 1!**"
        : "";

  const resultEmoji = outcome === "SUCCESS" ? "✅" : "❌";

  await channel.send({
    content:
      `🎲 **${character.name} — ${pending.checkName.replace(/([a-z])([A-Z])/g, "$1 $2")}**\n` +
      `${formatD20ModeResult(modeResult)}\n` +
      `Source: **3D Physical Dice**\n` +
      `${pending.ability}: **${formatModifier(modifier)}**\n` +
      `Total: **${total}**${natText}\n\n` +
      `${resultEmoji} **${outcome}**` +
      (xpProgression.gained
        ? `\n⭐ **+${xpProgression.gained} XP**`
        : ""),
    allowedMentions: { parse: [] },
  });

  if (xpProgression.levelUps.length) {
    await channel.send({
      embeds: [levelUpEmbed(character, xpProgression)],
      allowedMentions: { parse: [] },
    });
  }

  // Physical combat rolls must resolve through the combat engine.
  // v1.7.4 incorrectly treated them like normal story checks, which meant
  // the d20 message appeared but damage/HP/initiative never happened.
  if (pending.combatAttack) {
    await resolveCombatAttackAfterPhysicalRoll({
      channel,
      campaign,
      party,
      character,
      pending,
      naturalRoll,
      outcome,
    });

    return {
      ok: true,
      naturalRoll,
      rolls: modeResult.rolls,
      rollMode: modeResult.mode,
      modifier,
      total,
      outcome,
      characterName: character.name,
      checkName: pending.checkName,
      combatResolved: true,
      campaignChannelId: campaign.channelId,
      pendingId: pending.id,
    };
  }

  try {
    const resolved = await aiResolveCheck(campaign, party, rollRecord, pending);
    appendLog(campaign, { type: "dm", text: resolved.narration });

    await sendLong(
      channel,
      `🎭 **Dungeon Master**\n\n${resolved.narration}`
    );

    await maybeSendAutomaticImage(
      channel,
      campaign,
      party,
      resolved
    );
  } catch (err) {
    console.error("3D roll narration error:", err);
    await channel.send(
      "⚠️ The 3D roll was saved correctly, but the Dungeon Master's follow-up narration failed."
    );
  }

  resumePartyWindowAfterRoll(campaign);

  return {
    ok: true,
    naturalRoll,
    rolls: modeResult.rolls,
    rollMode: modeResult.mode,
    modifier,
    total,
    outcome,
    characterName: character.name,
    checkName: pending.checkName,
    campaignChannelId: campaign.channelId,
    pendingId: pending.id,
  };
}


// Railway HTTP API used ONLY by the Dice Activity backend.
// The shared secret never appears in browser/client JavaScript.
const bridgeApp = express();
bridgeApp.use(express.json({ limit: "32kb" }));

bridgeApp.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "mixer-dungeon-master",
    diceBridgeConfigured: Boolean(DICE_BRIDGE_SECRET),
  });
});

bridgeApp.post("/dice/pending", (req, res) => {
  if (!bridgeAuthorized(req)) {
    return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  }

  const { guildId, channelId, userId } = req.body || {};

  if (!guildId || !userId) {
    return res.status(400).json({ ok: false, error: "MISSING_FIELDS" });
  }

  const found = findBridgePending(
    String(guildId),
    String(channelId || ""),
    String(userId)
  );

  if (found.error) {
    return res.status(404).json({ ok: false, error: found.error });
  }

  const { character, campaign, pending } = found;

  console.log(
    `[3D Dice] Pending lookup for ${character.name}: ` +
    `activityChannel=${channelId || "NONE"} campaignChannel=${campaign.channelId} pending=${pending.id}`
  );

  return res.json({
    ok: true,
    pending: {
      id: pending.id,
      campaignId: campaign.id,
      campaignChannelId: campaign.channelId,
      characterName: character.name,
      checkName: pending.checkName,
      dice: pending.dice || "1d20",
      rollMode: normalizeRollMode(pending.rollMode),
      ability: pending.ability,
      modifier: character.stats[pending.ability] || 0,
      reason: pending.reason || "",
    },
  });
});

bridgeApp.post("/dice/result", async (req, res) => {
  if (!bridgeAuthorized(req)) {
    return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  }

  const {
    guildId,
    channelId,
    userId,
    pendingId,
    die,
    result,
    rolls,
  } = req.body || {};

  if (!guildId || !userId || !pendingId) {
    return res.status(400).json({ ok: false, error: "MISSING_FIELDS" });
  }

  if (String(die || "").toLowerCase() !== "d20") {
    return res.status(400).json({ ok: false, error: "UNSUPPORTED_DIE" });
  }

  try {
    const resolved = await resolvePhysicalD20({
      guildId: String(guildId),
      activityChannelId: String(channelId || ""),
      userId: String(userId),
      pendingId: String(pendingId),
      naturalRoll: Number(result),
      rolls: Array.isArray(rolls) ? rolls.map(Number) : [],
    });

    if (!resolved.ok) {
      return res.status(409).json(resolved);
    }

    return res.json(resolved);
  } catch (err) {
    console.error("Dice bridge result error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

bridgeApp.listen(HTTP_PORT, "0.0.0.0", () => {
  console.log(`3D dice bridge HTTP API listening on port ${HTTP_PORT}`);
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

  const character = getCharacter(
    message.guildId,
    message.author.id,
    campaign.channelId
  );
  if (!character) return;

  // Out-of-character chat: completely ignored by the adventure engine.
  if (message.content.trim().startsWith("//")) return;

  const text = cleanPlayerText(message.content);
  if (!text) return;

  if (campaign.combat?.active) {
    return processCombatPlayerMessage(message, campaign, party);
  }

  // A player with their own unresolved check must resolve that check before
  // declaring another uncertain action. /roll always remains available.
  if (campaign.pendingChecks?.[message.author.id]) {
    await message.reply(
      `🎲 **${character.name} already has a roll waiting.** ` +
      `Type **\`/roll\`** to resolve it. The 3D Dice Activity is optional while we test it.`
    );
    return;
  }

  addActionToPartyWindow(message, campaign, party);
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
  console.log(`3D dice bridge configured: ${DICE_BRIDGE_SECRET ? "YES" : "NO"}`);
  console.log(`Multiplayer action window: ${PARTY_ACTION_WINDOW_MS / 1000}s`);
  console.log(`Downtime target: after ${DOWNTIME_AFTER_ACTION_BEATS} action beats when safe`);
  console.log("Turn-based Combat v1: ENABLED");
  console.log("Character backstory choice: PLAYER-WRITTEN or AI-GENERATED");
  console.log("Backstory modal hotfix v1.7.2: ENABLED");
  console.log("3D dice multiplayer/voice-channel bridge fix v1.7.3: ENABLED");
  console.log("Advantage / Disadvantage v1.7.4: ENABLED");
  console.log("3D combat resolution hotfix v1.7.5: ENABLED");
  console.log("Class abilities v1.8: ENABLED");
  console.log("Smart enemy targeting + combat distance bands v1.8: ENABLED");
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
