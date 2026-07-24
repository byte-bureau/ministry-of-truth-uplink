import fs from 'fs/promises';
import path from 'path';
import translate from 'google-translate-api-x';
import rawConfig from '../config.json';

const baseUrl = 'https://api.helldivers2.dev/api/v1';
const stateFile = path.join(__dirname, '../game_state.json');
const githubAssetsUrl = 'https://raw.githubusercontent.com/byte-bureau/ministry-of-truth-uplink/main/assets';
const DEFAULT_FALLBACK = `${githubAssetsUrl}/default_planet.png`;

const MIN_SAMPLE_TIME_MS = 3 * 60 * 1000;

interface GameState {
    translations?: { [sourceText: string]: string };
    dispatches: { [id: string]: string };
    orders: { [id: string]: string };
    campaigns: {
        [id: string]: {
            messageId: string;
            lastHealth: number;
            lastChecked: number;
            lastEtaText?: string;
        };
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
        objectivesHeader: string;
        factionLabel: string;
        liberationLabel: string;
        defenseLabel: string;
        invasionLevelLabel: string;
        resistanceLabel: string;
        playersLabel: string;
        taskLabel: string;
        rewardLabel: string;
        rewardUnit: string;
        unknownPlanet: string;
        unknownFaction: string;
        timeRemainingLabel: string;
        statusLabel: string;
        statusHold: string;
        etaLabel: string;
        etaOverTenDays: string;
        etaFormat: string;
        defenseTag: string;
        liberationTag: string;
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

async function translateText(text: string, state: GameState): Promise<string> {
    if (!text) return "";

    if (!state.translations) state.translations = {};

    if (state.translations[text]) {
        return state.translations[text];
    }

    try {
        const sanitizedInput = text
            .replace(/<i=\d+>/g, '**')
            .replace(/<\/i>/g, '**');

        const result = await translate(sanitizedInput, { to: config.language });
        const translatedText = result.text;

        state.translations[text] = translatedText;
        return translatedText;
    } catch (e) {
        console.log("» translation warning: fallback to original text");
        return formatMarkdown(text);
    }
}

function formatMarkdown(text: string): string {
    return text ? text.replace(/<i=\d+>/g, '**').replace(/<\/i>/g, '**') : "";
}

function generateProgressBar(percentage: number, isDefense: boolean = false): string {
    const clamped = Math.max(0, Math.min(100, percentage));
    const totalBlocks = 14;
    const filledBlocks = Math.round((clamped / 100) * totalBlocks);
    const emptyBlocks = totalBlocks - filledBlocks;

    const bar = '▰'.repeat(filledBlocks) + '▱'.repeat(emptyBlocks);
    const tag = isDefense ? config.templates.defenseTag : config.templates.liberationTag;

    return `**[${tag}]** \`[${bar}]\` **${clamped.toFixed(1)}%**`;
}

function calculateETA(currentHealth: number, campaignId: string, previousCampaignState: any): string {
    if (!previousCampaignState || !previousCampaignState[campaignId]) return "";

    const prev = previousCampaignState[campaignId];
    const timeDiffMs = Date.now() - prev.lastChecked;

    if (timeDiffMs < MIN_SAMPLE_TIME_MS) {
        return prev.lastEtaText || "";
    }

    const healthDiff = prev.lastHealth - currentHealth;

    if (healthDiff <= 0) {
        return `\n◈ **${config.templates.etaLabel}:** ${config.templates.statusHold}`;
    }

    const healthPerMillisecond = healthDiff / timeDiffMs;
    const msToLiberation = currentHealth / healthPerMillisecond;

    const totalHours = Math.floor(msToLiberation / (1000 * 60 * 60));
    const totalMinutes = Math.floor((msToLiberation % (1000 * 60 * 60)) / (1000 * 60));

    if (totalHours > 240) {
        return `\n◈ **${config.templates.etaLabel}:** ${config.templates.etaOverTenDays}`;
    }

    const formattedTime = config.templates.etaFormat
        .replace('{hours}', totalHours.toString())
        .replace('{mins}', totalMinutes.toString());

    return `\n◈ **${config.templates.etaLabel}:** ${formattedTime}`;
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

async function buildEmbed(
    item: any,
    type: "dispatches" | "orders" | "campaigns",
    state: GameState,
    previousState?: any
): Promise<WebhookPayload> {
    let title = "", description = "", color = 0, thumbnail = "", footerText: string | null = null;

    if (type === "dispatches") {
        const translated = await translateText(item.message, state);
        title = config.templates.dispatchTitle;
        description = translated;
        color = 16761088;
        thumbnail = getAssetUrl("dispatch", "dispatch");
    }
    else if (type === "orders") {
        const translatedBriefing = await translateText(item.briefing, state);

        const rawTitle = item.setting?.overrideTitle || item.title || item.overrideTitle;

        const dynamicTitle = rawTitle
            ? await translateText(rawTitle, state)
            : config.templates.orderTitle;

        let taskProgress = "";
        item.tasks?.forEach((task: any, idx: number) => {
            const current = item.progress?.[idx] || 0;
            let target = task.values?.[1] || task.values?.[2] || 1000000;
            const isDone = current >= target;
            const checkbox = isDone ? "☑" : "☐";
            taskProgress += `${checkbox} ${config.templates.taskLabel} ${idx + 1}: \`${current.toLocaleString()} / ${target.toLocaleString()}\`\n`;
        });

        title = dynamicTitle.toUpperCase();
        description = `${translatedBriefing}\n\n**${config.templates.objectivesHeader}:**\n${taskProgress}`;
        color = 16761088;
        thumbnail = getAssetUrl("super_earth", "super_earth");

        if (item.reward?.amount) {
            footerText = `${config.templates.rewardLabel}: ${item.reward.amount} ${config.templates.rewardUnit}`;
        }
    }
    else if (type === "campaigns") {
        const factionStr = item.faction ? item.faction.toLowerCase() : "unknown";
        const planetName = item.planet?.name || config.templates.unknownPlanet;
        const hasEvent = Boolean(item.planet?.event);

        let progressPercent = 0;
        let progressHeader = "";
        let extraStats = "";

        if (hasEvent) {
            const event = item.planet.event;
            const health = event.health || 0;
            const maxHealth = event.maxHealth || 1;
            progressPercent = ((maxHealth - health) / maxHealth) * 100;
            progressHeader = config.templates.defenseLabel;

            const invasionLevel = Math.round(maxHealth / 50000);
            extraStats += `◈ **${config.templates.invasionLevelLabel}:** \`${invasionLevel}\`\n`;

            if (event.endTime) {
                const diffMs = new Date(event.endTime).getTime() - Date.now();
                if (diffMs > 0) {
                    const hours = Math.floor(diffMs / (1000 * 60 * 60));
                    const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                    extraStats += `◈ **${config.templates.timeRemainingLabel}:** \`${hours}г ${mins}хв\`\n`;
                }
            }
        } else {
            const health = item.planet?.health || 0;
            const maxHealth = item.planet?.maxHealth || 1;
            progressPercent = 100 - ((health / maxHealth) * 100);
            progressHeader = config.templates.liberationLabel;

            const regenPerSec = item.planet?.regenPerSecond || 0;
            const regenPercent = (regenPerSec / maxHealth) * 3600 * 100;
            if (regenPercent > 0) {
                extraStats += `◈ **${config.templates.resistanceLabel}:** \`${regenPercent.toFixed(1)}%/год\`\n`;
            }
        }

        title = `${config.templates.campaignTitle}: ${planetName.toUpperCase()}`;
        const progressBar = generateProgressBar(progressPercent, hasEvent);
        const players = item.planet?.statistics?.playerCount || 0;
        const currentHealth = hasEvent ? item.planet.event.health : item.planet?.health;
        const etaText = calculateETA(currentHealth || 0, item.id.toString(), previousState);

        description = `◈ **${config.templates.factionLabel}:** ${item.faction || config.templates.unknownFaction}\n` +
            `${extraStats}` +
            `**${progressHeader}:**\n${progressBar}${etaText}\n\n` +
            `👥 **${config.templates.playersLabel}:** ${players.toLocaleString()}`;

        color = factionStr.includes("terminid") ? 16752640 : factionStr.includes("automaton") ? 16711680 : 3447003;
        thumbnail = getAssetUrl(planetName, factionStr);
    }

    const embed: DiscordEmbed = { title, description, color, thumbnail: { url: thumbnail } };
    if (footerText) embed.footer = { text: footerText };

    return { username: config.botName, embeds: [embed] };
}

async function syncEngine(): Promise<void> {
    console.log("» initializing type-safe dashboard sync...");
    await loadAssetsMap();

    const liveData = await fetchGameData();
    if (!liveData) return;

    let state = await getState();

    const liveDispatchIds: string[] = liveData.dispatches.map((d: any) => d.id.toString());
    const liveOrderIds: string[] = liveData.orders.map((o: any) => o.id.toString());
    const liveCampaignIds: string[] = liveData.campaigns.map((c: any) => c.id.toString());

    const stateDispatchIds: string[] = Object.keys(state.dispatches);
    const stateOrderIds: string[] = Object.keys(state.orders);
    const stateCampaignIds: string[] = Object.keys(state.campaigns);

    const hasStructureChanged =
        liveDispatchIds.some((id: string) => !stateDispatchIds.includes(id)) ||
        stateDispatchIds.some((id: string) => !liveDispatchIds.includes(id)) ||
        liveOrderIds.some((id: string) => !stateOrderIds.includes(id)) ||
        stateOrderIds.some((id: string) => !liveOrderIds.includes(id)) ||
        liveCampaignIds.some((id: string) => !stateCampaignIds.includes(id)) ||
        stateCampaignIds.some((id: string) => !liveCampaignIds.includes(id));

    if (hasStructureChanged) {
        console.log("» structural change detected! resetting terminal layout for strict hierarchy...");

        for (const id of stateCampaignIds) {
            const msgId = state.campaigns[id]?.messageId;
            if (msgId) await discord.delete(msgId);
        }
        for (const id of stateOrderIds) {
            if (state.orders[id]) await discord.delete(state.orders[id]);
        }
        for (const id of stateDispatchIds) {
            if (state.dispatches[id]) await discord.delete(state.dispatches[id]);
        }

        const existingTranslations = state.translations || {};
        state = { translations: existingTranslations, dispatches: {}, orders: {}, campaigns: {} };

        for (const item of liveData.dispatches) {
            const payload = await buildEmbed(item, "dispatches", state);
            if (config.pingRoleId) payload.content = `<@&${config.pingRoleId}>`;
            const msgId = await discord.post(payload);
            if (msgId) state.dispatches[item.id.toString()] = msgId;
        }

        for (const item of liveData.orders) {
            const payload = await buildEmbed(item, "orders", state);
            if (config.pingRoleId) payload.content = `<@&${config.pingRoleId}>`;
            const msgId = await discord.post(payload);
            if (msgId) state.orders[item.id.toString()] = msgId;
        }

        for (const item of liveData.campaigns) {
            const payload = await buildEmbed(item, "campaigns", state);
            const msgId = await discord.post(payload);
            if (msgId) {
                const currentHealth = item.planet?.event?.health ?? item.planet?.health ?? 0;
                state.campaigns[item.id.toString()] = {
                    messageId: msgId,
                    lastHealth: currentHealth,
                    lastChecked: Date.now()
                };
            }
        }
    } else {
        const previousCampaignCopy = JSON.parse(JSON.stringify(state.campaigns));

        for (const item of liveData.dispatches) {
            const msgId = state.dispatches[item.id.toString()];
            if (msgId) {
                const payload = await buildEmbed(item, "dispatches", state);
                await discord.patch(msgId, payload);
            }
        }

        for (const item of liveData.orders) {
            const msgId = state.orders[item.id.toString()];
            if (msgId) {
                const payload = await buildEmbed(item, "orders", state);
                await discord.patch(msgId, payload);
            }
        }

        for (const item of liveData.campaigns) {
            const campState = state.campaigns[item.id.toString()];
            if (campState?.messageId) {
                const payload = await buildEmbed(item, "campaigns", state, previousCampaignCopy);
                await discord.patch(campState.messageId, payload);

                const currentHealth = item.planet?.event?.health ?? item.planet?.health ?? 0;
                const timeSinceLastCheck = Date.now() - (campState.lastChecked || 0);

                if (timeSinceLastCheck >= MIN_SAMPLE_TIME_MS || !campState.lastChecked) {
                    const etaText = calculateETA(currentHealth, item.id.toString(), previousCampaignCopy);
                    campState.lastHealth = currentHealth;
                    campState.lastChecked = Date.now();
                    campState.lastEtaText = etaText;
                }
            }
        }
    }

    await saveState(state);
    console.log("» sync complete. dashboard is live.");
}

syncEngine();