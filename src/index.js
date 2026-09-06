import { DurableObject } from "cloudflare:workers";

const MAX_HP = 200;

const RACES = {
  vamp: ["🧛", "Vamp"],
  wolf: ["🐺", "Wolf"],
  elf: ["🧝", "Elf"],
  witcher: ["⚔️", "Witcher"],
};

const ATTACK_DAMAGE = { head: 30, body: 20, leg: 15 };
const LOCATION_FA = { head: "سر", body: "بدن", leg: "پا" };
const SPECIAL_LABELS = {
  vamp: "🧛 قدرت ویژه: گاز گرفتن گردن",
  witcher: "⚔️ قدرت ویژه: زخم سمی",
  wolf: "🐺 قدرت ویژه: گاز گرفتن دست",
  elf: "🧝 قدرت ویژه: ریشه‌های جنگل",
};

// file_id های آپلود‌شده روی تلگرام برای هر تصویر (رایگان و بدون محدودیت هاست جدا)
const RACE_SPECIAL_IMAGE = {
  vamp: "AgACAgQAAxkBAAMUapka2Y3lpRyToN8RcaLkQ5u7kQ4AAh8QaxsW0MlQ8Xfw3-apmI8BAAMCAAN3AAM9BA",
  witcher: "AgACAgQAAxkBAAMQapkX7WWldwM7WHA0FS4Uw18ipIwAAhwQaxsW0MlQk6yUFwABX4-2AQADAgADdwADPQQ",
  wolf: "AgACAgQAAxkBAAMSapka1RXWj-X76kVprAIAAbrleJsKAAIdEGsbFtDJUJ6AAAFXAnzI1AEAAwIAA3cAAz0E",
  elf: "AgACAgQAAxkBAAMTapka18cYF9RNPPg7XTfXH9uqey4AAh4QaxsW0MlQcarp1nhPvgwBAAMCAAN3AAM9BA",
};
const BOTH_DEFEND_IMAGE = "AgACAgQAAxkBAAMVapka2mTjU23fbWwO0Y_rnKq5uvIAAiAQaxsW0MlQpwABRtYSaXYCAQADAgADdwADPQQ";

// قدرت‌های ویژه‌ی مخصوص دستور /duel (بدون نژاد، بدون تصویر)
const DUEL_POWERS = {
  headcrush: {
    emoji: "💢",
    name: "Head Crush",
    desc: "۴۰ دمیج مستقیم به سر حریف؛ فقط با دفاع از سر خنثی می‌شود.",
  },
  firecarpet: {
    emoji: "🔥",
    name: "Fire Carpet",
    desc: "۲۵ دمیج آنی، سپس ۱۰ دمیج در راند بعد و ۱۰ دمیج دیگر در راند پس از آن؛ فقط با دفاع از پا خنثی می‌شود.",
  },
  smash: {
    emoji: "🔨",
    name: "Smash",
    desc: "۵۵ دمیج یک‌باره، فقط وقتی حریف در حال دفاع باشد؛ اگر حریف حمله کند، هم این قدرت خنثی می‌شود و هم حمله‌ی او اثر خودش را می‌گذارد.",
  },
  alldef: {
    emoji: "🧱",
    name: "All Defense",
    desc: "اگر حریف حمله کند، دو برابر همان ضربه به خودش برمی‌گردد و تو آسیبی نمی‌بینی؛ اگر حریف هم قدرت ویژه بزند، هیچ آسیبی رد و بدل نمی‌شود.",
  },
  extralife: {
    emoji: "❤️‍🩹",
    name: "Extra Life",
    desc: "اگر در همان راند جانت به صفر برسد، با ۸۰ HP زنده می‌شوی و مبارزه ادامه پیدا می‌کند؛ اگر نمیری، بی‌اثر می‌ماند.",
  },
};

