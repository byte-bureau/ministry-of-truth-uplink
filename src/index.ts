import fs from 'fs/promises';
import path from 'path';
import translate from 'google-translate-api-x';
import rawConfig from '../config.json';

const baseUrl = 'https://api.helldivers2.dev/api/v1';
const stateFile = path.join(__dirname, '../game_state.json');
const githubAssetsUrl = 'https://raw.githubusercontent.com/byte-bureau/ministry-of-truth-uplink/main/assets';
const DEFAULT_FALLBACK = `${githubAssetsUrl}/default_planet.png`;

interface GameState {
    dispatches: { [id: string]: string };
    orders: { [id: string]: string };
    campaigns: {
        [id: string]: {
            messageId: string;
            lastHealth: number;
            lastChecked: number;
        }
    };
}

interface AppConfig {
    botName: string;
    language: string;
    pingRoleId?: string;
    templates: {
        dispatchTitle: string;
        orderTitle: string;
        campaignTitle: string;
        factionLabel: string;
        liberationLabel: string;
        playersLabel: string;
        taskLabel: string;
        rewardLabel: string;
        rewardUnit: string;
        unknownPlanet: string;
        unknownFaction: string;
    };
}

const config = rawConfig as AppConfig;

interface DiscordEmbed {
    title: string;
    description: string;
    color: number;
    thumbnail: { url: string };
    footer?: { text: string };
}

interface WebhookPayload {
    username: string;
    content?: string;
    embeds: DiscordEmbed[];
}

const fallbackImages: Record<string, string> = {
    "terminids": `${githubAssetsUrl}/terminids.png`,
    "automatons": `${githubAssetsUrl}/automatons.png`,
    "illuminate": `${githubAssetsUrl}/illuminate.png`,
    "super_earth": `${githubAssetsUrl}/super_earth.png`,
    "dispatch": `${githubAssetsUrl}/dispatch.png`,
    "default_planet": DEFAULT_FALLBACK
};

let assetsMap = new Map<string, string>();

