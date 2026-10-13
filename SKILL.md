---
name: "api-discovery-tester"
description: "ابزار کشف خودکار وب‌سرویس‌های فرانت‌اند و پنل تست تعاملی. اسکن کدهای کلاینت شبکه، تولید خودکار apis.md و اجرای پنل محلی برای آزمون امن وب‌سرویس‌ها."
compatibility: "نیازمند محیط اجرای Node.js نسخه 18 یا بالاتر"
metadata:
  author: "Antigravity"
  version: "1.0.0"
---

# مهارت کشف و آزمون خودکار وب‌سرویس‌های فرانت‌اند (API Discovery & Tester)

این مهارت به توسعه‌دهندگان فرانت‌اند امکان می‌دهد با یک دستور، تمام فراخوانی‌های شبکه پروژه خود را کشف کنند، مستند جامع `apis.md` را به دست آورند و در یک پنل وب محلی، درخواست‌ها را با پشتیبانی از احراز هویت دومرحله‌ای (2FA/OTP) و تزریق خودکار پارامترهای وابسته به صورت امن بیازمایند.

---

## دستورات و راه‌اندازها (Triggers)

- فرمان اسلش اصلی: `/api-tester-start`
- عبارات کلیدی طبیعی:
  - «وب‌سرویس‌های پروژه رو اسکن و تست کن»
  - «پنل تست API را باز کن»
  - «خروجی APIهای فرانت‌اند را بررسی کن»

---

## جریان اجرای دستور `/api-tester-start`

هنگامی که کاربر دستور `/api-tester-start` را اجرا می‌کند یا درخواست اسکن و تست وب‌سرویس‌ها را دارد، گام‌های زیر را انجام دهید:

### گام ۱: اسکن پروژه فرانت‌اند
اسکریپت اسکنر را برای تحلیل فایل‌های محیطی (`.env*`)، کانفیگ‌ها (`vite.config.*`, `next.config.*`) و کلاینت‌های شبکه (Axios, Fetch, Ky, RTK Query) فراخوانی کنید:
```bash
node -e "import('./.agents/skills/api-discovery-tester/scripts/scanner.js').then(m => { const manifest = m.scanProject(process.cwd()); import('./.agents/skills/api-discovery-tester/scripts/manifest-helper.js').then(h => { h.saveManifest(manifest); h.saveApisMarkdown(manifest); console.log(JSON.stringify({ status: 'ok', count: manifest.endpoints.length })); }); });"
```

### گام ۲: تولید مستندات و مانیفست
- فایل مانیفست کشف در `.api-tester/discovery.json` ذخیره می‌گردد.
- مستند خوانای فارسی در فایل `apis.md` در ریشه پروژه ثبت می‌شود.

### گام ۳: راه‌اندازی وب‌سرور پنل محلی
سرور وب سبک پنل را اجرا کرده و مرورگر را باز کنید:
```bash
node -e "import('./.agents/skills/api-discovery-tester/panel/server.js').then(m => { const s = m.createPanelServer({ autoOpen: true }); s.start().then(info => console.log('SERVER_READY: ' + info.url)); });"
```

### گام ۴: گزارش وضعیت به کاربر
به زبان فارسی، روان و کوتاه به کاربر اعلام کنید که:
1. اسکن پروژه به پایان رسید و تعداد وب‌سرویس‌های کشف‌شده چقدر است.
2. فایل مستندات در [`apis.md`](file:///c:/Users/Mahdi/StudioProjects/Tester/apis.md) ذخیره شده است.
3. پنل وب محلی روی آدرس `http://localhost:3456` باز شده است و می‌تواند تنظیمات احراز هویت یا گزینش وب‌سرویس‌ها را انجام دهد.

---

## ساختار فایل‌های ذخیره‌شده

- `.api-tester/discovery.json`: مانیفست داده‌های خام پروژه کشف‌شده
- `apis.md`: مستندات ساختاریافته کلیه اندپوینت‌ها با ردیف وابستگی
- `.api-tester/responses/*.json`: نتایج تفکیک‌شده پاسخ هر اندپوینت همراه با تحلیل و تاخیر زمانی
