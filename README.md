# Fight Castle — Cloudflare Edition

این نسخه از Telegram Webhook و Cloudflare Workers + Durable Objects استفاده می‌کند.

## مزیت‌ها
- بدون Long Polling
- هر گروه یک Durable Object مستقل
- Fight فعال، HP، Round، Race و انتخاب‌های ثبت‌شده در Storage پایدار ذخیره می‌شوند
- Restart یا جابه‌جایی Worker باعث پاک‌شدن Fight نمی‌شود
- دکمه `🔄 رفرش راند` باقی مانده
- گروه‌های مختلف می‌توانند همزمان Fight جدا داشته باشند

## قوانین
- HP: 200
- Head: 30
- Body: 20
- Leg: 15
- دفاع درست: Damage صفر و مهاجم Damage-5 می‌خورد
- Attack vs Attack: هر دو ضربه اعمال می‌شوند
- Defense vs Defense: بدون Damage
- اگر هر دو <= 0 شوند، HP بالاتر برنده؛ مساوی = Draw

## Secrets مورد نیاز در Cloudflare
سه Secret/Variable بساز:

1. `BOT_TOKEN` = توکن واقعی BotFather
2. `WEBHOOK_SECRET` = رشته تصادفی فقط با A-Z a-z 0-9 _ -
3. `SETUP_KEY` = یک رمز طولانی خصوصی برای مسیر setup

هیچ‌کدام را داخل GitHub نگذار.

## بعد از Deploy
اگر Worker URL تو مثلاً این بود:

`https://fight-castle.YOUR-SUBDOMAIN.workers.dev`

Webhook را با این مسیر ثبت کن:

`https://fight-castle.YOUR-SUBDOMAIN.workers.dev/setup?key=YOUR_SETUP_KEY`

برای بررسی:

`https://fight-castle.YOUR-SUBDOMAIN.workers.dev/webhook-info?key=YOUR_SETUP_KEY`

برای حذف Webhook:

`https://fight-castle.YOUR-SUBDOMAIN.workers.dev/remove-webhook?key=YOUR_SETUP_KEY`

وقتی Webhook فعال است، نسخه Termux/Back4app را با همان Bot Token روشن نکن.