const discord = {
    url: process.env.DISCORD_WEBHOOK_URL!,

    async post(payload: WebhookPayload): Promise<string | null> {
        try {
            const res = await fetch(`${this.url}?wait=true`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                const data = await res.json() as { id: string };
                return data.id;
            }
            return null;
        } catch (e: any) {
            console.log("x failed to post message:", e.message);
            return null;
        }
    },

    async patch(messageId: string, payload: WebhookPayload): Promise<void> {
        try {
            await fetch(`${this.url}/messages/${messageId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (e: any) {
            console.log("x failed to update message:", e.message);
        }
    },

    async delete(messageId: string): Promise<void> {
        try {
            await fetch(`${this.url}/messages/${messageId}`, { method: 'DELETE' });
        } catch (e: any) {
            console.log("x failed to delete message:", e.message);
        }
    }
};

async function loadAssetsMap(): Promise<void> {
    try {
        const files = await fs.readdir(path.join(__dirname, '../assets'));
        assetsMap = new Map(files.map(f => [f.toLowerCase(), f]));
    } catch (e: any) {
        console.log("» warning: assets folder inaccessible:", e.message);
    }
}

function getAssetUrl(name: string | null, fallbackKey: string = "default_planet"): string {
    if (!name) {
        return fallbackImages[fallbackKey] ?? DEFAULT_FALLBACK;
    }

    const formattedName = name.replace(/\s+/g, '_').toLowerCase();
    const pngKey = `${formattedName}.png`;
    const webpKey = `${formattedName}.webp`;

    const pngMatch = assetsMap.get(pngKey);
    if (pngMatch) return `${githubAssetsUrl}/${pngMatch}`;

    const webpMatch = assetsMap.get(webpKey);
    if (webpMatch) return `${githubAssetsUrl}/${webpMatch}`;

    const fallbackLower = fallbackKey.toLowerCase();
    const fallbackPng = assetsMap.get(`${fallbackLower}.png`);
    if (fallbackPng) return `${githubAssetsUrl}/${fallbackPng}`;

    const fallbackWebp = assetsMap.get(`${fallbackLower}.webp`);
    if (fallbackWebp) return `${githubAssetsUrl}/${fallbackWebp}`;

    return fallbackImages[fallbackKey] ?? DEFAULT_FALLBACK;
}

async function getState(): Promise<GameState> {
    try {
        const data = await fs.readFile(stateFile, 'utf8');
        return JSON.parse(data) as GameState;
    } catch {
        return { dispatches: {}, orders: {}, campaigns: {} };
    }
}

async function saveState(state: GameState): Promise<void> {
    await fs.writeFile(stateFile, JSON.stringify(state, null, 2));
}

async function translateText(text: string): Promise<string> {
    if (!text) return "";
    try {
        const result = await translate(text, { to: config.language });
        return result.text;
    } catch {
        return text;
    }
}

function formatMarkdown(text: string): string {
    return text ? text.replace(/<i=\d+>/g, '**').replace(/<\/i>/g, '**') : "";
}

function generateProgressBar(health: number, maxHealth: number): string {
    if (!health || !maxHealth) return "[░░░░░░░░░░] 0.0%";
    const percentage = 100 - ((health / maxHealth) * 100);
    const clampedPercentage = Math.max(0, Math.min(100, percentage));

    const totalBlocks = 10;
    const filledBlocks = Math.round((clampedPercentage / 100) * totalBlocks);
    const emptyBlocks = Math.max(0, totalBlocks - filledBlocks);
    return `[${'█'.repeat(filledBlocks)}${'░'.repeat(emptyBlocks)}] ${clampedPercentage.toFixed(1)}%`;
}

function calculateETA(currentHealth: number, campaignId: string, previousCampaignState: any): string {
    if (!previousCampaignState || !previousCampaignState[campaignId]) return "";

    const prev = previousCampaignState[campaignId];
    const healthDiff = prev.lastHealth - currentHealth;
    const timeDiffMs = Date.now() - prev.lastChecked;

    if (healthDiff <= 0 || timeDiffMs <= 0) return "\n**Статус:** Опір ворога або регенерація";

    const healthPerMillisecond = healthDiff / timeDiffMs;
    const msToLiberation = currentHealth / healthPerMillisecond;

    const totalHours = Math.floor(msToLiberation / (1000 * 60 * 60));
    const totalMinutes = Math.floor((msToLiberation % (1000 * 60 * 60)) / (1000 * 60));

    if (totalHours > 240) return "\n**ETA:** Понад 10 днів";
    return `\n⚡ **ETA:** ${totalHours}г ${totalMinutes}хв`;
}

async function fetchGameData(): Promise<any> {
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

        const allDispatches = await dispatchesRes.json() as any[];
        const latestDispatch = allDispatches.length > 0 ? [allDispatches[0]] : [];
        const orders = await ordersRes.json() as any[];
        const campaigns = await campaignsRes.json() as any[];

        const orderPlanetIds = new Set<number>();
        orders.forEach(order => {
            order.tasks?.forEach((task: any) => {
                task.values?.forEach((val: number) => orderPlanetIds.add(val));
            });
        });

        const filteredCampaigns = campaigns.filter(camp => orderPlanetIds.has(camp.planet.index));

        return { dispatches: latestDispatch, orders, campaigns: filteredCampaigns };
    } catch {
        return null;
    }
}

async function buildEmbed(item: any, type: "dispatches" | "orders" | "campaigns", previousState?: any): Promise<WebhookPayload> {
    let title = "", description = "", color = 0, thumbnail = "", footerText: string | null = null;

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
        item.tasks?.forEach((task: any, idx: number) => {
            const current = item.progress?.[idx] || 0;
            let target = task.values?.[1] || task.values?.[2] || 1000000;
            taskProgress += `${config.templates.taskLabel} ${idx + 1}: \`${current.toLocaleString()} / ${target.toLocaleString()}\`\n`;
        });

        title = config.templates.orderTitle;
        description = `${formatMarkdown(translatedBriefing)}\n\n**Прогрес виконання:**\n${taskProgress}`;
        color = 16761088;
        thumbnail = getAssetUrl("super_earth", "super_earth");

        if (item.reward?.amount) {
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
        const etaText = calculateETA(health, item.id.toString(), previousState);

        description = `**${config.templates.factionLabel}:** ${item.faction || config.templates.unknownFaction}\n**${config.templates.liberationLabel}:**\n\`${progress}\`${etaText}\n\n👥 **${config.templates.playersLabel}:** ${players.toLocaleString()}`;
        color = factionStr.includes("terminid") ? 16752640 : factionStr.includes("automaton") ? 16711680 : 3447003;
        thumbnail = getAssetUrl(planetName, factionStr);
    }

    const embed: DiscordEmbed = { title, description, color, thumbnail: { url: thumbnail } };
    if (footerText) embed.footer = { text: footerText };

    return { username: config.botName, embeds: [embed] };
}

async function syncCategory(liveItems: any[], stateCategoryMap: any, categoryName: "dispatches" | "orders" | "campaigns", previousState?: any): Promise<void> {
    const liveMap = new Map(liveItems.map(item => [item.id.toString(), item]));
    const liveIds = Array.from(liveMap.keys());
    const savedIds = Object.keys(stateCategoryMap);

    const toDelete = savedIds.filter(id => !liveIds.includes(id));
    const toCreate = liveIds.filter(id => !savedIds.includes(id));
    const toUpdate = liveIds.filter(id => savedIds.includes(id));

    for (const id of toDelete) {
        const messageId = categoryName === "campaigns" ? stateCategoryMap[id]?.messageId : stateCategoryMap[id];
        if (messageId) await discord.delete(messageId);
        delete stateCategoryMap[id];
    }

    for (const id of toCreate) {
        const item = liveMap.get(id);
        const payload = await buildEmbed(item, categoryName, previousState);

        if (config.pingRoleId && (categoryName === "orders" || categoryName === "dispatches")) {
            payload.content = `<@&${config.pingRoleId}>`;
        }

        const messageId = await discord.post(payload);
        if (messageId) {
            if (categoryName === "campaigns") {
                stateCategoryMap[id] = {
                    messageId,
                    lastHealth: item.planet?.health || 0,
                    lastChecked: Date.now()
                };
            } else {
                stateCategoryMap[id] = messageId;
            }
        }
    }

    for (const id of toUpdate) {
        const item = liveMap.get(id);
        if (categoryName === "campaigns") {
            const messageId = stateCategoryMap[id]?.messageId;
            if (messageId) {
                const payload = await buildEmbed(item, categoryName, previousState);
                await discord.patch(messageId, payload);

                stateCategoryMap[id].lastHealth = item.planet?.health || 0;
                stateCategoryMap[id].lastChecked = Date.now();
            }
        } else if (categoryName === "orders") {
            const messageId = stateCategoryMap[id];
            if (messageId) {
                const payload = await buildEmbed(item, categoryName);
                await discord.patch(messageId, payload);
            }
        }
    }
}

async function syncEngine(): Promise<void> {
    console.log("» initializing type-safe dashboard sync...");
    await loadAssetsMap();

    const liveData = await fetchGameData();
    if (!liveData) return;

    const state = await getState();
    const previousCampaignCopy = JSON.parse(JSON.stringify(state.campaigns));

    await syncCategory(liveData.dispatches, state.dispatches, "dispatches");
    await syncCategory(liveData.orders, state.orders, "orders");
    await syncCategory(liveData.campaigns, state.campaigns, "campaigns", previousCampaignCopy);

    await saveState(state);
    console.log("» sync complete. dashboard is live.");
}

syncEngine();