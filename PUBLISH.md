# نشر عنواني MCP — قائمة جاهزة

الملفات في هذا المستودع مُعدّة. أنت تنفّذ الأوامر بحسابك (غيت هب + نبم).

| المنصة | الحالة | مهم؟ |
|--------|--------|------|
| GitHub | موجود | نعم |
| npm | `1.1.1` منشور — ارفع `1.1.2` مع `mcpName` | نعم |
| Official MCP Registry | جاهز (`server.json`) — يحتاج أمر نشر | نعم أساسي |
| Glama | جاهز (`glama.json`) — بدّل اسم المستخدم ثم أضف المستودع | نعم |
| Smithery | جاهز (`smithery.yaml`) — اربط المستودع من موقعهم | نعم |

---

## 0) قبل أي شيء

1. افتح `glama.json` واستبدل:

```text
REPLACE_WITH_YOUR_GITHUB_USERNAME
```

باسم مستخدم غيت هب الشخصي (حسابك الفردي، مو اسم المنظمة).

2. ادفع التغييرات للمستودع:

```text
https://github.com/Anwani-app/anwani-mcp
```

---

## 1) npm (إلزامي قبل السجل الرسمي)

من مجلد هذا المشروع:

```bash
npm version 1.1.2 --no-git-tag-version
```

(إن كانت النسخة في `package.json` أصلاً `1.1.2` تجاهل الأمر.)

ثم انشر (توكن نبم بصلاحية النشر):

```bash
npm publish --access public
```

تحقق:

```bash
npm view anwani-mcp version mcpName
```

يجب أن ترى النسخة `1.1.2` وحقل:

```text
mcpName = io.github.Anwani-app/anwani-mcp
```

---

## 2) Official MCP Registry (الأساسي)

ثبّت أداة النشر مرة واحدة:

```bash
npm install -g @modelcontextprotocol/publisher
```

أو استخدم الإصدار الرسمي حسب توثيقهم الحالي (`mcp-publisher`).

سجّل دخول غيت هب (حساب يملك صلاحية على منظمة `Anwani-app`):

```bash
mcp-publisher login github
```

من جذر المستودع:

```bash
mcp-publisher publish
```

تحقق (بعد دقائق):

```bash
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=anwani"
```

ما يُنشر في السجل: بيانات فقط — الحزمة على نبم + الرابط البعيد `mcpRemote`.

---

## 3) Glama

1. تأكد أن `glama.json` فيه اسم مستخدمك الحقيقي
2. ادفع لفرع `main`
3. افتح:

```text
https://glama.ai/mcp/servers
```

4. Add MCP Server → الصق رابط المستودع
5. بعد الفهرسة: Claim ownership (لأن المستودع تحت منظمة)

موصل بعيد اختياري في غاما:

```text
https://us-central1-nine-code-anwani.cloudfunctions.net/mcpRemote
```

---

## 4) Smithery

1. ادفع `smithery.yaml` لـ `main`
2. افتح سميثري وسجّل بغيت هب
3. أضف / انشر المستودع `Anwani-app/anwani-mcp`
4. سميثري يشغّل الجسر عبر:

```text
npx -y anwani-mcp
```

ملاحظة: تسجيل الدخول أوث يبقى على جهاز المستخدم (`anwani-mcp-login`) — سميثري السحابي المؤقت قد لا يحفظ توكنك المحلي.

---

## 5) بعد النشر — روابط تضعها في التسويق

- المنتج: https://9code.app/ai-agents
- غيت هب: https://github.com/Anwani-app/anwani-mcp
- نبم: https://www.npmjs.com/package/anwani-mcp
- بعيد: https://us-central1-nine-code-anwani.cloudfunctions.net/mcpRemote
- اكتشاف أوث: https://9code.app/.well-known/oauth-authorization-server

---

## ترتيب موصى به (١٥–٣٠ دقيقة)

1. عدّل `glama.json`
2. ادفع غيت هب
3. `npm publish` → `1.1.2`
4. `mcp-publisher login github` ثم `publish`
5. أضف المستودع في غاما وسميثري من الواجهة

لا تحتاج مؤسسة. حساب غيت هب فردي + صلاحية على منظمة عنواني يكفي.
