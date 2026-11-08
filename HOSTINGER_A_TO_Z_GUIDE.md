# Hostinger Business Web Hosting: A to Z Full Deployment Guide
## YUHUSULU CRM - 100% Node.js & TypeScript WhatsApp Multi-Device Engine

---

### 📌 හැඳින්වීම (Introduction)
ඔබ සතුව ඇති **Hostinger Business Web Hosting** ප්ලෑන් එකෙහි Node.js ධාවනය කිරීමේ (Node.js Application Manager) පහසුකම පවතී. මෙම මාර්ගෝපදේශය මගින් කිසිදු දෝෂයකින් තොරව මෙම පද්ධතිය Hostinger එකට Upload කර 24/7 ක්‍රියාත්මක කරගන්නා ආකාරය පියවරෙන් පියවර සරලව විස්තර කර ඇත.

---

### ❓ ප්‍රධාන ප්‍රශ්නය: "Phone එක Auto-Logout වෙන්නේ නැද්ද?" (Will WhatsApp Session Auto-Logout?)

**පිළිතුර: නැත! Hostinger හිදී Auto-Logout නොවේ.**

1. **Permanent Disk Storage:**
   Google AI Studio Preview පරිසරයේදී පරිගණකය නිවා දැමූ විට Container එක Restart වී ගබඩා වූ Session මැකී යාම සිදුවිය. නමුත් Hostinger හිදී ඔබගේ ගිණුම්වල සියලුම Authentication Keys `./sessions/session_acc_xxx` ෆෝල්ඩරයේ **Permanent SSD Storage** එකෙහි සුරැකේ. සර්වර් එක Restart වුවද ඒවා නොමැකී පවතී.

2. **WhatsApp Multi-Device Protocol:**
   Baileys ක්‍රියාත්මක වන්නේ WhatsApp නිල Multi-Device තාක්ෂණයෙනි. එබැවින් වරක් QR Code එක Scan කළ පසු ඔබගේ දුරකථනය Switch-off කර තිබුණද සති/මාස ගණනක් එක දිගට WhatsApp සක්‍රීයව පවතී.

3. **⚠️ Hostinger Business Hosting එකේදී සලකා බැලිය යුතු වැදගත් කරුණ (Keep-Alive Ping):**
   Hostinger Shared/Business Hosting වල Web traffic නොමැති වූ විට Node.js App එක Sleep වීමේ (Inactivity timeout) සම්භාවිතාවක් ඇත. මෙය වැළැක්වීමට පහත **Step 5** හි ඇති **2-Minute Free Keep-Alive Ping** එක සකස් කළ යුතුය. එවිට වසර 365 පුරාම WhatsApp Disconnect නොවී 24/7 ක්‍රියාත්මක වේ!

---

### 🚀 පියවරෙන් පියවර Hostinger එකේ Host කරන ආකාරය (Step-by-Step Setup)

#### පියවර 1: Deployment Package Zip එක ලබා ගැනීම
අප විසින් Hostinger Business Web Hosting එකට අවශ්‍ය සියලුම Frontend (Compiled), Backend (Pre-compiled `server.js`), සහ අවශ්‍ය සියලුම Scripts අඩංගු කර ZIP එක සකසා ඇත.
* Web UI එකේ ඇති **"Download Hostinger Deployment ZIP"** බටන් එක ක්ලික් කර `yuhusulu_whatsapp_crm_hostinger.zip` එක ඔබගේ පරිගණකයට බාගත කරගන්න.

---

