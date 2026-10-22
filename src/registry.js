// داده‌های ثبت‌نام و لاگ‌ها.
// همه چیز داخل یک Durable Object مشترک (با نام REGISTRY_NAME) ذخیره می‌شود؛
// از همان باندینگ FIGHT_ROOMS استفاده می‌کنیم، پس نیازی به تغییر wrangler نیست.

export const REGISTRY_NAME = "__registry__";
export const LOG_TTL_MS = 48 * 60 * 60 * 1000;
export const FAMILIES = ["Stalker", "Scott", "Evans"];
export const REG_RACES = ["Vampire", "Elf", "Witcher", "Werewolf"];
// نژاد ثبت‌نام -> کلید نژاد در موتور بازی
export const REG_RACE_TO_KEY = { Vampire: "vamp", Elf: "elf", Witcher: "witcher", Werewolf: "wolf" };
export const NAME_RE = /^[A-Za-z]+(?:[ '\-][A-Za-z]+)*$/;
export const MAX_NAME = 32;

const TIME_ZONE = "Asia/Tehran";

export function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function formatTime(ms) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(ms);
}

export function parseCommand(text) {
  if (!text || !text.startsWith("/")) return null;
  return text.trim().split(/\s+/)[0].split("@")[0].toLowerCase();
}

// پیام را به چند تکه (زیر محدودیت ۴۰۹۶ کاراکتر تلگرام) تقسیم می‌کند
export function chunkLines(lines, max = 3800) {
  const chunks = [];
  let current = "";
  for (const line of lines) {
    if (current && current.length + line.length + 1 > max) {
      chunks.push(current);
      current = "";
    }
    current += (current ? "\n" : "") + line;
  }
  if (current) chunks.push(current);
  return chunks;
}

export function registryStub(env) {
  return env.FIGHT_ROOMS.get(env.FIGHT_ROOMS.idFromName(REGISTRY_NAME));
}

// صدا زدن رجیستری از اتاق‌های گروه
export async function callRegistry(env, op, data = {}) {
  try {
    const res = await registryStub(env).fetch(`https://registry.internal/op/${op}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
    return await res.json();
  } catch (error) {
    console.error(`Registry ${op} failed:`, error?.message || String(error));
    return null;
  }
}

let cachedBotUsername = null;
export async function getBotUsername(env, tg) {
  if (env.BOT_USERNAME) return String(env.BOT_USERNAME).replace(/^@/, "");
  if (cachedBotUsername) return cachedBotUsername;
  const me = await tg.telegramApi(env, "getMe");
  cachedBotUsername = me?.username || null;
  return cachedBotUsername;
}

// پیام «اول ثبت‌نام کن» با دکمه لینک به پیوی ربات
export async function sendRegisterPrompt(env, tg, chatId, user) {
  const username = await getBotUsername(env, tg);
  const who = `<a href="tg://user?id=${user.id}">${esc(user.username ? "@" + user.username : user.first_name || "کاربر")}</a>`;
  const text = `📝 ${who}\nبرای استفاده از ربات باید ابتدا داخل ربات ثبت‌نام کنید.\nروی دکمه زیر بزنید تا به پیوی ربات منتقل شوید.`;
  const markup = username
    ? { inline_keyboard: [[{ text: "📝 ثبت‌نام", url: `https://t.me/${username}?start=register` }]] }
    : undefined;
  return tg.sendText(env, chatId, text, markup);
}

function logKey(t) {
  return `log:${String(t).padStart(15, "0")}:${Math.random().toString(36).slice(2, 8)}`;
}

function logLine(entry) {
  const time = formatTime(entry.t);
  if (entry.type === "register") return `🆕 ${time} — آیدی ${entry.uid} ثبت‌نام کرد.`;
  if (entry.type === "edit") return `✏️ ${time} — آیدی ${entry.uid} پروفایلش را ویرایش کرد.`;
  if (entry.type === "delete") return `🗑 ${time} — آیدی ${entry.uid} آیدی ${entry.target} را حذف کرد.`;
  if (entry.type === "cancel") return `🛑 ${time} — آیدی ${entry.uid} مبارزه را کنسل کرد.`;
  if (entry.type === "fight") {
    const result = entry.winner ? `آیدی ${entry.winner} برنده شد.` : "مبارزه مساوی شد.";
    return `⚔️ ${time} — آیدی ${entry.p1} با آیدی ${entry.p2} مبارزه کرد و ${result}`;
  }
  return `${time} — ${entry.type}`;
}

export function formatLogMessages(entries) {
  if (!entries.length) return ["ℹ️ در ۴۸ ساعت گذشته رویدادی ثبت نشده است."];
  const lines = ["📜 <b>لاگ ۴۸ ساعت گذشته</b> (به وقت تهران)", ""].concat(entries.map((e) => esc(logLine(e))));
  return chunkLines(lines);
}

export class Registry {
  constructor(storage) {
    this.s = storage;
  }

  async getUser(id) {
    return (await this.s.get(`user:${id}`)) || null;
  }
  async putUser(user) {
    await this.s.put(`user:${user.user_id}`, user);
  }
  async allUsers() {
    const map = await this.s.list({ prefix: "user:" });
    return [...map.values()].sort((a, b) => a.registered_at - b.registered_at || a.user_id - b.user_id);
  }

  async getPending(id) {
    return (await this.s.get(`pending:${id}`)) || null;
  }
  async setPending(id, pending) {
    await this.s.put(`pending:${id}`, pending);
  }
  async clearPending(id) {
    await this.s.delete(`pending:${id}`);
  }

  async getSnapshot(staffId) {
    return (await this.s.get(`snap:${staffId}`)) || [];
  }
  async setSnapshot(staffId, ids) {
    await this.s.put(`snap:${staffId}`, ids);
  }

  async deleteKeys(keys) {
    for (let i = 0; i < keys.length; i += 128) await this.s.delete(keys.slice(i, i + 128));
  }

  async pruneLogs() {
    const cutoff = String(Date.now() - LOG_TTL_MS).padStart(15, "0");
    const old = await this.s.list({ prefix: "log:", end: `log:${cutoff}` });
    if (old.size) await this.deleteKeys([...old.keys()]);
  }

  async addLog(entry) {
    await this.pruneLogs();
    const t = Date.now();
    await this.s.put(logKey(t), { t, ...entry });
  }

  async readLogs() {
    await this.pruneLogs();
    const map = await this.s.list({ prefix: "log:" });
    return [...map.values()].sort((a, b) => a.t - b.t);
  }

  // پاک کردن پروفایل کاربر (لاگ‌ها دست نمی‌خورند)
  async deleteUser(id) {
    const uid = Number(id);
    await this.s.delete(`user:${uid}`);
    await this.s.delete(`pending:${uid}`);
  }
}
