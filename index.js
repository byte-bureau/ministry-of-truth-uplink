require('dotenv').config();
const translate = require('google-translate-api-x');
const fs = require('fs/promises');
const path = require('path');

const apiUrl = 'https://api.helldivers2.dev/api/v1/dispatches';
const stateFile = path.join(__dirname, 'last_seen_id.json');

async function getLastSeenId() {
    try {
        const data = await fs.readFile(stateFile, 'utf8');
        const parsed = JSON.parse(data);
        return parsed.id;
    } catch (error) {
        return null;
    }
}

async function saveLastSeenId(id) {
    try {
        await fs.writeFile(stateFile, JSON.stringify({ id: id }));
    } catch (error) {
        console.log("x failed to save state:", error.message);
    }
}

async function translateToUkrainian(text) {
    try {
        const result = await translate(text, { to: 'uk' });
        return result.text;
    } catch (error) {
        console.log("x translation failed:", error.message);
        return text;
    }
}

function formatForDiscord(text) {
    return text.replace(/<i=\d+>/g, '**').replace(/<\/i>/g, '**');
}

async function postToDiscord(id, text) {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    const cleanText = formatForDiscord(text);

    const payload = {
        username: "ministry of truth",
        embeds: [
            {
                title: "указ верховного командування",
                description: cleanText,
                color: 16761088,
                footer: {
                    text: `id: ${id}`
                }
            }
        ]
    };

    try {
        const response = await fetch(webhookUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            console.log("» successfully posted to discord");
        } else {
            console.log("x failed to post to discord. status:", response.status);
        }
    } catch (error) {
        console.log("x error posting to discord:", error.message);
    }
}

async function fetchLatestDispatch() {
    try {
        const response = await fetch(apiUrl, {
            headers: {
                "X-Super-Client": "ministry-of-truth-uplink",
                "X-Super-Contact": "byte.bureau@tutamail.com",
                "Accept": "application/json"
            }
        });

        if (!response.ok) {
            const rawText = await response.text();
            console.log(`x api error: ${response.status} ${response.statusText}`);
            console.log(`x raw response: ${rawText}`);
            return null;
        }

        const data = await response.json();

        if (Array.isArray(data) && data.length > 0) {
            const latestDispatch = data[0];
            const dispatchId = latestDispatch.id;
            const dispatchMessage = latestDispatch.message;

            const lastSeenId = await getLastSeenId();

            if (dispatchId === lastSeenId) {
                console.log("» no new dispatches. last seen id:", lastSeenId);
                return null;
            }

            console.log("» new dispatch found. id:", dispatchId);

            const translatedMessage = await translateToUkrainian(dispatchMessage);

            await postToDiscord(dispatchId, translatedMessage);
            await saveLastSeenId(dispatchId);

            return {
                id: dispatchId,
                translated: translatedMessage
            };
        }

        console.log("x no dispatches found.");
        return null;

    } catch (error) {
        console.log("x failed to fetch data:", error.message);
        return null;
    }
}

fetchLatestDispatch();