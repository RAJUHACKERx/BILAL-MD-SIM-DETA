const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore
} = require("@whiskeysockets/baileys");
const P = require("pino");
const axios = require("axios");
const fs = require("fs-extra");
const config = require("./config");

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./session");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: P({ level: "silent" }),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, P({ level: "silent" })),
    },
    printQRInTerminal: false,
    browser: ["Ubuntu", "Chrome", "20.0.04"]
  });

  // 🔑 PAIRING CODE LOGIC
  if (!sock.authState.creds.registered) {
    console.log("⏳ Pairing code request ho raha hai...");
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(config.phoneNumber);
        console.log(`\n🔗 APKA PAIR CODE: ${code}\n`);
      } catch (err) {
        console.log("Pairing Code Error:", err.message);
      }
    }, 6000);
  }

  sock.ev.on("creds.update", saveCreds);

  // 🔄 CONNECTION UPDATE (WITH AUTO-RESTART)
  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "close") {
      const shouldRestart = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log("🔄 Connection closed. Restarting: ", shouldRestart);
      if (shouldRestart) {
        setTimeout(() => startBot(), 5000); 
      }
    } else if (connection === "open") {
      console.log(`✅ SIM DATABASE BOT CONNECTED BY ${config.ownerName.toUpperCase()}`);
    }
  });

  // 🛡️ ANTI-IDLE (Heroku Awake Feature)
  setInterval(() => {
    console.log("🛡️ Anti-Idle: Bot is active and running...");
  }, 10 * 60 * 1000);

  // 📩 MESSAGE HANDLING (.find Command)
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== 'notify') return;
    
    try {
      const msg = messages[0];
      if (!msg.message || msg.key.fromMe) return;

      const from = msg.key.remoteJid;
      const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
      
      // ✅ COMMAND CHECK: Sirf .find par respond karega
      if (!text.toLowerCase().startsWith(".find")) return;

      const query = text.split(" ")[1]?.replace(/\D/g, ""); // Number ya CNIC nikalne ke liye

      if (!query || query.length < 10) {
        return sock.sendMessage(from, {
          text: `*⚠️ Usage:* .find 03XXXXXXXXX\n*Example:* .find 03038264337`
        });
      }

      let queryType = query.length === 13 ? "CNIC" : "Phone Number";
      await sock.sendMessage(from, { text: "🔎 *Searching SIM Database...* ⏳" });

      // 🔎 API CALLING
      const api = `https://rai-ammar-kharal-sim-database-api.vercel.app/api/lookup?query=${query}`;
      
      try {
        const res = await axios.get(api);
        const d = res.data;

        if (!d || (!d.name && !d.cnic)) {
          return sock.sendMessage(from, {
            text: `❌ *NO DATA FOUND*\n\n🔍 *Query:* ${query}\n📌 *Type:* ${queryType}\n\n🔥 *Powered by ${config.ownerName}*`
          });
        }

        // ✅ RESULT UI
        const result = `
╔══════════════════════════════╗
   ✅  *SIM DATABASE RESULTS*
╚══════════════════════════════╝

📌 *Type:* ${queryType}
📞 *Query:* ${query}

╭──────────────────────────────╮
│ 👤 *Name* : ${d.name || "N/A"}
│ 📱 *Number* : ${d.number || query}
│ 🆔 *CNIC* : ${d.cnic || "N/A"}
│ 🏠 *Address* :
│   ${d.address || "N/A"}
╰──────────────────────────────╯

🔥 *Powered by ${config.ownerName}*`;

        await sock.sendMessage(from, { text: result });
      } catch (e) {
        await sock.sendMessage(from, { text: "⚠️ Server response error. Try again later." });
      }
    } catch (err) {
      console.log("ERROR:", err);
    }
  });
}

// Start the bot
startBot();
        
