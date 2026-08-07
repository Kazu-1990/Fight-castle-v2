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

function joinKeyboard(fight) {
  return {
    inline_keyboard: [[{ text: "⚔️ قبول مبارزه", callback_data: `join|${fight.token}` }]],
  };
}

function moveKeyboard(fight) {
  const t = fight.token;
  const r = fight.round_number;
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
      [{ text: "🔄 رفرش راند", callback_data: `refresh|${t}|${r}` }],
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

function renderWaiting(fight) {
  const p = fight.player1;
  return (
    "⚔️ <b>FIGHT ARENA</b>\n\n" +
    `🥇 ${mentionHtml(p)} — <b>${raceText(p)}</b>\n\n` +
    "✅ بازیکن اول آماده است.\n⏳ منتظر نفر دوم...\n\n" +
    "برای ورود به مبارزه دکمه زیر را بزن."
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

function resolveRound(p1Move, p2Move) {
  let p1Damage = 0;
  let p2Damage = 0;
  const lines = [];

  if (p1Move.kind === "attack" && p2Move.kind === "attack") {
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
    lines.push("🛡 هر دو بازیکن دفاع کردند؛ این راند بدون آسیب تمام شد.");
  }

  return { p1Damage, p2Damage, lines };
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

    if (cmd === "/start" || cmd === "/fight") {
      if (chat.type !== "group" && chat.type !== "supergroup") {
        await sendText(this.env, chat.id, "⚔️ این بازی برای گروه ساخته شده.\nربات را به یک گروه اضافه کن و /fight را بزن.");
        return;
      }

      const current = await this.getFight();
      if (current && current.phase !== "finished") {
        await sendText(this.env, chat.id, "⛔ در این گروه یک مبارزه فعال وجود دارد.\nبرای لغو، بازیکن اول می‌تواند /cancel را بزند.");
        return;
      }

      const fight = {
        chat_id: chat.id,
        token: randomToken(),
        player1: makePlayer(user),
        player2: null,
        phase: "p1_race",
        round_number: 1,
        message_id: null,
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

    if (cmd === "/cancel") {
      const fight = await this.getFight();
      if (!fight || fight.phase === "finished") {
        await sendText(this.env, chat.id, "ℹ️ مبارزه فعالی وجود ندارد.");
        return;
      }
      if (user.id !== fight.player1.user_id) {
        await sendText(this.env, chat.id, "⛔ فقط بازیکنی که مبارزه را شروع کرده می‌تواند آن را لغو کند.");
        return;
      }
      await this.clearFight();
      await sendText(this.env, chat.id, "🛑 مبارزه لغو شد. برای بازی جدید /fight را بزن.");
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
      fight.player2 = makePlayer(user);
      fight.phase = "p2_race";
      await this.saveFight(fight);
      await answerCallback(this.env, query.id, "⚔️ وارد مبارزه شدی!");
      await editText(this.env, chatId, messageId, renderP2Race(fight), raceKeyboard(fight, "p2"));
      return;
    }

    if (action === "refresh") {
      if (parts.length !== 3 || fight.phase !== "active" || !fight.player2) return answerCallback(this.env, query.id, "الان راند فعالی برای رفرش وجود ندارد.", true);
      const callbackRound = Number(parts[2]);
      if (!Number.isInteger(callbackRound) || callbackRound !== fight.round_number) return answerCallback(this.env, query.id, "این دکمه مربوط به راند قبلی است.", true);
      if (user.id !== fight.player1.user_id && user.id !== fight.player2.user_id) return answerCallback(this.env, query.id, "⛔ فقط بازیکنان همین مبارزه می‌توانند راند را رفرش کنند.", true);
      fight.player1.move = null;
      fight.player2.move = null;
      await this.saveFight(fight);
      await answerCallback(this.env, query.id, "🔄 انتخاب هر دو بازیکن پاک شد. دوباره حرکتتان را انتخاب کنید.");
      await editText(this.env, chatId, messageId, renderArena(fight), moveKeyboard(fight));
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

      const outcome = resolveRound(fight.player1.move, fight.player2.move);
      fight.player1.hp -= outcome.p1Damage;
      fight.player2.hp -= outcome.p2Damage;
      fight.last_result = outcome.lines;
      const winner = winnerFromHp(fight.player1.hp, fight.player2.hp);

      if (winner !== null) {
        fight.phase = "finished";
        await this.saveFight(fight);
        await editText(this.env, chatId, messageId, renderFinished(fight, winner));
        return;
      }

      fight.player1.move = null;
      fight.player2.move = null;
      fight.round_number += 1;
      await this.saveFight(fight);
      await editText(this.env, chatId, messageId, renderArena(fight), moveKeyboard(fight));
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
      { command: "fight", description: "شروع یک مبارزه جدید" },
      { command: "start", description: "شروع بازی" },
      { command: "cancel", description: "لغو مبارزه‌ای که شروع کرده‌اید" },
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
