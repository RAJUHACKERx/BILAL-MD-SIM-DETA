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

  // Pairing Code Logic
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

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "close") {
      const shouldRestart = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log("🔄 Connection closed due to ", lastDisconnect?.error, ". Restarting: ", shouldRestart);
      if (shouldRestart) {
        setTimeout(() => startBot(), 5000); // 5 seconds wait before restart
      }
    } else if (connection === "open") {
      console.log(`✅ SIM DATABASE BOT CONNECTED BY ${config.ownerName.toUpperCase()}`);
    }
  });

  // Anti-Idle Feature: Heroku ko "awake" rakhne ke liye
  setInterval(() => {
    console.log("🛡️ Anti-Idle: Bot is active and running...");
  }, 10 * 60 * 1000); // Har 10 mins baad log check karega

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
    const query = text.replace(/\D/g, "");

    if (!query || query.length < 10) return;

    let queryType = query.length === 13 ? "CNIC" : "Phone Number";
    await sock.sendMessage(from, { text: "🔎 *Searching SIM Database...* ⏳" });

    try {
      const api = `https://rai-ammar-kharal-sim-database-api.vercel.app/api/lookup?query=${query}`;
      const res = await axios.get(api);
      const d = res.data;

      if (!d || (!d.name && !d.cnic)) {
        return sock.sendMessage(from, { text: `❌ *NO DATA FOUND* for ${query}` });
      }

      const result = `
╔══════════════════════════════╗
   ✅  *SIM DATABASE RESULTS*
╚══════════════════════════════╝
👤 *Name* : ${d.name || "N/A"}
📱 *Number* : ${d.number || query}
🆔 *CNIC* : ${d.cnic || "N/A"}
🏠 *Address* : ${d.address || "N/A"}

🔥 *Powered by ${config.ownerName}*`;

      await sock.sendMessage(from, { text: result });
    } catch (e) {
      await sock.sendMessage(from, { text: "⚠️ Server error or record not found." });
    }
  });
}

startBot();
        
