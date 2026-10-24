// آیتم‌ها: سلاح، آرمور، Resolver و God Effect
// هر نفر حداکثر یک Weapon (lvl 1..3)، یک Armor (lvl 1..3)، یک Resolver و یک God Effect دارد.

export const BASE_STATS = {
  max_hp: 200,
  atk: { head: 30, body: 20, leg: 15 },
  def: { head: 30, body: 20, leg: 15 }, // دمیجی که دفاع درست به حمله‌کننده برمی‌گرداند
};

const WEAPON_BONUS = [0, 5, 10, 20];
const ARMOR_BONUS = [0, 25, 50, 100];
const RESOLVER_DEF = { head: 45, body: 35, leg: 30 };
const GOD_HP = 100;
const GOD_ATK = 20;

// کلید دکمه -> آیتم
export const ITEM_DEFS = {
  w1: { slot: "weapon", level: 1, label: "Weapon lvl 1" },
  w2: { slot: "weapon", level: 2, label: "Weapon lvl 2" },
  w3: { slot: "weapon", level: 3, label: "Weapon lvl 3" },
  a1: { slot: "armor", level: 1, label: "Armor lvl 1" },
  a2: { slot: "armor", level: 2, label: "Armor lvl 2" },
  a3: { slot: "armor", level: 3, label: "Armor lvl 3" },
  res: { slot: "resolver", label: "Resolver" },
  god: { slot: "god", label: "God Effect" },
};

export function emptyItems() {
  return { weapon: 0, armor: 0, resolver: false, god: false };
}

export function normalizeItems(items) {
  const i = items || {};
  const lvl = (v) => Math.max(0, Math.min(3, Math.trunc(Number(v)) || 0));
  return { weapon: lvl(i.weapon), armor: lvl(i.armor), resolver: Boolean(i.resolver), god: Boolean(i.god) };
}

export function itemLabels(items) {
  const i = normalizeItems(items);
  const out = [];
  if (i.weapon) out.push(`Weapon lvl ${i.weapon}`);
  if (i.armor) out.push(`Armor lvl ${i.armor}`);
  if (i.resolver) out.push("Resolver");
  if (i.god) out.push("God Effect");
  return out;
}

export function inventoryText(items) {
  const labels = itemLabels(items);
  return labels.length ? labels.map((l) => `• ${l}`).join("\n") : "خالی است";
}

// آمار نهایی مبارزه از روی آیتم‌ها
export function statsFromItems(items) {
  const i = normalizeItems(items);
  const atkBonus = WEAPON_BONUS[i.weapon] + (i.god ? GOD_ATK : 0);
  const def = i.resolver ? { ...RESOLVER_DEF } : { ...BASE_STATS.def };
  return {
    max_hp: BASE_STATS.max_hp + ARMOR_BONUS[i.armor] + (i.god ? GOD_HP : 0),
    atk: {
      head: BASE_STATS.atk.head + atkBonus,
      body: BASE_STATS.atk.body + atkBonus,
      leg: BASE_STATS.atk.leg + atkBonus,
    },
    def,
  };
}

// اضافه کردن آیتم؛ آیتم هم‌نوع قبلی (مثلاً سلاح) جایگزین می‌شود
export function applyItem(items, key) {
  const def = ITEM_DEFS[key];
  if (!def) return null;
  const next = normalizeItems(items);
  const before = itemLabels(next);
  if (def.slot === "weapon" || def.slot === "armor") {
    if (next[def.slot] === def.level) return { already: true, items: next, label: def.label };
    const previous = next[def.slot] ? `${def.slot === "weapon" ? "Weapon" : "Armor"} lvl ${next[def.slot]}` : null;
    next[def.slot] = def.level;
    return { already: false, items: next, label: def.label, previous };
  }
  if (next[def.slot]) return { already: true, items: next, label: def.label };
  next[def.slot] = true;
  return { already: false, items: next, label: def.label, previous: null, before };
}

export function shopKeyboard(uid) {
  const b = (key) => ({ text: ITEM_DEFS[key].label, callback_data: `shop|${uid}|${key}` });
  return {
    inline_keyboard: [
      [b("w1"), b("w2"), b("w3")],
      [b("a1"), b("a2"), b("a3")],
      [b("res")],
      [b("god")],
    ],
  };
}
