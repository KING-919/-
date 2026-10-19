# HemamApp — بناء Windows EXE و Android APK عبر GitHub

هذه الملفات جاهزة لبناء نسختين من موقعك `https://hemam-edu.blogspot.com`:
- **Windows (.exe)** عبر `build-windows.yml` باستخدام Nativefier.
- **Android (.apk)** عبر `build-android.yml` باستخدام Capacitor.

## خطوات الاستخدام

1. أنشئ مستودع (repository) جديد في GitHub، عام أو خاص.
2. ارفع كل هذه الملفات بنفس البنية (مع مجلد `.github/workflows/` كما هو).
3. افتح تبويب **Actions** في المستودع.
4. ستجد عملين (workflows): "Build Windows EXE (Nativefier)" و "Build Android APK (Capacitor)".
5. اختر أي واحد منهما واضغط **Run workflow** (التشغيل اليدوي)، أو فقط ادفع (push) أي تعديل بسيط وسيعمل تلقائياً.
6. انتظر من 3 إلى 8 دقائق.
7. بعد الانتهاء، افتح تفاصيل التشغيل (run) وستجد ملف **Artifacts** بالأسفل:
   - `HemamApp-Windows.zip` يحتوي على `HemamApp.exe` جاهز للتشغيل مباشرة (فك الضغط فقط).
   - `HemamApp-Android` يحتوي على `app-debug.apk` جاهز للتثبيت مباشرة على أي جهاز أندرويد (فعّل "مصادر غير معروفة" من الإعدادات عند التثبيت لأول مرة).

## ملاحظات مهمة

- **حجم ملف EXE كبير نسبياً** (150-250 ميجا تقريباً) لأن Nativefier يغلّف متصفح Electron كامل داخل التطبيق. هذا طبيعي لهذه الطريقة ولا يوجد حل أخف بنفس البساطة.
- **APK الأندرويد موقّع بمفتاح تجريبي (debug)** — يثبّت مباشرة على أي جهاز، لكنه غير صالح للنشر على متجر Google Play. إذا احتجت نشره على المتجر لاحقاً، أخبرني وأضيف لك خطوة توقيع حقيقية (keystore).
- لتغيير اسم التطبيق أو الموقع المستهدف، عدّل:
  - في `build-windows.yml`: السطر الذي يحتوي على `--name` والرابط.
  - في `capacitor.config.ts`: قيمتي `appName` و `server.url`.
