# River Strike

> **Arcade scrolling shooter** — mobile-first, two playable versions.

[![Live Demo](https://img.shields.io/badge/🎮%20Play%20Live-riverstrike.netlify.app-ff6b6b?style=for-the-badge)](https://riverstrike.netlify.app/)
[![Play v1 (Canvas)](https://img.shields.io/badge/Play-v1%20Canvas-4caf50?style=for-the-badge)](https://riverstrike.netlify.app/v1/)
[![GitHub](https://img.shields.io/badge/GitHub-Source-181717?style=for-the-badge&logo=github)](https://github.com/ALEVOLDON/River-Raid)

---

## 🎮 Versions

| | v1 — Classic Canvas | v2 — Phaser Edition |
|---|---|---|
| **Engine** | Vanilla Canvas 2D | Phaser 3.90 |
| **Entry** | [`v1/index.html`](v1/index.html) | [`index.html`](index.html) |
| **Graphics** | Procedural Canvas drawing | SVG sprites + procedural textures |
| **Audio** | Web Audio API | Web Audio API |
| **Controls** | Touch joystick + keyboard | Touch joystick + keyboard |
| **Features** | Core gameplay | Full feature set (see below) |

---

## 🚀 Play Locally

```bash
npx serve .
# Open http://localhost:3000
```

Or simply open `index.html` directly in a browser. No build step needed.

---

## 🕹️ Controls

| Action | Touch | Keyboard |
|--------|-------|----------|
| Move | Left joystick | `W A S D` / Arrow keys |
| Fire | `FIRE` button | `Space` |
| Pause | — | `P` |
| Fullscreen | `⛶` button | — |

---

## ✨ v2 Features (Phaser Edition)

### Enemies
- **Patrol Boat** — procedural pixel-art hull, cabin, gun, waterline
- **Gunship Helicopter** — body, cockpit glass, tail boom, skids, rotor hub, animated rotor tween
- **Heavy Warship** — layered hull, superstructure, bridge, 3 gun emplacements, AA guns, tracer lines
- **Boss Cruiser** — 60×40 pixel-art cruiser with 12 HP and 3-barrel spread fire; appears every ~2 min with ⚠ BOSS ⚠ warning banner
- **Kamikaze Helicopter** — dives directly at the player; explodes on contact (spawns after wave 40)
- **V-formation groups** — boats and helis fly in tight groups after wave 15

### Gameplay
- **Pause / Resume** — `P` key; displays "PAUSED" overlay
- **Wave indicator** — "WAVE N" banner slides in every 30 s of play
- **Combo multiplier** — kill streak x2/x3/x4 with floating score text
- **Power-ups** (5% spawn rate, pulsing glow):
  - 💠 **Shield** — 8 s invulnerability ring with electric hum SFX
  - ⚡ **Double Shot** — 10 s angled spread (3 bullets with side divergence)
  - 💣 **Bomb** — clears all enemies on screen
- **Bridge obstacles** — detailed stone bridges after wave 20; metal scrape SFX on hit
- **Fuel system** — drain, alarm beep below 20%, fuel canisters floating downstream

### Visuals
- SVG plane sprite (with fallback procedural textures for all entities)
- Multi-tone earthy riverbanks — dark soil, rocks, grass tufts, 3-layer trees
- Parallax far-tree silhouette layer (30% scroll speed)
- **Day / Night cycle** — 4 phases every 60 s (Day → Dusk → Night → Dawn); night stars overlay
- Wake trails behind boats and warships
- Detailed stone bridges — abutments, road deck with dashed centreline, guardrails, arch shadow, water pylons
- Procedural island variants: 🌳 Forest / 🏖 Sandbar / 🏚 Ruins (ruins have 3 HP)
- **Damage smoke trail** — player emits smoke particles for 4 s after taking a hit
- Glowing bullets, explosion sprites, particle sparks, screen shake

### Audio & Haptics
- Procedural Web Audio background music (tempo synced to speed)
- SFX: shoot, hit, explosion (large/small), pickup, fuel alarm
- **Shield hum** — quiet electric pulse every 0.3 s while shield is active
- **Bridge scrape** — high-pass noise burst + metallic tone on bridge collision
- Haptic vibration patterns: hit / kill / damage / pickup

### UX
- **Top-5 Leaderboard** — persisted to `localStorage`; shown on start screen and game over
- **Animated Game Over screen** — dedicated overlay with:
  - 💥 crash emoji pop animation
  - Large gold score counter with spring entrance
  - Staggered leaderboard rows (🥇🥈🥉) sliding in from the left
  - Current score highlighted with gold pulse if it placed
  - **Play Again** button (no page reload)
- Highscore saved to `localStorage`
- Fullscreen toggle button
- **PWA** — installable, works offline via service worker
- Animated ✈ plane intro on start screen
- Cockpit HUD panels with blinking indicator lights and animated radar

---

## 📁 Project Structure

```
River Strike/
├── index.html          ← v2 entry point
├── phaser-game.js      ← v2 all game logic (Phaser 3, ~1700 lines)
├── styles.css          ← v2 UI — cockpit panels, HUD, controls, game over
├── manifest.json       ← PWA manifest
├── sw.js               ← Service worker (offline cache)
├── assets/
│   ├── plane.svg
│   ├── boat.svg
│   ├── heli_body.svg
│   ├── heli_rotor.svg
│   ├── warship.svg
│   ├── fuel.svg
│   ├── island.svg
│   └── explosion_1-4.svg
└── v1/                 ← v1 Classic Canvas edition
    ├── index.html
    ├── styles.css
    └── game.js
```

---

## 🔧 Tech Stack

- **v1** — Vanilla JS, HTML5 Canvas 2D, Web Audio API
- **v2** — [Phaser 3](https://phaser.io/) (CDN), Web Audio API, CSS3

No npm, no bundler. Open and play.

---

## 📖 Changelog

| Version | Highlights |
|---------|------------|
| **v2.6** | Animated Game Over screen — crash emoji, score pop, staggered leaderboard rows, Play Again button |
| **v2.5** | Procedural enemy pixel-art (boat/heli/warship), shield hum SFX, bridge scrape SFX |
| **v2.4** | Boss cruiser, kamikaze heli, pause (P), wave banner, top-5 leaderboard, spread double-shot, damage smoke trail |
| **v2.3** | Power-ups (shield/double/bomb), combo x4, V-formations, bridges, wake trails, night stars, PWA |
| **v2.2** | Highscore, haptic feedback, heli rotor tween, parallax trees, day/night cycle |
| **v2.1** | Cockpit UI panels, earthy bank textures, fullscreen, fuel bar |
| **v2.0** | Phaser port — SVG assets, physics, animated explosions, visual overhaul |
| **v1.0** | Original Canvas prototype — core gameplay, touch controls, audio |

---

## License

MIT — see [`LICENSE`](LICENSE).
