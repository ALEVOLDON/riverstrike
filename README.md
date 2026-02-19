# River Strike

> **Arcade scrolling shooter** — mobile-first, two playable versions.

[![Play v2 (Phaser)](https://img.shields.io/badge/Play-v2%20Phaser-61dafb?style=for-the-badge)](index.html)
[![Play v1 (Canvas)](https://img.shields.io/badge/Play-v1%20Canvas-4caf50?style=for-the-badge)](v1/index.html)

---

## 🎮 Versions

| | v1 — Classic Canvas | v2 — Phaser Edition |
|---|---|---|
| **Engine** | Vanilla Canvas 2D | Phaser 3.90 |
| **Entry** | [`v1/index.html`](v1/index.html) | [`index.html`](index.html) |
| **Graphics** | Procedural Canvas drawing | SVG sprites + procedural bg |
| **Audio** | Web Audio API | Web Audio API |
| **Controls** | Touch joystick + keyboard | Touch joystick + keyboard |
| **Features** | Core gameplay | + Power-ups, combo, formations, day/night, bridges, PWA |

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
| Fullscreen | `⛶` button (v2) | — |

---

## ✨ v2 Features (Phaser Edition)

### Gameplay
- **Combo multiplier** — kill streak x2/x3/x4 with floating score text
- **Power-ups** (5% spawn rate, pulsing glow):
  - 💠 **Shield** — 8 s invulnerability ring
  - ⚡ **Double Shot** — 10 s triple-bullet spread
  - 💣 **Bomb** — clears all enemies on screen
- **V-formation enemies** — boats and helis fly in tight groups after wave 15
- **Bridge obstacles** — wooden bridges appear after wave 20; hitting one costs a life

### Visuals
- SVG assets: plane, boat, heli (with animated rotor tween), warship, fuel, island
- Multi-tone earthy riverbanks — dark soil, rocks, grass tufts, 3-layer trees
- Parallax far-tree silhouette layer (30% scroll speed)
- **Day / Night cycle** — 4 phases every 60 s (Day → Dusk → Night → Dawn)
  - Night stars overlay, blue water tint
- Wake trails behind boats and warships
- Glowing bullets, SVG explosions, screen shake
- Cockpit HUD panels with blinking indicator lights and animated radar

### Audio & Haptics
- Procedural Web Audio music + SFX (shoot, hit, explosion, pickup)
- **Fuel alarm beep** when fuel < 20%
- Haptic vibration — hit / kill / damage / pickup patterns

### Polish
- Highscore saved to `localStorage`, shown on Game Over + start screen
- Fullscreen toggle button
- **PWA** — installable, works offline via service worker
- Animated ✈ plane intro on start screen

---

## 📁 Project Structure

```
River Strike/
├── index.html          ← v2 entry point
├── phaser-game.js      ← v2 all game logic (Phaser 3)
├── styles.css          ← v2 UI — cockpit panels, HUD, controls
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
| **v2.4** | Power-ups (shield/double/bomb), combo x4, V-formations, bridges, wake trails, night stars, PWA |
| **v2.3** | Highscore, haptic feedback, heli rotor tween, parallax trees, day/night cycle |
| **v2.2** | Cockpit UI panels, earthy bank textures, fullscreen, fuel bar |
| **v2.1** | Phaser port — SVG assets, physics, animated explosions, visual overhaul |
| **v1.0** | Original Canvas prototype — core gameplay, touch controls, audio |

---

## License

MIT — see [`LICENSE`](LICENSE).
