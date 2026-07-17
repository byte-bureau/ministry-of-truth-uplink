require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const translate = require('google-translate-api-x');

const baseUrl = 'https://api.helldivers2.dev/api/v1';
const stateFile = path.join(__dirname, 'game_state.json');

const githubAssetsUrl = 'https://raw.githubusercontent.com/byte-bureau/ministry-of-truth-uplink/main/assets';

const imageDictionary = {
    "terminids": `${githubAssetsUrl}/terminids.png`,
    "automatons": `${githubAssetsUrl}/automatons.png`,
    "illuminate": `${githubAssetsUrl}/illuminate.png`,
    "super_earth": `${githubAssetsUrl}/super_earth.png`,
    "dispatch": `${githubAssetsUrl}/dispatch.png`,
    "default_planet": `${githubAssetsUrl}/default_planet.png`
};

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

async function getState() {
    try {
        const data = await fs.readFile(stateFile, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return { dispatches: {}, orders: {}, campaigns: {} };
    }
}

async function saveState(state) {
    await fs.writeFile(stateFile, JSON.stringify(state, null, 2));
}

async function translateText(text) {
    if (!text) return "";
    try {
        const result = await translate(text, { to: 'uk' });
        return result.text;
    } catch (error) {
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
    const emptyBlocks = totalBlocks - filledBlocks >= 0 ? totalBlocks - filledBlocks : 0;
    return `[${'█'.repeat(filledBlocks)}${'░'.repeat(emptyBlocks)}] ${clampedPercentage.toFixed(1)}%`;
}

function toTitleCase(str) {
    if (!str) return "";
    return str.toLowerCase().split(' ').map(word => {
        if (/^[ivx]+$/i.test(word)) {
            return word.toUpperCase();
        }
        return word.charAt(0).toUpperCase() + word.slice(1);
    }).join('_');
}

function getPlanetImageUrl(planetName) {
    if (!planetName) return imageDictionary.default_planet;
    const formattedName = toTitleCase(planetName);
    return `${githubAssetsUrl}/${formattedName}.png`;
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
    } catch (error) {
        return null;
    }
}

async function buildEmbed(item, type) {
    let title, description, color, thumbnail, footerText = null;

    if (type === "dispatches") {
        const translated = await translateText(item.message);
        title = "УКАЗ ВЕРХОВНОГО КОМАНДУВАННЯ";
        description = formatMarkdown(translated);
        color = 16761088;
        thumbnail = imageDictionary.dispatch;
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

                taskProgress += `Ціль ${idx + 1}: \`${current.toLocaleString()} / ${target.toLocaleString()}\`\n`;
            });
        }

        title = "ОСНОВНИЙ НАКАЗ";
        description = `${formatMarkdown(translatedBriefing)}\n\n**Прогрес виконання:**\n${taskProgress}`;
        color = 16761088;
        thumbnail = imageDictionary.super_earth;

        if (item.reward?.amount && item.reward.amount > 0) {
            footerText = `Нагорода: ${item.reward.amount} медалей`;
        }
    }
    else if (type === "campaigns") {
        const factionStr = item.faction ? item.faction.toLowerCase() : "unknown";
        const planetName = item.planet?.name || "Невідома планета";
        title = `АКТИВНА КАМПАНІЯ: ${planetName.toUpperCase()}`;

        const health = item.planet?.health || 0;
        const maxHealth = item.planet?.maxHealth || 0;
        const progress = generateProgressBar(health, maxHealth);
        const players = item.planet?.statistics?.playerCount || 0;

        description = `**Фракція:** ${item.faction || "Невідомо"}\n**Прогрес звільнення:**\n\`${progress}\`\n\n👥 **Гравців на планеті:** ${players.toLocaleString()}`;
        color = factionStr.includes("terminid") ? 16752640 : factionStr.includes("automaton") ? 16711680 : 3447003;
        thumbnail = getPlanetImageUrl(planetName);
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
        username: "Тостер-розвідник із Кіберстану",
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