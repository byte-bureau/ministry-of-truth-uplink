require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const translate = require('google-translate-api-x');
const config = require('./config.json');

const baseUrl = 'https://api.helldivers2.dev/api/v1';
const stateFile = path.join(__dirname, 'game_state.json');
const githubAssetsUrl = 'https://raw.githubusercontent.com/byte-bureau/ministry-of-truth-uplink/main/assets';

const fallbackImages = {
    "terminids": `${githubAssetsUrl}/terminids.png`,
    "automatons": `${githubAssetsUrl}/automatons.png`,
    "illuminate": `${githubAssetsUrl}/illuminate.png`,
    "super_earth": `${githubAssetsUrl}/super_earth.png`,
    "dispatch": `${githubAssetsUrl}/dispatch.png`,
    "default_planet": `${githubAssetsUrl}/default_planet.png`
};

let assetsMap = new Map();

const discord = {
    url: process.env.DISCORD_WEBHOOK_URL,

    async post(payload) {
        try {
            const res = await fetch(`${this.url}?wait=true`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                const data = await res.json();
                return data.id;
            }
            return null;
        } catch (e) {
            console.log("x failed to post message:", e.message);
            return null;
        }
    },

    async patch(messageId, payload) {
        try {
            await fetch(`${this.url}/messages/${messageId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (e) {
            console.log("x failed to update message:", e.message);
        }
    },

    async delete(messageId) {
        try {
            await fetch(`${this.url}/messages/${messageId}`, {
                method: 'DELETE'
            });
        } catch (e) {
            console.log("x failed to delete message:", e.message);
        }
    }
};

async function loadAssetsMap() {
    try {
        const files = await fs.readdir(path.join(__dirname, 'assets'));
        assetsMap = new Map(files.map(f => [f.toLowerCase(), f]));
    } catch (e) {
        console.log("» warning: assets folder not found or inaccessible:", e.message);
    }
}

function getAssetUrl(name, fallbackKey = "default_planet") {
    if (!name) return fallbackImages[fallbackKey] || fallbackImages.default_planet;

    const formattedName = name.replace(/\s+/g, '_').toLowerCase();

    const pngKey = `${formattedName}.png`;
    const webpKey = `${formattedName}.webp`;

    if (assetsMap.has(pngKey)) {
        return `${githubAssetsUrl}/${assetsMap.get(pngKey)}`;
    } else if (assetsMap.has(webpKey)) {
        return `${githubAssetsUrl}/${assetsMap.get(webpKey)}`;
    }

    const fallbackLower = fallbackKey.toLowerCase();
    const fallbackPng = `${fallbackLower}.png`;
    const fallbackWebp = `${fallbackLower}.webp`;

    if (assetsMap.has(fallbackPng)) {
        return `${githubAssetsUrl}/${assetsMap.get(fallbackPng)}`;
    } else if (assetsMap.has(fallbackWebp)) {
        return `${githubAssetsUrl}/${assetsMap.get(fallbackWebp)}`;
    }

    return fallbackImages[fallbackKey] || fallbackImages.default_planet;
}

async function getState() {
    try {
        const data = await fs.readFile(stateFile, 'utf8');
        return JSON.parse(data);
    } catch {
        return { dispatches: {}, orders: {}, campaigns: {} };
    }
}

async function saveState(state) {
    await fs.writeFile(stateFile, JSON.stringify(state, null, 2));
}

async function translateText(text) {
    if (!text) return "";
    try {
        const result = await translate(text, { to: config.language });
        return result.text;
    } catch {
        return text;
    }
}

function formatMarkdown(text) {
    return text ? text.replace(/<i=\d+>/g, '**').replace(/<\/i>/g, '**') : "";
}

function generateProgressBar(health, maxHealth) {
    if (!health || !maxHealth) return "[░░░░░░░░░░] 0.0%";
    const percentage = 100 - ((health / maxHealth) * 100);
    const clampedPercentage = Math.max(0, Math.min(100, percentage));

    const totalBlocks = 10;
    const filledBlocks = Math.round((clampedPercentage / 100) * totalBlocks);
    const emptyBlocks = Math.max(0, totalBlocks - filledBlocks);
    return `[${'█'.repeat(filledBlocks)}${'░'.repeat(emptyBlocks)}] ${clampedPercentage.toFixed(1)}%`;
}

async function fetchGameData() {
    const headers = {
        "X-Super-Client": "ministry-of-truth-uplink",
        "X-Super-Contact": "your-real-email@example.com",
        "Accept": "application/json"
    };

    try {
        const [dispatchesRes, ordersRes, campaignsRes] = await Promise.all([
            fetch(`${baseUrl}/dispatches`, { headers }),
            fetch(`${baseUrl}/assignments`, { headers }),
            fetch(`${baseUrl}/campaigns`, { headers })
        ]);

        if (!dispatchesRes.ok || !ordersRes.ok || !campaignsRes.ok) return null;

        const allDispatches = await dispatchesRes.json();
        const latestDispatch = Array.isArray(allDispatches) && allDispatches.length > 0 ? [allDispatches[0]] : [];

        const orders = await ordersRes.json();
        const campaigns = await campaignsRes.json();

        const orderPlanetIds = new Set();
        orders.forEach(order => {
            if (order.tasks) {
                order.tasks.forEach(task => {
                    if (task.values) {
                        task.values.forEach(val => orderPlanetIds.add(val));
                    }
                });
            }
        });

        const filteredCampaigns = campaigns.filter(camp => orderPlanetIds.has(camp.planet.index));

        return {
            dispatches: latestDispatch,
            orders: orders,
            campaigns: filteredCampaigns
        };
    } catch {
        return null;
    }
}

async function buildEmbed(item, type) {
    let title, description, color, thumbnail, footerText = null;

    if (type === "dispatches") {
        const translated = await translateText(item.message);
        title = config.templates.dispatchTitle;
        description = formatMarkdown(translated);
        color = 16761088;
        thumbnail = getAssetUrl("dispatch", "dispatch");
    }
    else if (type === "orders") {
        const translatedBriefing = await translateText(item.briefing);

        let taskProgress = "";
        if (item.tasks && item.progress) {
            item.tasks.forEach((task, idx) => {
                const current = item.progress[idx] || 0;
                let target = 0;

                if (task.values && task.values.length > 1) {
                    target = task.values[1];
                    if (target === 0 && task.values.length > 2) {
                        target = task.values[2];
                    }
                }
                if (target === 0) target = 1000000;

                taskProgress += `${config.templates.taskLabel} ${idx + 1}: \`${current.toLocaleString()} / ${target.toLocaleString()}\`\n`;
            });
        }

        title = config.templates.orderTitle;
        description = `${formatMarkdown(translatedBriefing)}\n\n**Прогрес виконання:**\n${taskProgress}`;
        color = 16761088;
        thumbnail = getAssetUrl("super_earth", "super_earth");

        if (item.reward?.amount && item.reward.amount > 0) {
            footerText = `${config.templates.rewardLabel}: ${item.reward.amount} ${config.templates.rewardUnit}`;
        }
    }
    else if (type === "campaigns") {
        const factionStr = item.faction ? item.faction.toLowerCase() : "unknown";
        const planetName = item.planet?.name || config.templates.unknownPlanet;
        title = `${config.templates.campaignTitle}: ${planetName.toUpperCase()}`;

        const health = item.planet?.health || 0;
        const maxHealth = item.planet?.maxHealth || 0;
        const progress = generateProgressBar(health, maxHealth);
        const players = item.planet?.statistics?.playerCount || 0;

        description = `**${config.templates.factionLabel}:** ${item.faction || config.templates.unknownFaction}\n**${config.templates.liberationLabel}:**\n\`${progress}\`\n\n👥 **${config.templates.playersLabel}:** ${players.toLocaleString()}`;
        color = factionStr.includes("terminid") ? 16752640 : factionStr.includes("automaton") ? 16711680 : 3447003;

        thumbnail = getAssetUrl(planetName, factionStr);
    }

    const embed = {
        title: title,
        description: description,
        color: color,
        thumbnail: { url: thumbnail }
    };

    if (footerText) {
        embed.footer = { text: footerText };
    }

    return {
        username: config.botName,
        embeds: [embed]
    };
}

