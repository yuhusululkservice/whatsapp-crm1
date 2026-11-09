# 🚀 Render.com සහ Railway.app මත YUHUSULU WhatsApp CRM නොමිලේ 24/7 Run කරන ආකාරය
### (Laptop එක Off කර තැබුවද Campaigns සහ Warm-up නොනැවතී ක්‍රියාත්මක වේ)

---

## 🌟 මෙම ක්‍රමයේ ඇති විශේෂ වාසි:
1. **Laptop එක Turn OFF කළද වැඩ කරයි:** Cloud Server එකක් තුළ 24/7 Run වන බැවින් ඔබගේ පරිගණකය ක්‍රියා විරහිත කර තැබුවද Campaigns සහ Warmup සාමාන්‍ය පරිදි සිදුවේ.
2. **Node.js සහ WebSockets 100% ක්‍රියාත්මකයි:** Baileys WhatsApp සම්බන්ධතාවය බාධාවකින් තොරව පවතී.
3. **නොමිලේ (Free Tier):** Render.com සහ Railway.app යන දෙකෙහිම නොමිලේ ලබාදෙන Plan එක ප්‍රමාණවත් වේ.
4. **QR Code එක Scan කළ පසු Phone එක Logout නොවේ.**

---

## 🥇 ක්‍රමය 1: Railway.app (වඩාත්ම නිර්දේශිත ක්‍රමය - Highly Recommended)
Railway.app හි **Persistent Volume** පහසුකම ඇති බැවින් ඔබගේ WhatsApp Login Sessions කිසිදා මැකී යන්නේ නැත.

### පියවර 1: GitHub වෙත Codebase එක දැමීම (විනාඩි 2යි)
1. **[github.com](https://github.com)** වෙත ගොස් නොමිලේ Account එකක් සාදා ගන්න (Account එකක් දැනටමත් තිබේ නම් Login වන්න).
2. ඉහළ දකුණු කෙළවරේ ඇති `+` ලකුණ ක්ලික් කර **New repository** තෝරන්න.
3. Repository name එක ලෙස `whatsapp-crm` දී **Create repository** ඔබන්න.
4. Dashboard එකෙන් බාගත කරගත් ZIP එක Extract කර, එහි ඇති ගොනු සියල්ල GitHub Repo එකට Upload කරන්න (හෝ GitHub Desktop / Git command මඟින් Push කරන්න).

### පියවර 2: Railway.app එකට සම්බන්ධ කිරීම
1. **[railway.com](https://railway.com)** වෙත ගොස් ඔබගේ **GitHub Account එකෙන් Login** වන්න.
2. **New Project** ඔබන්න.
3. **Deploy from GitHub repo** තෝරා ඔබ සාදාගත් `whatsapp-crm` repository එක තෝරන්න.
4. **Deploy Now** ඔබන්න!
5. Railway මඟින් ස්වයංක්‍රීයව `npm install && npm run build` කර තත්පර 60කින් Web App එක Online කරනු ඇත.

### පියවර 3: WhatsApp Sessions නොමැකී තබාගැනීමට Volume එකක් එක් කිරීම (Persistent Storage)
1. Railway Dashboard හි ඔබගේ Service එක මත ක්ලික් කරන්න.
2. **Volumes** ටැබ් එකට ගොස් **Add Volume** ඔබන්න.
3. Mount path එක ලෙස `/app/data` (සහ තවත් volume එකක් `/app/sessions` ලෙස) යොදන්න.
4. **Networking** ටැබ් එකට ගොස් **Generate Domain** ඔබන්න. ඔබට `https://whatsapp-crm-production-xxxx.up.railway.app` වැනි නොමිලේ HTTPS Link එකක් ලැබේ.
5. එම Link එකෙන් Dashboard එක විවෘත කර Phone එකෙන් QR Code එක Scan කරන්න. දැන් ඔබගේ Laptop එක Off කළද වැඩේ 24/7 සිදුවේ!

---

## 🥈 ක්‍රමය 2: Render.com (100% නොමිලේ ක්‍රමය - Free Web Service)

### පියවර 1: Render.com Account එකක් සාදා ගැනීම
1. **[render.com](https://render.com)** වෙත ගොස් **Sign up with GitHub** ක්ලික් කරන්න.

### පියවර 2: New Web Service එකක් සැකසීම
1. Dashboard එකේ දකුණු පස ඇති **New +** ➡️ **Web Service** තෝරන්න.
2. **Build and deploy from a Git repository** තෝරා Next ඔබන්න.
3. ඔබගේ GitHub හි ඇති `whatsapp-crm` repository එක Select කර **Connect** ඔබන්න.
4. පහත විස්තර ලබා දෙන්න:
   * **Name:** `yuhusulu-crm`
   * **Region:** `Singapore` (ශ්‍රී ලංකාවට ආසන්නතම කලාපය)
   * **Branch:** `main` (හෝ master)
   * **Runtime:** `Node`
   * **Build Command:** `npm install && npm run build`
   * **Start Command:** `npm start`
   * **Instance Type:** `Free` ($0/month)
5. **Create Web Service** ක්ලික් කරන්න.

### පියවර 3: Render Free Tier එක Sleep නොවී තබාගැනීම (Keep-Alive)
Render free tier එක මිනිත්තු 15ක් කිසිවෙක් නොපැමිණියහොත් sleep වීමට ඉඩ ඇත. එය වැළැක්වීමට:
1. **[uptimerobot.com](https://uptimerobot.com)** වෙත ගොස් නොමිලේ Account එකක් සාදන්න.
2. **Add New Monitor** ඔබන්න.
   * **Monitor Type:** `HTTP(s)`
   * **URL:** `https://your-app-name.onrender.com/api/accounts`
   * **Interval:** `5 minutes`
3. Save කරන්න. එවිට Render server එක කිසිදා sleep නොවී WhatsApp socket එක 24/7 සක්‍රීයව පවතී!

---

## 🎯 සාරාංශය:
* **Railway.app** හෝ **Render.com** මත මෙය ක්‍රියාත්මක වන විට, සියලුම Campaigns, Auto-Responders සහ Scheduled Warm-up ක්‍රියාවලීන් ඔබගේ Laptop එක හෝ දුරකථනය විසන්ධි කර තිබුණද Cloud Server එක තුළ ස්වාධීනව ක්‍රියාත්මක වේ.
