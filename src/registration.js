// ثبت‌نام، /edit، /list، /log و حذف کاربر (همه در پیوی ربات)
// این فایل داخل Durable Object رجیستری اجرا می‌شود.

import { isStaff } from "./staff.js";
import {
  Registry,
  FAMILIES,
  REG_RACES,
  NAME_RE,
  MAX_NAME,
  esc,
  formatTime,
  parseCommand,
  chunkLines,
  formatLogMessages,
} from "./registry.js";

const OFF_TEXT = "⛔ کارمند، ربات را خاموش کرده است.";
const GROUP_ONLY_TEXT = "⚔️ این بازی برای گروه ساخته شده.\nربات را به یک گروه اضافه کن و /fight را بزن.";

function toEnglishDigits(value) {
  return value.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
}

function familyKeyboard() {
  return { inline_keyboard: [FAMILIES.map((f) => ({ text: f, callback_data: `rg|f|${f}` }))] };
}

function raceKeyboard() {
  const buttons = REG_RACES.map((r) => ({ text: r, callback_data: `rg|r|${r}` }));
  return { inline_keyboard: [buttons.slice(0, 2), buttons.slice(2, 4)] };
}

async function startRegistration(reg, env, tg, chatId, userId, mode) {
  await reg.setPending(userId, { step: "name", mode });
  const intro =
    mode === "edit"
      ? "✏️ <b>ویرایش پروفایل</b>\nاطلاعات قبلی‌ات تا پایان ویرایش معتبر می‌ماند.\n\n"
      : "📝 <b>ثبت‌نام</b>\n\n";
  await tg.sendText(env, chatId, intro + "اسمت را به <b>انگلیسی</b> بفرست:");
}

async function handleName(reg, env, tg, chatId, userId, pending, text) {
  if (text.length > MAX_NAME || !NAME_RE.test(text)) {
    await tg.sendText(env, chatId, `❌ اسم باید فقط انگلیسی باشد (حروف A-Z، حداکثر ${MAX_NAME} کاراکتر). دوباره بفرست:`);
    return;
  }
  pending.name = text;
  pending.step = "family";
  await reg.setPending(userId, pending);
  await tg.sendText(env, chatId, `✅ اسم: <b>${esc(text)}</b>\n\nخاندانت را انتخاب کن:`, familyKeyboard());
}

async function sendList(reg, env, tg, chatId, staffId) {
  const users = await reg.allUsers();
  await reg.setSnapshot(staffId, users.map((u) => u.user_id));
  if (!users.length) {
    await tg.sendText(env, chatId, "ℹ️ هنوز کسی ثبت‌نام نکرده است.");
    return;
  }
  const lines = [`📋 <b>ثبت‌نام‌شده‌ها: ${users.length}</b> (به وقت تهران)`, ""];
  users.forEach((u, i) => {
    lines.push(`${i + 1}. ${esc(u.name)}، ${esc(u.family)}، ${esc(u.race)}، ${formatTime(u.registered_at)}`);
  });
  lines.push("", "برای حذف: «حذف شماره» مثلاً: حذف 3");
  for (const chunk of chunkLines(lines)) await tg.sendText(env, chatId, chunk);
}

async function toggleBot(reg, env, tg, chatId, userId, wantOn) {
  const enabled = await reg.isEnabled();
  if (enabled === wantOn) {
    await tg.sendText(env, chatId, wantOn ? "ℹ️ ربات در حال حاضر روشن است." : "ℹ️ ربات در حال حاضر خاموش است.");
    return;
  }
  await reg.setEnabled(wantOn);
  await reg.addLog({ type: wantOn ? "on" : "off", uid: userId });
  await tg.sendText(env, chatId, wantOn ? "🟢 ربات روشن شد و به حالت عادی برگشت." : "🔴 ربات خاموش شد. ثبت‌نام و مبارزه تا زمان /on غیرفعال است.");
}

async function sendLogs(reg, env, tg, chatId) {
  const entries = await reg.readLogs();
  for (const chunk of formatLogMessages(entries)) await tg.sendText(env, chatId, chunk);
}

async function askDelete(reg, env, tg, chatId, staffId, num) {
  const snapshot = await reg.getSnapshot(staffId);
  const uid = snapshot[num - 1];
  if (!uid) {
    await tg.sendText(env, chatId, "❌ شماره نامعتبر است. اول /list را بزن و از همان لیست شماره بده.");
    return;
  }
  const user = await reg.getUser(uid);
  if (!user) {
    await tg.sendText(env, chatId, "ℹ️ این کاربر دیگر در لیست وجود ندارد.");
    return;
  }
  await tg.sendText(env, chatId, `آیا می‌خواهید <b>${esc(user.name)}</b> را حذف کنید؟`, {
    inline_keyboard: [[
      { text: "✅ بله", callback_data: `del|yes|${uid}` },
      { text: "❌ خیر", callback_data: `del|no|${uid}` },
    ]],
  });
}

