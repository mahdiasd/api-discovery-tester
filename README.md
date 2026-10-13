# ابزار کشف و آزمون خودکار وب‌سرویس‌های فرانت‌اند
### Frontend API Discovery & Automated Testing Workbench (Antigravity Skill)

[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-blue.svg)](#)

ابزاری سبک، مستقل و بدون وابستگی خارجی (`Zero Dependencies`) برای تحلیل کدهای فرانت‌اند و کلاینت (Web / Android / KMP)، کشف فراخوانی‌های شبکه، اولویت‌بندی ورود (Login در رتبه ۱)، تولید خودکار مستندات `apis.md` و راه‌اندازی پنل پیش‌ساخته انگلیسی برای آزمون امن وب‌سرویس‌ها.

---

## قابلیت‌های کلیدی

- **اسکن هوشمند و دقیق کلاینت‌های شبکه**: پشتیبانی از کلاینت‌های مدرن وب و موبایل (Ktor, Retrofit, Axios, Fetch, RTK Query) با فیلتر دقیق آدرس‌های نامرتبط (اسکیمای XML، فایل‌های دارایی و هاست‌های متفرقه).
- **اولویت قطعی لاگین (Rank #1)**: وب‌سرویس احراز هویت و لاگین (`POST /v1/auth/login`) همواره در صدر ترتیب اجرا قرار می‌گیرد تا نشست کاربری برای فراخوانی‌های بعدی مهیا شود.
- **پنل وب پیش‌ساخته استاندارد (English Workbench)**: طراحی پیشرفته با تم تیره Studio/Cobalt بر پایه اصول طراحی توسعه‌دهندگان، مجهز به دراور بازبینی زنده (Slide-over Inspector Drawer) جهت بررسی هدرها، بدنه درخواست، پاسخ سرور و عیب‌یابی ریشه‌ای خطاها.
- **رفتار امن پیش‌فرض (Safe by Default)**: تیک‌خوردن خودکار متدهای ایمن (`GET`, `HEAD`) و غیرفعال بودن اولیه متدهای تغییردهنده داده‌ها.
- **پشتیبانی کامل از احراز هویت و ۲FA**: امکان تعریف توکن Bearer، کلیدهای سفارشی و فیلد کد دومرحله‌ای (OTP).
- **تزریق خودکار پارامترهای وابسته**: استخراج خودکار شناسه‌ها و توکن‌ها از پاسخ مراحل قبل و تزریق در مسیر درخواست‌های وابسته.
- **ذخیره ایزوله لاگ و پاسخ‌ها**: ثبت ساختاریافته هر پاسخ در پوشه `.api-tester/responses/` به همراه تولید فایل جامع `apis.md` در ریشه پروژه.

---

## راهنمای نصب (Installation)

### روش ۱: نصب در پوشه مهارت‌های اختصاصی پروژه
در ریشه پروژه فرانت‌اند یا کلاینت خود دستورات زیر را اجرا کنید:

```bash
mkdir -p .agents/skills
git clone https://github.com/mahdiasd/api-discovery-tester.git .agents/skills/api-discovery-tester
```

### روش ۲: نصب سراسری در پروفایل کاربری Antigravity
**ویندوز (PowerShell):**
```powershell
git clone https://github.com/mahdiasd/api-discovery-tester.git "$HOME\.gemini\antigravity\skills\api-discovery-tester"
```

**لینوکس و مک:**
```bash
git clone https://github.com/mahdiasd/api-discovery-tester.git ~/.gemini/antigravity/skills/api-discovery-tester
```

---

## نحوه استفاده در Antigravity (agy)

> [!IMPORTANT]
> در محیط `agy` (Antigravity)، دستورات از طریق پرامپت متنی (Natural Language) فراخوانی می‌شوند (نه با علامت اسلش `/`).

### روش الف: دستور به ایجنت (در چت agy)
کافیست در چت پروژه به ایجنت بنویسید:
> **«وب‌سرویس‌های پروژه رو اسکن و تست کن»**
> یا
> **«پنل تست API را باز کن»**

ایجنت به صورت خودکار مهارت را فعال کرده، پروژه را اسکن نموده، لاگین را در صدر قرار می‌دهد و پنل وب آماده را در `http://localhost:3456` باز می‌کند.

### روش ب: اجرای مستقیم از خط فرمان (CLI)
در ترمینال پروژه دستور زیر را بزنید:
```bash
node .agents/skills/api-discovery-tester/bin/cli.js
```

مرورگر شما مستقیماً باز شده و پنل آماده کار خواهد بود.
