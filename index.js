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
  // Panel par session folder hamesha save rehta hai
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

  // Owner Pairing (Jab aap pehli bar bot start karenge)
  if (!sock.authState.creds.registered) {
    console.log("⏳ Waiting for Pairing Code...");
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(config.phoneNumber);
        console.log(`\n🔗 OWNER PAIR CODE: ${code}\n`);
      } catch (err) {
        console.log("Pairing Error:", err.message);
      }
    }, 6000);
  }

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "close") {
      const shouldRestart = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldRestart) {
        setTimeout(() => startBot(), 5000);
      }
    } else if (connection === "open") {
      console.log(`✅ MINI BOT ACTIVE ON PANEL - OWNER: ${config.ownerName}`);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

    // 🛠️ COMMAND 1: User Pairing (.pair)
    if (text.toLowerCase().startsWith(".pair")) {
      const target = text.split(" ")[1]?.replace(/\D/g, "");
      if (!target || target.length < 10) {
        return sock.sendMessage(from, { text: "❌ Usage: .pair 923XXXXXXXXX" });
      }

      await sock.sendMessage(from, { text: `⏳ Generating Pairing Code for ${target}...` });
      try {
        // Isse user ko unka code mil jayega
        const userCode = await sock.requestPairingCode(target);
        await sock.sendMessage(from, { 
          text: `✅ *YOUR PAIRING CODE:* ${userCode}\n\n1. WhatsApp Settings kholen.\n2. Linked Devices par jayen.\n3. Link with Phone Number chunein.\n4. Ye code enter karein.` 
        });
      } catch (e) {
        await sock.sendMessage(from, { text: "⚠️ Error generating code." });
      }
    }

    // 🛠️ COMMAND 2: SIM Database (.find)
    if (text.toLowerCase().startsWith(".find")) {
      const query = text.split(" ")[1]?.replace(/\D/g, "");
      if (!query || query.length < 10) return;

      await sock.sendMessage(from, { text: "🔎 Searching Database..." });
      try {
        const res = await axios.get(`https://rai-ammar-kharal-sim-database-api.vercel.app/api/lookup?query=03018787786${query}`);
        const d = res.data;

        if (!d || !d.name) return sock.sendMessage(from, { text: "❌ Record Not Found." });

        const result = `╔══════════════════╗\n  ✅ SIM RESULTS\n╚══════════════════╝\n👤 *Name* : ${d.name}\n📱 *Number* : ${d.number}\n🆔 *CNIC* : ${d.cnic}\n🏠 *Address* : ${d.address}\n\n🔥 *Powered by ${config.im bilal king 👑}*`;
        await sock.sendMessage(from, { text: result });
      } catch (e) {
        await sock.sendMessage(from, { text: "⚠️ API Error." });
      }
    }
  });
}

startBot();