const MOVE_LABELS = {
  "attack:head": "🗡 حمله به سر",
  "attack:body": "🗡 حمله به بدن",
  "attack:leg": "🗡 حمله به پا",
  "defend:head": "🛡 دفاع از سر",
  "defend:body": "🛡 دفاع از بدن",
  "defend:leg": "🛡 دفاع از پا",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function randomToken() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function makePlayer(user) {
  return {
    user_id: user.id,
    first_name: user.first_name || "Player",
    username: user.username || null,
    race: null,
    hp: MAX_HP,
    move: null,
    special_used: false,
    poison_damage: 0,
  };
}

function makeDuelPlayer(user) {
  return {
    user_id: user.id,
    first_name: user.first_name || "Player",
    username: user.username || null,
    power: null,
    hp: MAX_HP,
    move: null,
    special_used: false,
    dot_queue: [],
  };
}

function displayName(player) {
  return player.username ? `@${player.username}` : player.first_name;
}

function mentionHtml(player) {
  return `<a href="tg://user?id=${player.user_id}">${escapeHtml(displayName(player))}</a>`;
}

function raceText(player) {
  if (!player?.race || !RACES[player.race]) return "انتخاب نشده";
  const [emoji, name] = RACES[player.race];
  return `${emoji} ${name}`;
}

function powerText(player) {
  if (!player?.power || !DUEL_POWERS[player.power]) return "انتخاب نشده";
  const { emoji, name } = DUEL_POWERS[player.power];
  return `${emoji} ${name}`;
}

function powerListText() {
  return Object.values(DUEL_POWERS)
    .map((p) => `${p.emoji} <b>${p.name}</b>\n${p.desc}`)
    .join("\n\n");
}

function hpBar(hp) {
  const clamped = Math.max(0, Math.min(MAX_HP, hp));
  const filled = Math.round((clamped / MAX_HP) * 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

function raceKeyboard(fight, target) {
  const entries = Object.entries(RACES).map(([key, [emoji, name]]) => ({
    text: `${emoji} ${name}`,
    callback_data: `race|${fight.token}|${target}|${key}`,
  }));
  return { inline_keyboard: [entries.slice(0, 2), entries.slice(2, 4)] };
}

function powerKeyboard(fight, target) {
  const entries = Object.entries(DUEL_POWERS).map(([key, p]) => ({
    text: `${p.emoji} ${p.name}`,
    callback_data: `power|${fight.token}|${target}|${key}`,
  }));
  return { inline_keyboard: [entries.slice(0, 2), entries.slice(2, 4), entries.slice(4, 5)] };
}

function joinKeyboard(fight) {
  return {
    inline_keyboard: [[{ text: "⚔️ قبول مبارزه", callback_data: `join|${fight.token}` }]],
  };
}

function moveKeyboard(fight) {
  const t = fight.token;
  const r = fight.round_number;
  const specialReady = r >= 4;
  return {
    inline_keyboard: [
      [
        { text: "🗡 حمله به سر", callback_data: `move|${t}|${r}|attack|head` },
        { text: "🛡 دفاع از سر", callback_data: `move|${t}|${r}|defend|head` },
      ],
      [
        { text: "🗡 حمله به بدن", callback_data: `move|${t}|${r}|attack|body` },
        { text: "🛡 دفاع از بدن", callback_data: `move|${t}|${r}|defend|body` },
      ],
      [
        { text: "🗡 حمله به پا", callback_data: `move|${t}|${r}|attack|leg` },
        { text: "🛡 دفاع از پا", callback_data: `move|${t}|${r}|defend|leg` },
      ],
      [{ text: specialReady ? "⚡ قدرت ویژه" : "⚡ قدرت ویژه (راند ۴)" , callback_data: `special|${t}|${r}` }],
    ],
  };
}

function renderP1Race(fight) {
  return (
    "⚔️ <b>FIGHT ARENA</b>\n\n" +
    `🥇 بازیکن اول: ${mentionHtml(fight.player1)}\n` +
    "نژاد خودت را انتخاب کن:\n\n" +
    "🧛 Vamp   🐺 Wolf   🧝 Elf   ⚔️ Witcher"
  );
}

function renderDuelP1Power(fight) {
  return (
    "🥊 <b>DUEL ARENA</b>\n\n" +
    `🥇 بازیکن اول: ${mentionHtml(fight.player1)}\n` +
    "قدرت ویژه‌ات را برای این دوئل انتخاب کن:\n\n" +
    powerListText()
  );
}

function renderWaiting(fight) {
  const p = fight.player1;
  return (
    "⚔️ <b>FIGHT ARENA</b>\n\n" +
    `🥇 ${mentionHtml(p)} — <b>${raceText(p)}</b>\n\n` +
    "✅ بازیکن اول آماده است.\n⏳ منتظر نفر دوم...\n\n" +
    "برای ورود به مبارزه دکمه زیر را بزن."
  );
}

function renderDuelWaiting(fight) {
  const p = fight.player1;
  return (
    "🥊 <b>DUEL ARENA</b>\n\n" +
    `🥇 ${mentionHtml(p)} — <b>${powerText(p)}</b>\n\n` +
    "✅ بازیکن اول آماده است.\n⏳ منتظر نفر دوم...\n\n" +
    "برای ورود به دوئل دکمه زیر را بزن."
  );
}

function renderP2Race(fight) {
  const p2 = fight.player2;
  return (
    "⚔️ <b>FIGHT ARENA</b>\n\n" +
    `🥇 ${mentionHtml(fight.player1)} — <b>${raceText(fight.player1)}</b>\n` +
    `🥈 ${mentionHtml(p2)} — در حال انتخاب نژاد...\n\n` +
    `${mentionHtml(p2)} نژاد خودت را انتخاب کن:`
  );
}

function renderDuelP2Power(fight) {
  const p2 = fight.player2;
  return (
    "🥊 <b>DUEL ARENA</b>\n\n" +
    `🥇 ${mentionHtml(fight.player1)} — <b>${powerText(fight.player1)}</b>\n` +
    `🥈 ${mentionHtml(p2)} — در حال انتخاب قدرت ویژه...\n\n` +
    `${mentionHtml(p2)} قدرت ویژه‌ات را انتخاب کن:\n\n` +
    powerListText()
  );
}

function renderArena(fight) {
  const p1 = fight.player1;
  const p2 = fight.player2;
  let text =
    `⚔️ <b>FIGHT — ROUND ${fight.round_number}</b>\n\n` +
    `${raceText(p1)}  ${mentionHtml(p1)}\n` +
    `❤️ <b>${p1.hp} / ${MAX_HP}</b>\n<code>${hpBar(p1.hp)}</code>\n\n` +
    "                 <b>VS</b>\n\n" +
    `${raceText(p2)}  ${mentionHtml(p2)}\n` +
    `❤️ <b>${p2.hp} / ${MAX_HP}</b>\n<code>${hpBar(p2.hp)}</code>\n\n`;

  if (fight.last_result?.length) {
    text += "📜 <b>نتیجه راند قبل</b>\n";
    text += fight.last_result.map(escapeHtml).join("\n") + "\n\n";
  }

  text +=
    "🎯 <b>حرکت خود را انتخاب کنید.</b>\n" +
    "انتخاب شما تا ثبت حرکت حریف مخفی می‌ماند.";
  return text;
}

function renderDuelArena(fight) {
  const p1 = fight.player1;
  const p2 = fight.player2;
  let text =
    `🥊 <b>DUEL — ROUND ${fight.round_number}</b>\n\n` +
    `${powerText(p1)}  ${mentionHtml(p1)}\n` +
    `❤️ <b>${p1.hp} / ${MAX_HP}</b>\n<code>${hpBar(p1.hp)}</code>\n\n` +
    "                 <b>VS</b>\n\n" +
    `${powerText(p2)}  ${mentionHtml(p2)}\n` +
    `❤️ <b>${p2.hp} / ${MAX_HP}</b>\n<code>${hpBar(p2.hp)}</code>\n\n`;

  if (fight.last_result?.length) {
    text += "📜 <b>نتیجه راند قبل</b>\n";
    text += fight.last_result.map(escapeHtml).join("\n") + "\n\n";
  }

  text +=
    "🎯 <b>حرکت خود را انتخاب کنید.</b>\n" +
    "انتخاب شما تا ثبت حرکت حریف مخفی می‌ماند.";
  return text;
}

function renderDuelFinished(fight, winner) {
  const p1 = fight.player1;
  const p2 = fight.player2;
  let base =
    "☠️ <b>DUEL OVER</b>\n\n" +
    `${powerText(p1)} ${mentionHtml(p1)}\n❤️ <b>${p1.hp} HP</b>\n\n` +
    `${powerText(p2)} ${mentionHtml(p2)}\n❤️ <b>${p2.hp} HP</b>\n\n`;

  if (fight.last_result?.length) {
    base += "📜 <b>راند آخر</b>\n";
    base += fight.last_result.map(escapeHtml).join("\n") + "\n\n";
  }

  if (winner === 0) return base + `🤝 <b>DRAW!</b>\n⚔️ ${fight.round_number} راند`;
  const champ = winner === 1 ? p1 : p2;
  return base + "🏆 <b>WINNER</b>\n" + `${powerText(champ)} ${mentionHtml(champ)}\n\n` + `⚔️ ${fight.round_number} راند`;
}

function renderFinished(fight, winner) {
  const p1 = fight.player1;
  const p2 = fight.player2;
  let base =
    "☠️ <b>FIGHT OVER</b>\n\n" +
    `${raceText(p1)} ${mentionHtml(p1)}\n❤️ <b>${p1.hp} HP</b>\n\n` +
    `${raceText(p2)} ${mentionHtml(p2)}\n❤️ <b>${p2.hp} HP</b>\n\n`;

  if (fight.last_result?.length) {
    base += "📜 <b>راند آخر</b>\n";
    base += fight.last_result.map(escapeHtml).join("\n") + "\n\n";
  }

  if (winner === 0) return base + `🤝 <b>DRAW!</b>\n⚔️ ${fight.round_number} راند`;
  const champ = winner === 1 ? p1 : p2;
  return base + "🏆 <b>WINNER</b>\n" + `${raceText(champ)} ${mentionHtml(champ)}\n\n` + `⚔️ ${fight.round_number} راند`;
}

function resolveRound(p1, p2) {
  const p1Move = p1.move;
  const p2Move = p2.move;
  let p1Damage = 0;
  let p2Damage = 0;
  let p1Heal = 0;
  let p2Heal = 0;
  const lines = [];
  let bothDefended = false;
  let p1SpecialSuccessRace = null;
  let p2SpecialSuccessRace = null;

  const isDefend = (move, location = null) => move?.kind === "defend" && (location === null || move.location === location);

  if (p1Move.kind === "special" || p2Move.kind === "special") {
    if (p1Move.kind === "special") {
      if (p1.race === "vamp") {
        if (isDefend(p2Move, "head")) {
          lines.push("🛡 قدرت ویژه ومپایر بازیکن ۱ دفع شد؛ بازیکن ۲ از سر دفاع کرد.");
        } else {
          p2Damage += 20;
          p1Heal += 20;
          lines.push("🧛 بازیکن ۱ جلو رفت و گردن حریف را گاز گرفت.");
          lines.push("🩸 بازیکن ۲: -20 HP | ❤️ بازیکن ۱: +20 HP");
          p1SpecialSuccessRace = "vamp";
        }
      } else if (p1.race === "witcher") {
        if (isDefend(p2Move, "body")) {
          lines.push("🛡 قدرت ویژه ویچر بازیکن ۱ دفع شد؛ بازیکن ۲ از بدن دفاع کرد.");
        } else {
          p2Damage += 25;
          p2.poison_damage = 10;
          lines.push("⚔️ بازیکن ۱ با شمشیر آغشته به پوشن بدن حریف را خراش داد.");
          lines.push("💥 بازیکن ۲: -25 HP | ☠️ پوشن در راند بعد 10 HP دیگر کم می‌کند.");
          p1SpecialSuccessRace = "witcher";
        }
      } else if (p1.race === "wolf") {
        if (p2Move.kind === "defend") {
          p2Damage += 45;
          lines.push("🐺 بازیکن ۱ زیر نور ماه به گرگینه تبدیل شد و دست حریف را گاز گرفت.");
          lines.push("💥 بازیکن ۲: -45 HP");
          p1SpecialSuccessRace = "wolf";
        } else {
          lines.push("🐺 قدرت ویژه گرگینه بازیکن ۱ فعال نشد؛ حریف دفاع نکرد.");
        }
      } else if (p1.race === "elf") {
        if (isDefend(p2Move, "body")) {
          lines.push("🛡 قدرت ویژه الف بازیکن ۱ دفع شد؛ بازیکن ۲ از بدن دفاع کرد.");
        } else {
          p2Damage += 25;
          p1Heal += 20;
          lines.push(`🧝 ${displayName(p1)} ریشه‌های جنگل را فرا خواند و ضربه‌ای به قفسه‌ی سینه‌ی حریف زد، در این فرصت خود را احیا کرد.`);
          lines.push("💥 بازیکن ۲: -25 HP | ❤️ بازیکن ۱: +20 HP");
          p1SpecialSuccessRace = "elf";
        }
      }
    }

    if (p2Move.kind === "special") {
      if (p2.race === "vamp") {
        if (isDefend(p1Move, "head")) {
          lines.push("🛡 قدرت ویژه ومپایر بازیکن ۲ دفع شد؛ بازیکن ۱ از سر دفاع کرد.");
        } else {
          p1Damage += 20;
          p2Heal += 20;
          lines.push("🧛 بازیکن ۲ جلو رفت و گردن حریف را گاز گرفت.");
          lines.push("🩸 بازیکن ۱: -20 HP | ❤️ بازیکن ۲: +20 HP");
          p2SpecialSuccessRace = "vamp";
        }
      } else if (p2.race === "witcher") {
        if (isDefend(p1Move, "body")) {
          lines.push("🛡 قدرت ویژه ویچر بازیکن ۲ دفع شد؛ بازیکن ۱ از بدن دفاع کرد.");
        } else {
          p1Damage += 25;
          p1.poison_damage = 10;
          lines.push("⚔️ بازیکن ۲ با شمشیر آغشته به پوشن بدن حریف را خراش داد.");
          lines.push("💥 بازیکن ۱: -25 HP | ☠️ پوشن در راند بعد 10 HP دیگر کم می‌کند.");
          p2SpecialSuccessRace = "witcher";
        }
      } else if (p2.race === "wolf") {
        if (p1Move.kind === "defend") {
          p1Damage += 45;
          lines.push("🐺 بازیکن ۲ زیر نور ماه به گرگینه تبدیل شد و دست حریف را گاز گرفت.");
          lines.push("💥 بازیکن ۱: -45 HP");
          p2SpecialSuccessRace = "wolf";
        } else {
          lines.push("🐺 قدرت ویژه گرگینه بازیکن ۲ فعال نشد؛ حریف دفاع نکرد.");
        }
      } else if (p2.race === "elf") {
        if (isDefend(p1Move, "body")) {
          lines.push("🛡 قدرت ویژه الف بازیکن ۲ دفع شد؛ بازیکن ۱ از بدن دفاع کرد.");
        } else {
          p1Damage += 25;
          p2Heal += 20;
          lines.push(`🧝 ${displayName(p2)} ریشه‌های جنگل را فرا خواند و ضربه‌ای به قفسه‌ی سینه‌ی حریف زد، در این فرصت خود را احیا کرد.`);
          lines.push("💥 بازیکن ۱: -25 HP | ❤️ بازیکن ۲: +20 HP");
          p2SpecialSuccessRace = "elf";
        }
      }
    }

    // A special move is a complete action for that player. If the other player chose a normal move,
    // its normal attack/defense is still resolved against the special user.
    const p1Special = p1Move.kind === "special";
    const p2Special = p2Move.kind === "special";
    if (p1Special && p2Move.kind === "attack") {
      const damage = ATTACK_DAMAGE[p2Move.location];
      p1Damage += damage;
      lines.push(`💥 بازیکن ۲ به ${LOCATION_FA[p2Move.location]} حمله کرد؛ بازیکن ۱: -${damage} HP`);
    } else if (p2Special && p1Move.kind === "attack") {
      const damage = ATTACK_DAMAGE[p1Move.location];
      p2Damage += damage;
      lines.push(`💥 بازیکن ۱ به ${LOCATION_FA[p1Move.location]} حمله کرد؛ بازیکن ۲: -${damage} HP`);
    }
  } else if (p1Move.kind === "attack" && p2Move.kind === "attack") {
    const d1 = ATTACK_DAMAGE[p1Move.location];
    const d2 = ATTACK_DAMAGE[p2Move.location];
    p2Damage += d1;
    p1Damage += d2;
    lines.push(`⚔️ هر دو حمله کردند: بازیکن ۱ به ${LOCATION_FA[p1Move.location]} و بازیکن ۲ به ${LOCATION_FA[p2Move.location]}.`);
    lines.push(`💥 بازیکن ۱: -${d2} HP | بازیکن ۲: -${d1} HP`);
  } else if (p1Move.kind === "attack" && p2Move.kind === "defend") {
    const damage = ATTACK_DAMAGE[p1Move.location];
    if (p1Move.location === p2Move.location) {
      const penalty = damage - 5;
      p1Damage += penalty;
      lines.push(`🛡 بازیکن ۲ حمله به ${LOCATION_FA[p1Move.location]} را درست دفاع کرد.`);
      lines.push(`↩️ حمله دفع شد؛ بازیکن ۱: -${penalty} HP`);
    } else {
      p2Damage += damage;
      lines.push(`💥 بازیکن ۱ به ${LOCATION_FA[p1Move.location]} حمله کرد؛ دفاع بازیکن ۲ از ${LOCATION_FA[p2Move.location]} اشتباه بود.`);
      lines.push(`❤️‍🔥 بازیکن ۲: -${damage} HP`);
    }
  } else if (p1Move.kind === "defend" && p2Move.kind === "attack") {
    const damage = ATTACK_DAMAGE[p2Move.location];
    if (p2Move.location === p1Move.location) {
      const penalty = damage - 5;
      p2Damage += penalty;
      lines.push(`🛡 بازیکن ۱ حمله به ${LOCATION_FA[p2Move.location]} را درست دفاع کرد.`);
      lines.push(`↩️ حمله دفع شد؛ بازیکن ۲: -${penalty} HP`);
    } else {
      p1Damage += damage;
      lines.push(`💥 بازیکن ۲ به ${LOCATION_FA[p2Move.location]} حمله کرد؛ دفاع بازیکن ۱ از ${LOCATION_FA[p1Move.location]} اشتباه بود.`);
      lines.push(`❤️‍🔥 بازیکن ۱: -${damage} HP`);
    }
  } else {
    lines.push(`🛡 بازیکن ۱ از ${LOCATION_FA[p1Move.location]} دفاع کرد.`);
    lines.push(`🛡 بازیکن ۲ از ${LOCATION_FA[p2Move.location]} دفاع کرد.`);
    lines.push("🛡 هر دو بازیکن دفاع کردند؛ این راند بدون آسیب تمام شد.");
    bothDefended = true;
  }

  return { p1Damage, p2Damage, p1Heal, p2Heal, lines, bothDefended, p1SpecialSuccessRace, p2SpecialSuccessRace };
}

// موتور محاسبه‌ی راند برای دستور /duel. برخلاف resolveRound (که نژادی است)،
// اینجا هر بازیکن از قبل یکی از ۵ قدرت ثابت را انتخاب کرده و از آن استفاده می‌کند.
function resolveDuelRound(p1, p2) {
  const p1Move = p1.move;
  const p2Move = p2.move;
  let p1Damage = 0;
  let p2Damage = 0;
  let p1Heal = 0;
  let p2Heal = 0;
  const lines = [];
  let bothDefended = false;
  let p1UsedExtraLife = false;
  let p2UsedExtraLife = false;

  const isDefend = (move, location = null) => move?.kind === "defend" && (location === null || move.location === location);

  const p1Special = p1Move.kind === "special";
  const p2Special = p2Move.kind === "special";

  if (p1Special || p2Special) {
    const p1IsAllDef = p1Special && p1.power === "alldef";
    const p2IsAllDef = p2Special && p2.power === "alldef";

    if (p1Special) {
      const power = p1.power;
      if (power === "headcrush" && !p2IsAllDef) {
        if (isDefend(p2Move, "head")) {
          lines.push("🛡 Head Crush بازیکن ۱ دفع شد؛ بازیکن ۲ از سر دفاع کرد.");
        } else {
          p2Damage += 40;
          lines.push("💢 بازیکن ۱ ضربه‌ای کوبنده به سر حریف زد!");
          lines.push("💥 بازیکن ۲: -40 HP");
        }
      } else if (power === "firecarpet" && !p2IsAllDef) {
        if (isDefend(p2Move, "leg")) {
          lines.push("🛡 Fire Carpet بازیکن ۱ دفع شد؛ بازیکن ۲ از پا دفاع کرد.");
        } else {
          p2Damage += 25;
          p2.dot_queue.push(10, 10);
          lines.push("🔥 بازیکن ۱ زمین زیر پای حریف را به آتش کشید!");
          lines.push("💥 بازیکن ۲: -25 HP | 🔥 ۱۰ HP در راند بعد و ۱۰ HP در راند پس از آن.");
        }
      } else if (power === "smash") {
        if (isDefend(p2Move)) {
          p2Damage += 55;
          lines.push("🔨 بازیکن ۱ با یک Smash غافلگیرکننده حریفِ در حال دفاع را کوبید!");
          lines.push("💥 بازیکن ۲: -55 HP");
        } else {
          lines.push("🔨 Smash بازیکن ۱ خنثی شد؛ حریف در حال دفاع نبود.");
        }
      } else if (power === "alldef") {
        if (p2Move.kind === "attack") {
          const reflected = ATTACK_DAMAGE[p2Move.location] * 2;
          p2Damage += reflected;
          lines.push("🧱 بازیکن ۱ با All Defense حمله‌ی حریف را برگرداند!");
          lines.push(`↩️ بازیکن ۲: -${reflected} HP | بازیکن ۱ آسیبی ندید.`);
        } else if (p2Special) {
          lines.push("🧱 قدرت‌های ویژه‌ی هر دو بازیکن یکدیگر را خنثی کردند؛ این راند بدون آسیب تمام شد.");
        } else {
          lines.push("🧱 All Defense بازیکن ۱ فعال شد؛ حمله‌ای برای برگرداندن وجود نداشت.");
        }
      } else if (power === "extralife") {
        p1UsedExtraLife = true;
        lines.push("❤️‍🩹 بازیکن ۱ برای یک زندگی دوباره آماده شد...");
      }
    }

    if (p2Special) {
      const power = p2.power;
      if (power === "headcrush" && !p1IsAllDef) {
        if (isDefend(p1Move, "head")) {
          lines.push("🛡 Head Crush بازیکن ۲ دفع شد؛ بازیکن ۱ از سر دفاع کرد.");
        } else {
          p1Damage += 40;
          lines.push("💢 بازیکن ۲ ضربه‌ای کوبنده به سر حریف زد!");
          lines.push("💥 بازیکن ۱: -40 HP");
        }
      } else if (power === "firecarpet" && !p1IsAllDef) {
        if (isDefend(p1Move, "leg")) {
          lines.push("🛡 Fire Carpet بازیکن ۲ دفع شد؛ بازیکن ۱ از پا دفاع کرد.");
        } else {
          p1Damage += 25;
          p1.dot_queue.push(10, 10);
          lines.push("🔥 بازیکن ۲ زمین زیر پای حریف را به آتش کشید!");
          lines.push("💥 بازیکن ۱: -25 HP | 🔥 ۱۰ HP در راند بعد و ۱۰ HP در راند پس از آن.");
        }
      } else if (power === "smash") {
        if (isDefend(p1Move)) {
          p1Damage += 55;
          lines.push("🔨 بازیکن ۲ با یک Smash غافلگیرکننده حریفِ در حال دفاع را کوبید!");
          lines.push("💥 بازیکن ۱: -55 HP");
        } else {
          lines.push("🔨 Smash بازیکن ۲ خنثی شد؛ حریف در حال دفاع نبود.");
        }
      } else if (power === "alldef") {
        if (p1Move.kind === "attack") {
          const reflected = ATTACK_DAMAGE[p1Move.location] * 2;
          p1Damage += reflected;
          lines.push("🧱 بازیکن ۲ با All Defense حمله‌ی حریف را برگرداند!");
          lines.push(`↩️ بازیکن ۱: -${reflected} HP | بازیکن ۲ آسیبی ندید.`);
        } else if (p1Special && !p1IsAllDef) {
          lines.push("🧱 قدرت‌های ویژه‌ی هر دو بازیکن یکدیگر را خنثی کردند؛ این راند بدون آسیب تمام شد.");
        } else if (!p1Special) {
          lines.push("🧱 All Defense بازیکن ۲ فعال شد؛ حمله‌ای برای برگرداندن وجود نداشت.");
        }
      } else if (power === "extralife") {
        p2UsedExtraLife = true;
        lines.push("❤️‍🩹 بازیکن ۲ برای یک زندگی دوباره آماده شد...");
      }
    }

    // اگر یک طرف قدرت ویژه زده و طرف مقابل حمله‌ی معمولی کرده، حمله‌ی معمولی هم اثر می‌گذارد؛
    // به‌جز All Defense که خودش این حالت را کامل مدیریت می‌کند.
    if (p1Special && p2Move.kind === "attack" && p1.power !== "alldef") {
      const damage = ATTACK_DAMAGE[p2Move.location];
      p1Damage += damage;
      lines.push(`💥 بازیکن ۲ به ${LOCATION_FA[p2Move.location]} حمله کرد؛ بازیکن ۱: -${damage} HP`);
    } else if (p2Special && p1Move.kind === "attack" && p2.power !== "alldef") {
      const damage = ATTACK_DAMAGE[p1Move.location];
      p2Damage += damage;
      lines.push(`💥 بازیکن ۱ به ${LOCATION_FA[p1Move.location]} حمله کرد؛ بازیکن ۲: -${damage} HP`);
    }
  } else if (p1Move.kind === "attack" && p2Move.kind === "attack") {
    const d1 = ATTACK_DAMAGE[p1Move.location];
    const d2 = ATTACK_DAMAGE[p2Move.location];
    p2Damage += d1;
    p1Damage += d2;
    lines.push(`⚔️ هر دو حمله کردند: بازیکن ۱ به ${LOCATION_FA[p1Move.location]} و بازیکن ۲ به ${LOCATION_FA[p2Move.location]}.`);
    lines.push(`💥 بازیکن ۱: -${d2} HP | بازیکن ۲: -${d1} HP`);
  } else if (p1Move.kind === "attack" && p2Move.kind === "defend") {
    const damage = ATTACK_DAMAGE[p1Move.location];
    if (p1Move.location === p2Move.location) {
      const penalty = damage - 5;
      p1Damage += penalty;
      lines.push(`🛡 بازیکن ۲ حمله به ${LOCATION_FA[p1Move.location]} را درست دفاع کرد.`);
      lines.push(`↩️ حمله دفع شد؛ بازیکن ۱: -${penalty} HP`);
    } else {
      p2Damage += damage;
      lines.push(`💥 بازیکن ۱ به ${LOCATION_FA[p1Move.location]} حمله کرد؛ دفاع بازیکن ۲ از ${LOCATION_FA[p2Move.location]} اشتباه بود.`);
      lines.push(`❤️‍🔥 بازیکن ۲: -${damage} HP`);
    }
  } else if (p1Move.kind === "defend" && p2Move.kind === "attack") {
    const damage = ATTACK_DAMAGE[p2Move.location];
    if (p2Move.location === p1Move.location) {
      const penalty = damage - 5;
      p2Damage += penalty;
      lines.push(`🛡 بازیکن ۱ حمله به ${LOCATION_FA[p2Move.location]} را درست دفاع کرد.`);
      lines.push(`↩️ حمله دفع شد؛ بازیکن ۲: -${penalty} HP`);
    } else {
      p1Damage += damage;
      lines.push(`💥 بازیکن ۲ به ${LOCATION_FA[p2Move.location]} حمله کرد؛ دفاع بازیکن ۱ از ${LOCATION_FA[p1Move.location]} اشتباه بود.`);
      lines.push(`❤️‍🔥 بازیکن ۱: -${damage} HP`);
    }
  } else {
    lines.push(`🛡 بازیکن ۱ از ${LOCATION_FA[p1Move.location]} دفاع کرد.`);
    lines.push(`🛡 بازیکن ۲ از ${LOCATION_FA[p2Move.location]} دفاع کرد.`);
    lines.push("🛡 هر دو بازیکن دفاع کردند؛ این راند بدون آسیب تمام شد.");
    bothDefended = true;
  }

  return { p1Damage, p2Damage, p1Heal, p2Heal, lines, bothDefended, p1UsedExtraLife, p2UsedExtraLife };
}

function winnerFromHp(p1Hp, p2Hp) {
  const p1Dead = p1Hp <= 0;
  const p2Dead = p2Hp <= 0;
  if (!p1Dead && !p2Dead) return null;
  if (p1Dead && !p2Dead) return 2;
  if (p2Dead && !p1Dead) return 1;
  if (p1Hp > p2Hp) return 1;
  if (p2Hp > p1Hp) return 2;
  return 0;
}

function commandFromText(text) {
  if (!text || !text.startsWith("/")) return null;
  return text.trim().split(/\s+/)[0].split("@")[0].toLowerCase();
}

async function telegramApi(env, method, payload = {}) {
  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  let data;
  try { data = await response.json(); }
  catch {
    console.error(`Telegram ${method}: invalid JSON response`);
    return null;
  }

  if (!response.ok || !data.ok) {
    console.error(`Telegram ${method} failed: ${data?.description || response.status}`);
    return null;
  }
  return data.result;
}

async function answerCallback(env, id, text, showAlert = false) {
  return telegramApi(env, "answerCallbackQuery", { callback_query_id: id, text, show_alert: showAlert });
}

async function sendText(env, chatId, text, replyMarkup) {
  const payload = { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return telegramApi(env, "sendMessage", payload);
}

async function deleteMessageApi(env, chatId, messageId) {
  return telegramApi(env, "deleteMessage", { chat_id: chatId, message_id: messageId });
}

// شرط ۵گانه: کدوم عکس (اگر اصلاً عکسی) باید برای این راند نمایش داده بشه.
// اگر هر دو بازیکن با موفقیت قدرت ویژه زدن، هیچ عکسی نشون داده نمی‌شه.
function pickRoundImage(outcome) {
  if (outcome.bothDefended) return BOTH_DEFEND_IMAGE;
  const p1Race = outcome.p1SpecialSuccessRace;
  const p2Race = outcome.p2SpecialSuccessRace;
  if (p1Race && p2Race) return null;
  if (p1Race) return RACE_SPECIAL_IMAGE[p1Race];
  if (p2Race) return RACE_SPECIAL_IMAGE[p2Race];
  return null;
}

// پیام اصلیِ در حال آپدیت مبارزه رو به‌روزرسانی می‌کند: اگر لازم باشد آن را به یک پیام
// عکس‌دار تبدیل می‌کند (imageFileId موجود باشد)، یا در راند بعد دوباره آن را به پیام
// متنیِ ساده برمی‌گرداند. چون تلگرام اجازه‌ی تبدیل مستقیم متن<->عکس با edit را نمی‌دهد،
// در این حالت‌ها پیام قبلی حذف و پیام جدید فرستاده می‌شود (و message_id به‌روز می‌شود).
// فراخوان بعد از این تابع باید fight را ذخیره کند (این تابع فقط fight را در حافظه تغییر می‌دهد).
async function updateRoundMessage(env, fight, chatId, messageId, text, replyMarkup, imageFileId) {
  const wasPhoto = fight.message_mode === "photo";
  let alreadyDeleted = false;

  if (imageFileId) {
    if (wasPhoto) {
      const payload = {
        chat_id: chatId,
        message_id: messageId,
        media: { type: "photo", media: imageFileId, caption: text, parse_mode: "HTML" },
      };
      if (replyMarkup) payload.reply_markup = replyMarkup;
      const edited = await telegramApi(env, "editMessageMedia", payload);
      if (edited) {
        fight.message_mode = "photo";
        return;
      }
    } else {
      await deleteMessageApi(env, chatId, messageId);
      alreadyDeleted = true;
      const payload = { chat_id: chatId, photo: imageFileId, caption: text, parse_mode: "HTML" };
      if (replyMarkup) payload.reply_markup = replyMarkup;
      const sent = await telegramApi(env, "sendPhoto", payload);
      if (sent?.message_id) {
        fight.message_mode = "photo";
        fight.message_id = sent.message_id;
        return;
      }
    }
  }

  // بدون عکس، یا عکس با خطا مواجه شد (مثلاً کپشن خیلی بلند بود) -> بازگشت به حالت متنی
  if (wasPhoto && !alreadyDeleted) {
    await deleteMessageApi(env, chatId, messageId);
    alreadyDeleted = true;
  }
  if (alreadyDeleted) {
    const payload = { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    const sent = await telegramApi(env, "sendMessage", payload);
    fight.message_mode = "text";
    if (sent?.message_id) fight.message_id = sent.message_id;
    return;
  }

  await editText(env, chatId, messageId, text, replyMarkup);
  fight.message_mode = "text";
}

async function editText(env, chatId, messageId, text, replyMarkup) {
  const payload = { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", disable_web_page_preview: true };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return telegramApi(env, "editMessageText", payload);
}

export class FightRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
  }

  async getFight() { return (await this.ctx.storage.get("fight")) || null; }
  async saveFight(fight) { await this.ctx.storage.put("fight", fight); }
  async clearFight() { await this.ctx.storage.delete("fight"); }

  async getLeaderboard() { return (await this.ctx.storage.get("leaderboard")) || {}; }
  async saveLeaderboard(board) { await this.ctx.storage.put("leaderboard", board); }

  // بعد از پایان هر مبارزه صدا زده می‌شود: رکورد رودررویِ همین دو بازیکن (صرف‌نظر از
  // این‌که هرکدوم با نفرات دیگر چند چندند) را در این گروه به‌روز می‌کند و یک خط
  // امتیاز به سبک "X ۳ - ۱ Y" برای نمایش در پیام پایان مبارزه برمی‌گرداند.
  async recordResultAndFormat(fight, winner) {
    const p1 = fight.player1;
    const p2 = fight.player2;
    const pairKey = [String(p1.user_id), String(p2.user_id)].sort().join(":");

    const board = await this.getLeaderboard();
    const entry = board[pairKey] || {};
    for (const p of [p1, p2]) {
      const uid = String(p.user_id);
      if (!entry[uid]) entry[uid] = { name: displayName(p), wins: 0 };
      entry[uid].name = displayName(p);
    }
    if (winner === 1 || winner === 2) {
      const champ = winner === 1 ? p1 : p2;
      entry[String(champ.user_id)].wins += 1;
    }
    board[pairKey] = entry;
    await this.saveLeaderboard(board);

    const p1Wins = entry[String(p1.user_id)].wins;
    const p2Wins = entry[String(p2.user_id)].wins;
    return (
      "\n⚔️ <b>نتیجه‌ی تقابل این دو نفر</b>\n" +
      `${escapeHtml(displayName(p1))} ${p1Wins} - ${p2Wins} ${escapeHtml(displayName(p2))}`
    );
  }

  // بررسی می‌کند که آیا در این گروه می‌شود بازی جدیدی (چه /fight چه /duel) شروع کرد؛
  // اگر نه، خودش پیام مناسب را می‌فرستد و false برمی‌گرداند.
  async ensureCanStart(chat) {
    if (chat.type !== "group" && chat.type !== "supergroup") {
      await sendText(this.env, chat.id, "⚔️ این بازی برای گروه ساخته شده.\nربات را به یک گروه اضافه کن و /fight یا /duel را بزن.");
      return false;
    }
    const current = await this.getFight();
    if (current && current.phase !== "finished") {
      await sendText(this.env, chat.id, "⛔ در این گروه یک بازی فعال وجود دارد (/fight یا /duel).\nبرای لغو، بازیکن اول می‌تواند /cancel را بزند.");
      return false;
    }
    return true;
  }

  // بعد از این‌که حرکت هر دو بازیکنِ یک دوئل ثبت شد صدا زده می‌شود: راند را حل می‌کند،
  // اثر Extra Life و آتشِ تأخیری Fire Carpet را اعمال می‌کند، شارژ مجدد راند ۲۰ را چک
  // می‌کند و پیام مبارزه را (بدون هیچ تصویری) به‌روزرسانی می‌کند.
  async resolveDuelTurn(fight, chatId, messageId) {
    const outcome = resolveDuelRound(fight.player1, fight.player2);
    fight.player1.hp = Math.min(MAX_HP, Math.max(0, fight.player1.hp - outcome.p1Damage + outcome.p1Heal));
    fight.player2.hp = Math.min(MAX_HP, Math.max(0, fight.player2.hp - outcome.p2Damage + outcome.p2Heal));
    fight.last_result = outcome.lines;

    const revived = { p1: false, p2: false };
    if (fight.player1.hp <= 0 && outcome.p1UsedExtraLife) {
      fight.player1.hp = 80;
      revived.p1 = true;
      fight.last_result.push("❤️‍🩹 بازیکن ۱ با Extra Life دوباره زنده شد! (۸۰ HP)");
    }
    if (fight.player2.hp <= 0 && outcome.p2UsedExtraLife) {
      fight.player2.hp = 80;
      revived.p2 = true;
      fight.last_result.push("❤️‍🩹 بازیکن ۲ با Extra Life دوباره زنده شد! (۸۰ HP)");
    }

    const winner = winnerFromHp(fight.player1.hp, fight.player2.hp);
    if (winner !== null) {
      fight.phase = "finished";
      const scoreText = await this.recordResultAndFormat(fight, winner);
      await updateRoundMessage(this.env, fight, chatId, messageId, renderDuelFinished(fight, winner) + scoreText, null, null);
      await this.saveFight(fight);
      return;
    }

    fight.player1.move = null;
    fight.player2.move = null;
    fight.round_number += 1;

    const tickLines = [];
    for (const p of [fight.player1, fight.player2]) {
      if (p.dot_queue?.length) {
        const dmg = p.dot_queue.shift();
        p.hp = Math.max(0, p.hp - dmg);
        tickLines.push(`🔥 آتش Fire Carpet روی ${displayName(p)} اثر کرد: -${dmg} HP.`);
      }
    }
    if (tickLines.length) fight.last_result.push(...tickLines);

    // Extra Life همچنان می‌تواند از مرگ ناشی از همین آتشِ همان راند نجات دهد،
    // اما فقط اگر قبلاً (در همین راند) استفاده نشده باشد.
    if (fight.player1.hp <= 0 && outcome.p1UsedExtraLife && !revived.p1) {
      fight.player1.hp = 80;
      fight.last_result.push("❤️‍🩹 بازیکن ۱ با Extra Life دوباره زنده شد! (۸۰ HP)");
    }
    if (fight.player2.hp <= 0 && outcome.p2UsedExtraLife && !revived.p2) {
      fight.player2.hp = 80;
      fight.last_result.push("❤️‍🩹 بازیکن ۲ با Extra Life دوباره زنده شد! (۸۰ HP)");
    }

    if (fight.round_number === 4) {
      fight.last_result.push("⚡ قدرت‌های ویژه شارژ شدند! از الان هر بازیکن فقط یک بار می‌تواند از آن استفاده کند.");
    }
    if (fight.round_number === 20 && !fight.recharged_at_20) {
      fight.recharged_at_20 = true;
      fight.player1.special_used = false;
      fight.player2.special_used = false;
      fight.last_result.push("⚡ راند ۲۰ فرا رسید! قدرت‌های ویژه یک‌بار دیگر شارژ شدند.");
    }

    const tickWinner = winnerFromHp(fight.player1.hp, fight.player2.hp);
    if (tickWinner !== null) {
      fight.phase = "finished";
      const scoreText = await this.recordResultAndFormat(fight, tickWinner);
      await updateRoundMessage(this.env, fight, chatId, messageId, renderDuelFinished(fight, tickWinner) + scoreText, null, null);
      await this.saveFight(fight);
      return;
    }

    await updateRoundMessage(this.env, fight, chatId, messageId, renderDuelArena(fight), moveKeyboard(fight), null);
    await this.saveFight(fight);
  }

  async fetch(request) {
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    let update;
    try { update = await request.json(); }
    catch { return new Response("Bad Request", { status: 400 }); }

    try { await this.handleUpdate(update); }
    catch (error) {
      console.error("FightRoom update error:", error?.message || String(error));
    }
    return new Response("ok");
  }

  async handleUpdate(update) {
    if (update.message) return this.handleMessage(update.message);
    if (update.callback_query) return this.handleCallback(update.callback_query);
  }

  async handleMessage(message) {
    const chat = message.chat;
    const user = message.from;
    const cmd = commandFromText(message.text);
    if (!cmd || !chat || !user) return;

    if (cmd === "/fight") {
      if (!(await this.ensureCanStart(chat))) return;

      const fight = {
        chat_id: chat.id,
        token: randomToken(),
        mode: "race",
        player1: makePlayer(user),
        player2: null,
        phase: "p1_race",
        round_number: 1,
        message_id: null,
        message_mode: "text",
        last_result: [],
      };

      await this.saveFight(fight);
      const sent = await sendText(this.env, chat.id, renderP1Race(fight), raceKeyboard(fight, "p1"));
      if (sent?.message_id) {
        fight.message_id = sent.message_id;
        await this.saveFight(fight);
      }
      return;
    }

    if (cmd === "/duel") {
      if (!(await this.ensureCanStart(chat))) return;

      const fight = {
        chat_id: chat.id,
        token: randomToken(),
        mode: "duel",
        player1: makeDuelPlayer(user),
        player2: null,
        phase: "p1_power",
        round_number: 1,
        recharged_at_20: false,
        message_id: null,
        message_mode: "text",
        last_result: [],
      };

      await this.saveFight(fight);
      const sent = await sendText(this.env, chat.id, renderDuelP1Power(fight), powerKeyboard(fight, "p1"));
      if (sent?.message_id) {
        fight.message_id = sent.message_id;
        await this.saveFight(fight);
      }
      return;
    }

    if (cmd === "/cancel") {
      const fight = await this.getFight();
      if (!fight || fight.phase === "finished") {
        await sendText(this.env, chat.id, "ℹ️ بازی فعالی وجود ندارد.");
        return;
      }
      if (user.id !== fight.player1.user_id) {
        await sendText(this.env, chat.id, "⛔ فقط بازیکنی که بازی را شروع کرده می‌تواند آن را لغو کند.");
        return;
      }
      await this.clearFight();
      await sendText(this.env, chat.id, "🛑 بازی لغو شد. برای بازی جدید /fight یا /duel را بزن.");
    }
  }

  async handleCallback(query) {
    const parts = (query.data || "").split("|");
    const chatId = query.message?.chat?.id;
    const messageId = query.message?.message_id;
    const user = query.from;
    if (!chatId || !messageId || !user) {
      await answerCallback(this.env, query.id, "درخواست نامعتبر است.", true);
      return;
    }

    const fight = await this.getFight();
    if (!fight) {
      await answerCallback(this.env, query.id, "این مبارزه دیگر فعال نیست.", true);
      return;
    }
    if (parts.length < 2 || parts[1] !== fight.token) {
      await answerCallback(this.env, query.id, "این دکمه مربوط به یک مبارزه قدیمی است.", true);
      return;
    }

    const action = parts[0];

    if (action === "race") {
      if (parts.length !== 4 || !RACES[parts[3]]) {
        await answerCallback(this.env, query.id, "نژاد نامعتبر است.", true);
        return;
      }
      const target = parts[2];
      const race = parts[3];

      if (target === "p1") {
        if (fight.phase !== "p1_race") return answerCallback(this.env, query.id, "این مرحله تمام شده است.", true);
        if (user.id !== fight.player1.user_id) return answerCallback(this.env, query.id, "فقط بازیکن اول می‌تواند نژادش را انتخاب کند.", true);
        fight.player1.race = race;
        fight.phase = "waiting_p2";
        await this.saveFight(fight);
        await answerCallback(this.env, query.id, "✅ نژاد انتخاب شد.");
        await editText(this.env, chatId, messageId, renderWaiting(fight), joinKeyboard(fight));
        return;
      }

      if (target === "p2") {
        if (fight.phase !== "p2_race" || !fight.player2) return answerCallback(this.env, query.id, "این مرحله فعال نیست.", true);
        if (user.id !== fight.player2.user_id) return answerCallback(this.env, query.id, "فقط بازیکن دوم می‌تواند نژادش را انتخاب کند.", true);
        fight.player2.race = race;
        fight.phase = "active";
        await this.saveFight(fight);
        await answerCallback(this.env, query.id, "✅ نژاد انتخاب شد. مبارزه شروع شد!");
        await editText(this.env, chatId, messageId, renderArena(fight), moveKeyboard(fight));
        return;
      }
    }

    if (action === "join") {
      if (fight.phase !== "waiting_p2") return answerCallback(this.env, query.id, "امکان ورود به این مبارزه وجود ندارد.", true);
      if (user.id === fight.player1.user_id) return answerCallback(this.env, query.id, "نمی‌توانی با خودت مبارزه کنی 😄", true);

      if (fight.mode === "duel") {
        fight.player2 = makeDuelPlayer(user);
        fight.phase = "p2_power";
        await this.saveFight(fight);
        await answerCallback(this.env, query.id, "⚔️ وارد دوئل شدی!");
        await editText(this.env, chatId, messageId, renderDuelP2Power(fight), powerKeyboard(fight, "p2"));
        return;
      }

      fight.player2 = makePlayer(user);
      fight.phase = "p2_race";
      await this.saveFight(fight);
      await answerCallback(this.env, query.id, "⚔️ وارد مبارزه شدی!");
      await editText(this.env, chatId, messageId, renderP2Race(fight), raceKeyboard(fight, "p2"));
      return;
    }

    if (action === "power") {
      if (parts.length !== 4 || !DUEL_POWERS[parts[3]]) {
        await answerCallback(this.env, query.id, "قدرت ویژه نامعتبر است.", true);
        return;
      }
      const target = parts[2];
      const power = parts[3];

      if (target === "p1") {
        if (fight.phase !== "p1_power") return answerCallback(this.env, query.id, "این مرحله تمام شده است.", true);
        if (user.id !== fight.player1.user_id) return answerCallback(this.env, query.id, "فقط بازیکن اول می‌تواند قدرت ویژه‌اش را انتخاب کند.", true);
        fight.player1.power = power;
        fight.phase = "waiting_p2";
        await this.saveFight(fight);
        await answerCallback(this.env, query.id, "✅ قدرت ویژه انتخاب شد.");
        await editText(this.env, chatId, messageId, renderDuelWaiting(fight), joinKeyboard(fight));
        return;
      }

      if (target === "p2") {
        if (fight.phase !== "p2_power" || !fight.player2) return answerCallback(this.env, query.id, "این مرحله فعال نیست.", true);
        if (user.id !== fight.player2.user_id) return answerCallback(this.env, query.id, "فقط بازیکن دوم می‌تواند قدرت ویژه‌اش را انتخاب کند.", true);
        fight.player2.power = power;
        fight.phase = "active";
        await this.saveFight(fight);
        await answerCallback(this.env, query.id, "✅ قدرت ویژه انتخاب شد. دوئل شروع شد!");
        await editText(this.env, chatId, messageId, renderDuelArena(fight), moveKeyboard(fight));
        return;
      }
    }


    if (action === "special") {
      if (parts.length !== 3 || fight.phase !== "active" || !fight.player2) return answerCallback(this.env, query.id, "مبارزه در مرحله انتخاب حرکت نیست.", true);
      const callbackRound = Number(parts[2]);
      if (!Number.isInteger(callbackRound) || callbackRound !== fight.round_number) return answerCallback(this.env, query.id, "این دکمه مربوط به راند قبلی است.", true);
      if (fight.round_number < 4) return answerCallback(this.env, query.id, "⚡ قدرت ویژه در راند ۴ شارژ می‌شود.", true);

      let player;
      if (user.id === fight.player1.user_id) player = fight.player1;
      else if (user.id === fight.player2.user_id) player = fight.player2;
      else return answerCallback(this.env, query.id, "⛔ شما در این مبارزه حضور ندارید.", true);

      if (player.special_used) return answerCallback(this.env, query.id, "⚡ قدرت ویژه‌ات قبلاً استفاده شده است.", true);
      if (player.move) return answerCallback(this.env, query.id, "حرکتت قبلاً ثبت شده و قابل تغییر نیست.", true);

      player.special_used = true;
      player.move = { kind: "special" };
      await this.saveFight(fight);
      const specialLabel = fight.mode === "duel"
        ? `${DUEL_POWERS[player.power].emoji} ${DUEL_POWERS[player.power].name}`
        : SPECIAL_LABELS[player.race];
      await answerCallback(this.env, query.id, `⚡ ${specialLabel} ثبت شد.`);

      if (!fight.player1.move || !fight.player2.move) return;

      if (fight.mode === "duel") {
        await this.resolveDuelTurn(fight, chatId, messageId);
        return;
      }

      const outcome = resolveRound(fight.player1, fight.player2);
      fight.player1.hp = Math.min(MAX_HP, Math.max(0, fight.player1.hp - outcome.p1Damage + outcome.p1Heal));
      fight.player2.hp = Math.min(MAX_HP, Math.max(0, fight.player2.hp - outcome.p2Damage + outcome.p2Heal));
      fight.last_result = outcome.lines;
      const roundImage = pickRoundImage(outcome);
      const winner = winnerFromHp(fight.player1.hp, fight.player2.hp);

      if (winner !== null) {
        fight.phase = "finished";
        const scoreText = await this.recordResultAndFormat(fight, winner);
        await updateRoundMessage(this.env, fight, chatId, messageId, renderFinished(fight, winner) + scoreText, null, roundImage);
        await this.saveFight(fight);
        return;
      }

      fight.player1.move = null;
      fight.player2.move = null;
      fight.round_number += 1;

      const poisonLines = [];
      for (const playerToProcess of [fight.player1, fight.player2]) {
        if (playerToProcess.poison_damage > 0) {
          const poison = playerToProcess.poison_damage;
          playerToProcess.hp = Math.max(0, playerToProcess.hp - poison);
          playerToProcess.poison_damage = 0;
          poisonLines.push(`☠️ پوشن روی ${displayName(playerToProcess)} اثر کرد: -${poison} HP.`);
        }
      }
      if (poisonLines.length) fight.last_result.push(...poisonLines);
      if (fight.round_number === 4) fight.last_result.push("⚡ قدرت‌های ویژه شارژ شدند! از راند ۴ هر بازیکن فقط یک بار می‌تواند از آن استفاده کند.");

      const poisonWinner = winnerFromHp(fight.player1.hp, fight.player2.hp);
      if (poisonWinner !== null) {
        fight.phase = "finished";
        const scoreText = await this.recordResultAndFormat(fight, poisonWinner);
        await updateRoundMessage(this.env, fight, chatId, messageId, renderFinished(fight, poisonWinner) + scoreText, null, roundImage);
        await this.saveFight(fight);
        return;
      }

      await updateRoundMessage(this.env, fight, chatId, messageId, renderArena(fight), moveKeyboard(fight), roundImage);
      await this.saveFight(fight);
      return;
    }

    if (action === "move") {
      if (parts.length !== 5 || fight.phase !== "active" || !fight.player2) return answerCallback(this.env, query.id, "مبارزه در مرحله انتخاب حرکت نیست.", true);
      const callbackRound = Number(parts[2]);
      const kind = parts[3];
      const location = parts[4];
      if (!Number.isInteger(callbackRound) || callbackRound !== fight.round_number) return answerCallback(this.env, query.id, "این دکمه مربوط به راند قبلی است.", true);
      if (!["attack", "defend"].includes(kind) || !["head", "body", "leg"].includes(location)) return answerCallback(this.env, query.id, "حرکت نامعتبر است.", true);

      let player;
      if (user.id === fight.player1.user_id) player = fight.player1;
      else if (user.id === fight.player2.user_id) player = fight.player2;
      else return answerCallback(this.env, query.id, "⛔ شما در این مبارزه حضور ندارید.", true);

      if (player.move) return answerCallback(this.env, query.id, "حرکتت قبلاً ثبت شده و قابل تغییر نیست.", true);
      player.move = { kind, location };
      await this.saveFight(fight);
      await answerCallback(this.env, query.id, `✅ ثبت شد: ${MOVE_LABELS[`${kind}:${location}`]}`);

      if (!fight.player1.move || !fight.player2.move) return;

      if (fight.mode === "duel") {
        await this.resolveDuelTurn(fight, chatId, messageId);
        return;
      }

      const outcome = resolveRound(fight.player1, fight.player2);
      fight.player1.hp = Math.min(MAX_HP, Math.max(0, fight.player1.hp - outcome.p1Damage + outcome.p1Heal));
      fight.player2.hp = Math.min(MAX_HP, Math.max(0, fight.player2.hp - outcome.p2Damage + outcome.p2Heal));
      fight.last_result = outcome.lines;
      const roundImage = pickRoundImage(outcome);
      const winner = winnerFromHp(fight.player1.hp, fight.player2.hp);

      if (winner !== null) {
        fight.phase = "finished";
        const scoreText = await this.recordResultAndFormat(fight, winner);
        await updateRoundMessage(this.env, fight, chatId, messageId, renderFinished(fight, winner) + scoreText, null, roundImage);
        await this.saveFight(fight);
        return;
      }

      fight.player1.move = null;
      fight.player2.move = null;
      fight.round_number += 1;

      const poisonLines = [];
      for (const playerToProcess of [fight.player1, fight.player2]) {
        if (playerToProcess.poison_damage > 0) {
          const poison = playerToProcess.poison_damage;
          playerToProcess.hp = Math.max(0, playerToProcess.hp - poison);
          playerToProcess.poison_damage = 0;
          poisonLines.push(`☠️ پوشن روی ${displayName(playerToProcess)} اثر کرد: -${poison} HP.`);
        }
      }
      if (poisonLines.length) fight.last_result.push(...poisonLines);
      if (fight.round_number === 4) fight.last_result.push("⚡ قدرت‌های ویژه شارژ شدند! از راند ۴ هر بازیکن فقط یک بار می‌تواند از آن استفاده کند.");

      const poisonWinner = winnerFromHp(fight.player1.hp, fight.player2.hp);
      if (poisonWinner !== null) {
        fight.phase = "finished";
        const scoreText = await this.recordResultAndFormat(fight, poisonWinner);
        await updateRoundMessage(this.env, fight, chatId, messageId, renderFinished(fight, poisonWinner) + scoreText, null, roundImage);
        await this.saveFight(fight);
        return;
      }

      await updateRoundMessage(this.env, fight, chatId, messageId, renderArena(fight), moveKeyboard(fight), roundImage);
      await this.saveFight(fight);
      return;
    }

    await answerCallback(this.env, query.id, "دکمه ناشناخته است.", true);
  }
}

function validSetupKey(request, env) {
  const url = new URL(request.url);
  return Boolean(env.SETUP_KEY) && url.searchParams.get("key") === env.SETUP_KEY;
}

async function setupTelegramWebhook(request, env) {
  if (!validSetupKey(request, env)) return new Response("Forbidden", { status: 403 });
  if (!env.BOT_TOKEN || !env.WEBHOOK_SECRET) return Response.json({ ok: false, error: "BOT_TOKEN or WEBHOOK_SECRET is missing." }, { status: 500 });

  const origin = new URL(request.url).origin;
  const webhookUrl = `${origin}/telegram`;
  const webhook = await telegramApi(env, "setWebhook", {
    url: webhookUrl,
    secret_token: env.WEBHOOK_SECRET,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
  const commands = await telegramApi(env, "setMyCommands", {
    commands: [
      { command: "fight", description: "شروع یک مبارزه‌ی نژادی" },
      { command: "duel", description: "شروع یک دوئل با قدرت‌های ویژه‌ی انتخابی" },
      { command: "cancel", description: "لغو بازی‌ای که شروع کرده‌اید" },
    ],
  });
  return Response.json({ ok: Boolean(webhook), webhook_url: webhookUrl, commands_set: Boolean(commands) });
}

async function webhookInfo(request, env) {
  if (!validSetupKey(request, env)) return new Response("Forbidden", { status: 403 });
  const info = await telegramApi(env, "getWebhookInfo");
  return Response.json({ ok: Boolean(info), result: info });
}

async function removeWebhook(request, env) {
  if (!validSetupKey(request, env)) return new Response("Forbidden", { status: 403 });
  const result = await telegramApi(env, "deleteWebhook", { drop_pending_updates: false });
  return Response.json({ ok: Boolean(result), result });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response("Fight Castle is online.\nTelegram webhook mode: Cloudflare Workers + Durable Objects.", {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    if (request.method === "GET" && url.pathname === "/setup") return setupTelegramWebhook(request, env);
    if (request.method === "GET" && url.pathname === "/webhook-info") return webhookInfo(request, env);
    if (request.method === "GET" && url.pathname === "/remove-webhook") return removeWebhook(request, env);

    if (request.method === "POST" && url.pathname === "/telegram") {
      const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (!env.WEBHOOK_SECRET || secret !== env.WEBHOOK_SECRET) return new Response("Forbidden", { status: 403 });

      let update;
      try { update = await request.json(); }
      catch { return new Response("Bad Request", { status: 400 }); }

      const chatId = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id ?? null;
      if (chatId === null) return new Response("ignored");

      const id = env.FIGHT_ROOMS.idFromName(String(chatId));
      const room = env.FIGHT_ROOMS.get(id);
      return room.fetch("https://fight-room.internal/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(update),
      });
    }

    return new Response("Not Found", { status: 404 });
  },
};
