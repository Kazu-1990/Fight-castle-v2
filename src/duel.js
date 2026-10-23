// دوئل مرگ: وقتی HP هر دو نفر در یک راند به صفر برسد، به‌جای مساوی این بازی شروع می‌شود.
// سنگ کاغذ قیچی: مشت (سنگ) / دفاع (کاغذ) / جادو (قیچی). هر کس یک راند ببرد، برنده کل مبارزه است.

export const DUEL_LABELS = {
  fist: "👊 مشت",
  defend: "🛡 دفاع",
  magic: "🔮 جادو",
};

// کلید، حریفی را که می‌برد نشان می‌دهد
const BEATS = { fist: "magic", defend: "fist", magic: "defend" };

// 0 = مساوی، 1 = بازیکن اول، 2 = بازیکن دوم
export function duelWinner(move1, move2) {
  if (move1 === move2) return 0;
  return BEATS[move1] === move2 ? 1 : 2;
}

export function duelResultLines(move1, move2, winner) {
  const lines = [`بازیکن ۱: ${DUEL_LABELS[move1]} | بازیکن ۲: ${DUEL_LABELS[move2]}`];
  if (winner === 0) lines.push("🤝 این راند مساوی شد؛ راند بعدی دوئل!");
  else lines.push(`🏆 بازیکن ${winner === 1 ? "۱" : "۲"} راند دوئل را برد و برنده مبارزه شد!`);
  return lines;
}

export function startDuel(fight) {
  fight.phase = "duel";
  fight.duel = { round: 1 };
  fight.player1.duel_move = null;
  fight.player2.duel_move = null;
}

export function duelKeyboard(fight) {
  const t = fight.token;
  const r = fight.duel.round;
  return {
    inline_keyboard: [[
      { text: DUEL_LABELS.fist, callback_data: `duel|${t}|${r}|fist` },
      { text: DUEL_LABELS.defend, callback_data: `duel|${t}|${r}|defend` },
      { text: DUEL_LABELS.magic, callback_data: `duel|${t}|${r}|magic` },
    ]],
  };
}

// p1Label / p2Label: متن آماده نژاد + اسم هر بازیکن (از index.js می‌آید)
export function renderDuel(fight, p1Label, p2Label, escapeHtml) {
  let text =
    "☠️ <b>DEATH DUEL — دوئل مرگ</b>\n\n" +
    "💀 HP هر دو نفر به صفر رسید!\n" +
    "هر کس یک راند ببرد، برنده کل مبارزه است.\n\n" +
    `🔁 <b>راند دوئل: ${fight.duel.round}</b>\n\n` +
    `${p1Label}\n${p2Label}\n\n`;

  if (fight.last_result?.length) {
    text += "📜 <b>نتیجه قبل</b>\n" + fight.last_result.map(escapeHtml).join("\n") + "\n\n";
  }

  text +=
    "📖 <b>قوانین</b>\n" +
    "👊 مشت ← جادو را می‌شکند (مشت می‌برد)\n" +
    "🛡 دفاع ← مشت را دفع می‌کند (دفاع می‌برد)\n" +
    "🔮 جادو ← دفاع را می‌شکند (جادو می‌برد)\n" +
    "انتخاب یکسان = مساوی و راند دوئل تکرار می‌شود.\n\n" +
    "🎯 <b>انتخابت را بزن.</b> انتخاب شما تا ثبت حرکت حریف مخفی می‌ماند.";
  return text;
}
