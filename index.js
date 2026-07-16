require('dotenv').config();

console.log("Ministry of Truth Uplink Initialized.");
console.log("Checking Webhook Status...");

if (!process.env.DISCORD_WEBHOOK_URL) {
    console.error("Erro: Discord Webhook URL is missing from the .env file!");
} else {
    console.log("Webhook URL loaded securely!");
}