async function handlePrivateMessage(reg, env, tg, message) {
  const user = message.from;
  const chatId = message.chat?.id;
  if (!user || chatId === undefined || message.chat.type !== "private") return;

  const text = (message.text || "").trim();
  if (!text) return;
  const cmd = parseCommand(text);
  const staff = isStaff(user.id);

  const profile = await reg.getUser(user.id);
  const pending = await reg.getPending(user.id);

  // یوزرنیم تلگرام ممکن است عوض شده باشد
  if (profile && (profile.username || null) !== (user.username || null)) {
    profile.username = user.username || null;
    await reg.putUser(profile);
  }

  // کارمندها هم باید ثبت‌نام کرده باشند
  if (staff && profile) {
    if (cmd === "/on") return toggleBot(reg, env, tg, chatId, user.id, true);
    if (cmd === "/off") return toggleBot(reg, env, tg, chatId, user.id, false);
    if (cmd === "/board" || cmd === "/reset") {
      await tg.sendText(env, chatId, "ℹ️ این دستور فقط در گروه کار می‌کند.");
      return;
    }
    if (cmd === "/list") return sendList(reg, env, tg, chatId, user.id);
    if (cmd === "/log") return sendLogs(reg, env, tg, chatId);
    const m = text.match(/^حذف\s+([0-9۰-۹]+)$/);
    if (m) return askDelete(reg, env, tg, chatId, user.id, Number(toEnglishDigits(m[1])));
  }

  // وقتی ربات خاموش است هیچ ثبت‌نام یا ویرایشی انجام نمی‌شود
  if (!(await reg.isEnabled())) {
    await tg.sendText(env, chatId, OFF_TEXT);
    return;
  }

  if (cmd === "/edit") {
    return startRegistration(reg, env, tg, chatId, user.id, profile ? "edit" : "new");
  }

  if (cmd === "/start") {
    if (profile) {
      await tg.sendText(env, chatId, "✅ شما قبلاً ثبت‌نام کرده‌اید.\nبرای ویرایش پروفایل /edit را بزنید.\nبرای بازی ربات را به یک گروه اضافه کنید و /fight را بزنید.");
      return;
    }
    return startRegistration(reg, env, tg, chatId, user.id, "new");
  }

  if (cmd) {
    if (!profile) return startRegistration(reg, env, tg, chatId, user.id, "new");
    if (cmd === "/list" || cmd === "/log" || cmd === "/on" || cmd === "/off" || cmd === "/board" || cmd === "/reset") {
      await tg.sendText(env, chatId, "⛔ این دستور فقط برای کارمندان است.");
      return;
    }
    if (cmd === "/fight") await tg.sendText(env, chatId, GROUP_ONLY_TEXT);
    return;
  }

  // متن معمولی
  if (pending?.step === "name") return handleName(reg, env, tg, chatId, user.id, pending, text);
  if (pending) {
    await tg.sendText(env, chatId, "لطفاً از دکمه‌های پیام قبلی استفاده کن.");
    return;
  }
  if (!profile) return startRegistration(reg, env, tg, chatId, user.id, "new");
}

