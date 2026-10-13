---
name: "api-discovery-tester"
description: "ابزار کشف خودکار وب‌سرویس‌های فرانت‌اند و پنل تست تعاملی. اسکن کدهای کلاینت شبکه، اولویت‌بندی ورود (Login #1)، تولید خودکار apis.md و اجرای پنل پیش‌ساخته انگلیسی برای آزمون امن وب‌سرویس‌ها."
compatibility: "نیازمند محیط اجرای Node.js نسخه 18 یا بالاتر"
metadata:
  author: "Antigravity"
  version: "1.1.0"
---

# مهارت کشف و آزمون خودکار وب‌سرویس‌های فرانت‌اند (API Discovery & Tester)

این مهارت فراخوانی‌های شبکه پروژه فرانت‌اند یا موبایل را اسکن کرده، وب‌سرویس‌های معتبر را استخراج می‌کند، لاگین را در رتبه ۱ ترتیب اجرا قرار می‌دهد، مستند جامع `apis.md` را تولید کرده و پنل وب پیش‌ساخته استاندارد (کاملاً به زبان انگلیسی با دیزاین Developer Workbench) را در آدرس محلی برای تست ایمن وب‌سرویس‌ها بالا می‌آورد.

> [!NOTE]
> در محیط `agy` (Antigravity)، مهارت‌های اختصاصی از طریق پرامپت متنی (Natural Language) یا اجرای مستقیم CLI فعال می‌شوند و نیازی به اسلش‌کامند نیست.

---

## عبارت‌های فراخوانی (Natural Language Triggers)

- «وب‌سرویس‌های پروژه رو اسکن و تست کن»
- «پنل تست API را باز کن»
- «اسکن APIهای فرانت‌اند و اجرای workbench تست»
- "Scan APIs and open tester workbench"

یا اجرای مستقیم از طریق خط فرمان:
```bash
node .agents/skills/api-discovery-tester/bin/cli.js
```

---

## وظایف ایجنت هنگام فعال شدن مهارت

هنگامی که کاربر درخواست اسکن و تست APIهای پروژه را می‌دهد:

### گام ۱: اسکن پروژه فرانت‌اند
اسکریپت اسکنر را اجرا کنید تا فایل‌های محیطی (`.env*`)، کانفیگ‌ها (`vite`, `next`) و کلاینت‌های شبکه (Ktor, Retrofit, Axios, Fetch, RTK Query) تحلیل شوند:
```bash
node -e "import('./.agents/skills/api-discovery-tester/scripts/scanner.js').then(m => { const manifest = m.scanProject(process.cwd()); import('./.agents/skills/api-discovery-tester/scripts/manifest-helper.js').then(h => { h.saveManifest(manifest); h.saveApisMarkdown(manifest); console.log(JSON.stringify({ status: 'ok', count: manifest.endpoints.length })); }); });"
```

### گام ۲: اولویت‌بندی لاگین و وابستگی‌ها
- وب‌سرویس ورود (`POST /v1/auth/login` یا معادل‌های آن) همواره در رتبه اول (`executionOrder: 1`) قرار دارد.
- آدرس‌های نامرتبط (فایل‌های دارایی، اسکیمای XML، و هاست‌های متفرقه) فیلتر شده‌اند.
- مانیفست تمیز در `.api-tester/discovery.json` و مستند در `apis.md` ثبت می‌شود.

### گام ۳: راه‌اندازی پنل پیش‌ساخته (Pre-built Workbench)
پنل وب آماده و بهینه‌شده به زبان انگلیسی را بالا بیاورید:
```bash
node -e "import('./.agents/skills/api-discovery-tester/panel/server.js').then(m => { const s = m.createPanelServer({ autoOpen: true }); s.start().then(info => console.log('SERVER_READY: ' + info.url)); });"
```

### گام ۴: گزارش به کاربر
به طور شفاف و کوتاه به کاربر گزارش دهید:
1. تعداد وب‌سرویس‌های معتبر کشف‌شده و قرارگیری لاگین در صدر لیست.
2. آدرس مستندات تولیدشده در [`apis.md`](file:///c:/Users/Mahdi/StudioProjects/Tester/apis.md).
3. اجرای پنل تست در `http://localhost:3456` با دراور بازبینی (Inspector Drawer) و گزینش خودکار متدهای ایمن.