async function syncCategory(liveItems, stateCategoryMap, categoryName) {
    const liveMap = new Map(liveItems.map(item => [item.id.toString(), item]));
    const liveIds = Array.from(liveMap.keys());
    const savedIds = Object.keys(stateCategoryMap);

    const toDelete = savedIds.filter(id => !liveIds.includes(id));
    const toCreate = liveIds.filter(id => !savedIds.includes(id));
    const toUpdate = liveIds.filter(id => savedIds.includes(id));

    console.log(`» [${categoryName}] create: ${toCreate.length} | update: ${toUpdate.length} | delete: ${toDelete.length}`);

    for (const id of toDelete) {
        const messageId = stateCategoryMap[id];
        if (messageId) await discord.delete(messageId);
        delete stateCategoryMap[id];
    }

    for (const id of toCreate) {
        const item = liveMap.get(id);
        const payload = await buildEmbed(item, categoryName);
        const messageId = await discord.post(payload);
        if (messageId) {
            stateCategoryMap[id] = messageId;
        }
    }

    for (const id of toUpdate) {
        const item = liveMap.get(id);
        const messageId = stateCategoryMap[id];
        if (messageId && (categoryName === "campaigns" || categoryName === "orders")) {
            const payload = await buildEmbed(item, categoryName);
            await discord.patch(messageId, payload);
        }
    }
}

async function syncEngine() {
    console.log("» initializing dashboard sync...");

    await loadAssetsMap();

    const liveData = await fetchGameData();
    if (!liveData) return;

    let state = await getState();

    await syncCategory(liveData.dispatches, state.dispatches, "dispatches");
    await syncCategory(liveData.orders, state.orders, "orders");
    await syncCategory(liveData.campaigns, state.campaigns, "campaigns");

    await saveState(state);
    console.log("» sync complete. dashboard is live.");
}

syncEngine();