async function handlePrivateCallback(reg, env, tg, query) {
  const parts = (query.data || "").split("|");
  const user = query.from;
  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;
  if (!user || chatId === undefined || !messageId || query.message.chat.type !== "private") return;

  if (parts[0] === "rg") {
    if (!(await reg.isEnabled())) {
      await tg.answerCallback(env, query.id, OFF_TEXT, true);
      return;
    }
    const pending = await reg.getPending(user.id);

    if (parts[1] === "f") {
      if (!pending || pending.step !== "family" || !FAMILIES.includes(parts[2])) {
        await tg.answerCallback(env, query.id, "این مرحله فعال نیست.", true);
        return;
      }
      pending.family = parts[2];
      pending.step = "race";
      await reg.setPending(user.id, pending);
      await tg.answerCallback(env, query.id, "✅ ثبت شد.");
      await tg.editText(env, chatId, messageId, `✅ اسم: <b>${esc(pending.name)}</b>\n✅ خاندان: <b>${esc(pending.family)}</b>\n\nنژادت را انتخاب کن:`, raceKeyboard());
      return;
    }

    if (parts[1] === "r") {
      if (!pending || pending.step !== "race" || !REG_RACES.includes(parts[2])) {
        await tg.answerCallback(env, query.id, "این مرحله فعال نیست.", true);
        return;
      }
      const now = Date.now();
      const existing = await reg.getUser(user.id);
      const record = existing
        ? { ...existing, username: user.username || null, name: pending.name, family: pending.family, race: parts[2], updated_at: now, edits: (existing.edits || 0) + 1 }
        : { user_id: user.id, username: user.username || null, name: pending.name, family: pending.family, race: parts[2], registered_at: now, updated_at: now, edits: 0, games: 0, wins: 0 };
      await reg.putUser(record);
      await reg.clearPending(user.id);
      await reg.addLog({ type: existing ? "edit" : "register", uid: user.id });
      await tg.answerCallback(env, query.id, "✅ ثبت‌نام کامل شد.");
      await tg.editText(
        env, chatId, messageId,
        `${existing ? "✏️ پروفایل ویرایش شد" : "🎉 ثبت‌نام کامل شد"}\n\n` +
          `اسم: <b>${esc(record.name)}</b>\nخاندان: <b>${esc(record.family)}</b>\nنژاد: <b>${esc(record.race)}</b>\n\n` +
          "حالا ربات را به یک گروه اضافه کن و /fight را بزن.",
      );
      return;
    }
  }

  if (parts[0] === "del") {
    if (!isStaff(user.id) || !(await reg.getUser(user.id))) {
      await tg.answerCallback(env, query.id, "⛔ فقط کارمندان ثبت‌نام‌شده.", true);
      return;
    }
    const uid = Number(parts[2]);
    if (parts[1] === "no") {
      await tg.answerCallback(env, query.id, "انصراف داده شد.");
      await tg.editText(env, chatId, messageId, "❎ حذف انجام نشد.");
      return;
    }
    if (parts[1] === "yes") {
      const target = await reg.getUser(uid);
      if (!target) {
        await tg.answerCallback(env, query.id, "این کاربر دیگر وجود ندارد.", true);
        await tg.editText(env, chatId, messageId, "ℹ️ این کاربر قبلاً حذف شده است.");
        return;
      }
      await reg.addLog({ type: "delete", uid: user.id, target: uid });
      await reg.deleteUser(uid);
      await tg.answerCallback(env, query.id, "🗑 حذف شد.");
      await tg.editText(env, chatId, messageId, `🗑 <b>${esc(target.name)}</b> حذف شد.`);
      return;
    }
  }

  await tg.answerCallback(env, query.id, "دکمه ناشناخته است.", true);
}

// ورودی رجیستری؛ از FightRoom.fetch صدا زده می‌شود (hostname = registry.internal)
export async function handleRegistryRequest(storage, env, request, tg) {
  const reg = new Registry(storage);
  const url = new URL(request.url);

  if (url.pathname === "/update") {
    try {
      const update = await request.json();
      if (update.callback_query) await handlePrivateCallback(reg, env, tg, update.callback_query);
      else if (update.message) await handlePrivateMessage(reg, env, tg, update.message);
    } catch (error) {
      console.error("Registry update error:", error?.message || String(error));
    }
    return new Response("ok");
  }

  if (url.pathname.startsWith("/op/")) {
    const op = url.pathname.slice(4);
    let data = {};
    try { data = await request.json(); } catch { /* empty */ }

    if (op === "isRegistered") return Response.json({ registered: Boolean(await reg.getUser(data.user_id)) });
    if (op === "getProfile") {
      const profile = await reg.getUser(data.user_id);
      if (profile && "username" in data && (profile.username || null) !== (data.username || null)) {
        profile.username = data.username || null;
        await reg.putUser(profile);
      }
      return Response.json({ profile, enabled: await reg.isEnabled() });
    }
    if (op === "getBoard") return Response.json({ rows: await reg.getBoard() });
    if (op === "resetBoard") {
      await reg.resetBoard();
      await reg.addLog({ type: "reset", uid: data.by, target: data.confirmer });
      return Response.json({ ok: true });
    }
    if (op === "getState") return Response.json({ enabled: await reg.isEnabled() });
    if (op === "logFight") {
      await reg.recordFight(data.p1, data.p2, data.winner || 0);
      await reg.addLog({ type: "fight", p1: data.p1, p2: data.p2, winner: data.winner || 0 });
      return Response.json({ ok: true });
    }
    if (op === "logCancel") {
      await reg.addLog({ type: "cancel", uid: data.user_id });
      return Response.json({ ok: true });
    }
    if (op === "getLogs") return Response.json({ entries: await reg.readLogs() });
  }

  return new Response("Not Found", { status: 404 });
}
