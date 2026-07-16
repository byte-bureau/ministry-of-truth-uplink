require('dotenv').config();
const translate = require('google-translate-api-x');

const apiUrl = 'https://api.helldivers2.dev/api/v1/dispatches';

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
                "X-Super-Contact": "your-discord-handle-or-email",
                "Accept": "application/json"
            }
        });

        const data = await response.json();

        if (Array.isArray(data) && data.length > 0) {
            const latestDispatch = data[0];
            const dispatchId = latestDispatch.id;
            const dispatchMessage = latestDispatch.message;

            console.log("» fetched id:", dispatchId);

            const translatedMessage = await translateToUkrainian(dispatchMessage);

            await postToDiscord(dispatchId, translatedMessage);

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