#### පියවර 2: Hostinger hPanel වෙත පිවිසීම
1. [hpanel.hostinger.com](https://hpanel.hostinger.com) වෙත ගොස් ඔබගේ Hostinger ගිණුමට Login වන්න.
2. **Websites** ටැබ් එකට ගොස් ඔබගේ Domain එක ඉදිරියෙන් ඇති **Manage** බොත්තම ඔබන්න.

---

#### පියවර 3: Zip ගොනුව File Manager හරහා Upload කර Extract කිරීම
1. hPanel වම් පස මෙනුවෙන් **Files** -> **File Manager** (Access files of your domain) තෝරන්න.
2. `public_html` ෆෝල්ඩරය විවෘත කරන්න. (පැරණි default `default.php` හෝ අනවශ්‍ය ගොනු ඇත්නම් Delete කරන්න).
3. ඉහළ දකුණු කෙළවරේ ඇති **Upload** (ඊතල ලකුණ) ක්ලික් කර, පියවර 1 දී බාගත කළ `yuhusulu_whatsapp_crm_hostinger.zip` ගොනුව තෝරා Upload කරන්න.
4. Upload වූ පසු, zip ගොනුව මත Right-click කර **Extract** තෝරන්න.
   * Folder name එකට `.` (period) හෝ `public_html` ලබා දී **Extract** කරන්න.
5. දැන් `server.js`, `package.json`, `dist/`, `data/`, `src/` ඇතුළු සියලු ගොනු `public_html` තුළ දිස්වනු ඇත. (දැන් zip ගොනුව Delete කළ හැක).

---

#### පියවර 4: Hostinger Node.js Application එක සක්‍රීය කිරීම
1. hPanel වම් පස මෙනුවේ සෙවුම් තීරුවේ (Search bar) **Node.js** ලෙස Type කරන්න (හෝ **Advanced** -> **Node.js** තෝරන්න).
2. **Create Application** (හෝ Setup Node.js) ක්ලික් කරන්න:
   * **Node.js version**: `20.x` (හෝ `18.x` - 20.x වඩාත් නිර්දේශිතයි).
   * **Application mode**: `Production` තෝරන්න.
   * **Application root**: `public_html` (ඔබ ගොනු දැමූ ෆෝල්ඩරය).
   * **Application startup file**: `server.js` ලෙස ඇතුළත් කරන්න.
   * **Application URL**: ඔබගේ Domain එක තෝරන්න (උදා: `yourdomain.com`).
3. **Save / Create** බොත්තම ඔබන්න.

---

#### පියවර 5: Dependencies ස්ථාපනය කිරීම (NPM Install)
1. එම Node.js Manager පිටුවේම ඇති **"Run NPM Install"** (හෝ **NPM Install**) බොත්තම ක්ලික් කරන්න.
2. තත්පර 30-45ක් ඇතුළත `package.json` හි ඇති සියලුම Node libraries (`@whiskeysockets/baileys`, `express`, ආදී) Hostinger සර්වර් එක මත ස්වයංක්‍රීයව ස්ථාපනය වේ.
3. ඉන්පසු **"Start App"** (හෝ Restart) ක්ලික් කරන්න.
4. ඔබගේ Domain එක (උදා: `https://yourdomain.com`) Browser එකෙන් Open කරන්න. YUHUSULU WhatsApp CRM එක සාර්ථකව Live ක්‍රියාත්මක වනු ඇත!

---

#### පියවර 6: 24/7 Keep-Alive Cron එක සකස් කිරීම (Sleep වීම වැළැක්වීමට)
Hostinger Shared Hosting වල Inactivity Timeout නිසා Node.js sleep වීම නැවැත්වීමට නොමිලේ ක්‍රම 2න් එකක් භාවිතා කරන්න:

* **ක්‍රමය A (Hostinger hPanel Cron Job මගින්):**
  1. hPanel වෙත ගොස් **Advanced** -> **Cron Jobs** තෝරන්න.
  2. Cron type: `Custom` තෝරන්න.
  3. Minute: `*/2` (සෑම විනාඩි 2කට වරක්). Hour, Day, Month: `*`
  4. Command:
     ```bash
     curl -s https://yourdomain.com/api/accounts > /dev/null
     ```
  5. **Save** කරන්න.

* **ක්‍රමය B (නොමිලේ UptimeRobot හරහා - ඉතා පහසුයි):**
  1. [uptimerobot.com](https://uptimerobot.com) හි නොමිලේ Account එකක් හදන්න.
  2. **Add New Monitor** ක්ලික් කර Monitor Type එකට `HTTP(s)` තෝරන්න.
  3. URL එකට `https://yourdomain.com/api/accounts` ලබා දෙන්න.
  4. Interval එක `2 minutes` තෝරා Save කරන්න.
  *(මෙමගින් UptimeRobot සෑම විනාඩි 2කට වරක් ඔබගේ සර්වර් එක Ping කර Node.js WebSocket Engine එක සදාකාලිකවම Awake තබයි!)*

---

### 📱 දුරකථනය සම්බන්ධ කිරීම (Linking WhatsApp)
1. ඔබගේ Domain එකට (`https://yourdomain.com`) පිවිසෙන්න.
2. **Accounts** ටැබ් එකට ගොස් **"Scan QR & Connect"** ඔබන්න.
3. දුරකථනයේ WhatsApp -> **Linked Devices** -> **Link a Device** ගොස් QR Code එක Scan කරන්න.
4. Status එක **`LIVE CONNECTED`** වූ පසු, ඔබගේ දුරකථනය විසන්ධි වුවද පද්ධතිය හරහා Messages සහ Warm-up 24/7 නොකඩවා ක්‍රියාත්මක වේ!
