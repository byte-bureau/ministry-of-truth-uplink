# Helldivers 2 Live Discord Webhook Dashboard

A lightweight, stateful Node.js synchronization script designed to maintain a clean, active-only tactical intelligence terminal inside a Discord channel. 

Optimized to run on low-power devices (like Termux on Android) as a scheduled task, keeping resource consumption to an absolute minimum while avoiding double-posts.

---

## Key Features

* **Live-Ops Sync:** Edits existing active orders/campaign messages and deletes expired ones automatically using local status tracking.
* **Smart Filter:** Displays planetary campaign embeds only for planets targeted by current Galactic Major Orders.
* **Non-blocking Async Asset Pipeline:** Automatically scans local files for both `.png` and `.webp` extensions and generates direct GitHub CDN links for Discord embeds, with progressive safety fallbacks.
* **Separated Config Logic:** Easily configure bot identity, translation templates, and target locale in a centralized `config.json`.

---

## Setup Guide

### 1. Installation
Clone the repository and install dependency files:
```bash
git clone [https://github.com/byte-bureau/ministry-of-truth-uplink.git](https://github.com/byte-bureau/ministry-of-truth-uplink.git)
cd ministry-of-truth-uplink
npm install