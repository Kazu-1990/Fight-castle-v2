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
