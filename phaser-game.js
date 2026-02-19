(() => {
  const GAME_W = 240;
  const GAME_H = 360;

  const ui = {
    score:   document.getElementById('score'),
    fuel:    document.getElementById('fuel'),
    hp:      document.getElementById('hp'),
    overlay: document.getElementById('overlay'),
    start:   document.getElementById('start'),
    stickZone: document.getElementById('stick-zone'),
    stick:   document.getElementById('stick'),
    fire:    document.getElementById('fire'),
    fuelBar: document.getElementById('fuel-bar')
  };

  const touch = { x: 0, y: 0, firing: false, pointerId: null };

  let gameRef = null;
  let sceneRef = null;
  let pendingStart = false;

  // ─── Audio System ────────────────────────────────────────────────────────────
  const Audio = {
    ctx: null,
    master: null,
    music: null,
    sfx: null,
    musicState: { timer: 0, step: 0,
      melody: [523.25, 659.25, 783.99, 659.25, 587.33, 659.25, 698.46, 659.25],
      bass:   [130.81, 146.83, 164.81, 146.83]
    },

    init() {
      if (this.ctx) return;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx    = new Ctx();
      this.master = this.ctx.createGain();
      this.music  = this.ctx.createGain();
      this.sfx    = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.music.gain.value  = 0.85;
      this.sfx.gain.value    = 1.1;
      this.music.connect(this.master);
      this.sfx.connect(this.master);
      this.master.connect(this.ctx.destination);
    },

    unlock() {
      if (!this.ctx) this.init();
      if (this.ctx && this.ctx.state !== 'running')
        this.ctx.resume().catch(() => {});
    },

    playTone(freq, dur, type, gainVal, node, attack = 0.005, decay = 0.05) {
      if (!this.ctx || this.ctx.state !== 'running') return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g   = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gainVal, t + attack);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur + decay);
      osc.connect(g); g.connect(node);
      osc.start(t); osc.stop(t + dur + decay + 0.05);
    },

    shoot() {
      this.playTone(880,  0.06, 'square',   0.12, this.sfx, 0.002, 0.06);
      this.playTone(1600, 0.03, 'sawtooth', 0.05, this.sfx, 0.002, 0.04);
    },

    hit() {
      this.playTone(140, 0.12, 'sawtooth', 0.18, this.sfx, 0.002, 0.08);
      this.playTone(80,  0.20, 'square',   0.15, this.sfx, 0.005, 0.15);
    },

    explode(large = false) {
      if (!this.ctx || this.ctx.state !== 'running') return;
      const t = this.ctx.currentTime;
      const sz = this.ctx.sampleRate * (large ? 0.6 : 0.4);
      const buf = this.ctx.createBuffer(1, sz, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < sz; i++) d[i] = Math.random() * 2 - 1;
      const noise = this.ctx.createBufferSource();
      noise.buffer = buf;
      const ng  = this.ctx.createGain();
      const lp  = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(800, t);
      lp.frequency.exponentialRampToValueAtTime(100, t + (large ? 0.5 : 0.3));
      ng.gain.setValueAtTime(large ? 0.8 : 0.5, t);
      ng.gain.exponentialRampToValueAtTime(0.01, t + (large ? 0.5 : 0.3));
      noise.connect(lp); lp.connect(ng); ng.connect(this.sfx);
      noise.start(t);
      this.playTone(120, 0.15, 'sawtooth', 0.25, this.sfx, 0.002, 0.15);
    },

    pickup() {
      this.playTone(1200, 0.07, 'sine', 0.12, this.sfx, 0.005, 0.08);
      setTimeout(() => this.playTone(1600, 0.1, 'sine', 0.12, this.sfx, 0.005, 0.12), 70);
    },

    updateMusic(dt, speed) {
      if (!this.ctx || this.ctx.state !== 'running') return;
      this.musicState.timer -= dt;
      const beatLen = Math.max(0.12, 0.20 - (speed - 105) * 0.00015);
      while (this.musicState.timer <= 0) {
        const i    = this.musicState.step;
        const note = this.musicState.melody[i % this.musicState.melody.length];
        const bass = this.musicState.bass[Math.floor(i / 2) % this.musicState.bass.length];
        if (i % 2 === 0)
          this.playTone(bass, beatLen * 0.9, 'square',   0.06, this.music, 0.01,  0.05);
        else
          this.playTone(note, beatLen * 0.5, 'triangle', 0.05, this.music, 0.005, 0.08);
        this.musicState.step++;
        this.musicState.timer += beatLen;
      }
    }
  };

  // ─── Phaser Scene ────────────────────────────────────────────────────────────
  class RiverStrikeScene extends Phaser.Scene {
    constructor() { super('river'); }

    preload() {
      // Load SVG assets with correct filenames
      this.load.image('a_plane',   'assets/plane.svg');
      this.load.image('a_boat',    'assets/boat.svg');
      this.load.image('a_heli',    'assets/heli_body.svg');
      this.load.image('a_rotor',   'assets/heli_rotor.svg');
      this.load.image('a_warship', 'assets/warship.svg');
      this.load.image('a_fuel',    'assets/fuel.svg');
      this.load.image('a_island',  'assets/island.svg');
      this.load.image('a_expl1',   'assets/explosion_1.svg');
      this.load.image('a_expl2',   'assets/explosion_2.svg');
      this.load.image('a_expl3',   'assets/explosion_3.svg');
      this.load.image('a_expl4',   'assets/explosion_4.svg');
    }

    create() {
      sceneRef = this;
      this.running      = false;
      this.scroll       = 0;
      this.speed        = 105;
      this.scoreValue   = 0;
      this.fuelValue    = 100;
      this.livesValue   = 3;
      this.playerShotCd = 0;
      this.spawnCd      = 0.65;
      this.wave         = 0;

      this.keys = this.input.keyboard.addKeys({
        left:  Phaser.Input.Keyboard.KeyCodes.LEFT,
        right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
        up:    Phaser.Input.Keyboard.KeyCodes.UP,
        down:  Phaser.Input.Keyboard.KeyCodes.DOWN,
        a:     Phaser.Input.Keyboard.KeyCodes.A,
        d:     Phaser.Input.Keyboard.KeyCodes.D,
        w:     Phaser.Input.Keyboard.KeyCodes.W,
        s:     Phaser.Input.Keyboard.KeyCodes.S,
        fire:  Phaser.Input.Keyboard.KeyCodes.SPACE
      });

      this.makeTextures();

      this.tex = {
        plane:   this.textures.exists('a_plane')   ? 'a_plane'   : 'jet',
        boat:    this.textures.exists('a_boat')    ? 'a_boat'    : 'boat',
        heli:    this.textures.exists('a_heli')    ? 'a_heli'    : 'heli',
        warship: this.textures.exists('a_warship') ? 'a_warship' : 'warship',
        fuel:    this.textures.exists('a_fuel')    ? 'a_fuel'    : 'fuel',
        island:  this.textures.exists('a_island')  ? 'a_island'  : 'fuel'
      };
      // SVG textures are 128x128; this scale makes them ~16px on screen
      this.svgScale = 16 / 128;

      // ── Background layers ────────────────────────────────────────────────────
      this.sky       = this.add.graphics().setDepth(-3);
      this.waterLayer = this.add.tileSprite(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 'water_tex').setDepth(-2.5);
      this.bg        = this.add.graphics().setDepth(-1);

      // ── Player ───────────────────────────────────────────────────────────────
      // SVG is 128px wide; scale to 22px visible width for the player
      const planeScale = this.tex.plane === 'a_plane' ? (22 / 128) : 1;
      this.player = this.physics.add.sprite(GAME_W * 0.5, GAME_H - 48, this.tex.plane);
      this.player.setScale(planeScale);
      this.player.baseScaleX = this.player.scaleX;
      this.player.baseScaleY = this.player.scaleY;
      this.player.setDepth(10);
      this.player.setCollideWorldBounds(true);
      this.player.setCircle(this.tex.plane === 'a_plane' ? Math.round(64 * planeScale) : 8,
                            this.tex.plane === 'a_plane' ? Math.round(64 - 64 * planeScale) : 0,
                            this.tex.plane === 'a_plane' ? Math.round(64 - 64 * planeScale) : 0);
      this.player.invuln = 0;

      // ── Shadow ───────────────────────────────────────────────────────────────
      this.shadow = this.add.image(this.player.x + 10, this.player.y + 10, this.tex.plane)
        .setTint(0x000000).setAlpha(0.25).setScale(this.player.scaleX).setDepth(2);

      // ── Particles ────────────────────────────────────────────────────────────
      this.trailEmitter = this.add.particles(0, 0, 'smoke', {
        speed:      { min: 30, max: 60 },
        angle:      90,
        scale:      { start: 0.5, end: 0 },
        alpha:      { start: 0.35, end: 0 },
        lifespan:   380,
        frequency:  45,
        follow:     this.player,
        followOffset: { y: 12 }
      }).setDepth(4);

      this.explosionEmitter = this.add.particles(0, 0, 'smoke', {
        speed:    { min: 25, max: 110 },
        angle:    { min: 0, max: 360 },
        scale:    { start: 0.9, end: 2.2 },
        alpha:    { start: 0.6, end: 0 },
        lifespan: 650,
        emitting: false
      }).setDepth(6);

      this.sparkEmitter = this.add.particles(0, 0, 'spark', {
        speed:     { min: 90, max: 240 },
        angle:     { min: 0, max: 360 },
        scale:     { start: 0.8, end: 0 },
        alpha:     { start: 1, end: 0 },
        lifespan:  320,
        blendMode: 'ADD',
        emitting:  false
      }).setDepth(20);

      // ── HUD overlays ─────────────────────────────────────────────────────────
      this.scanlines = this.add.graphics().setDepth(22).setScrollFactor(0);
      this.vignette  = this.add.graphics().setDepth(23).setScrollFactor(0);
      this.drawScanlines();
      this.drawVignette();
      this.paletteOverlay = this.add.rectangle(GAME_W * 0.5, GAME_H * 0.5, GAME_W, GAME_H, 0xaad2a2, 0.06)
        .setBlendMode(Phaser.BlendModes.MULTIPLY).setDepth(21);

      // ── Physics groups ───────────────────────────────────────────────────────
      this.enemies       = this.physics.add.group();
      this.playerBullets = this.physics.add.group();
      this.enemyBullets  = this.physics.add.group();
      this.fuels         = this.physics.add.group();
      this.islands       = this.physics.add.group();

      // ── Explosion animation ──────────────────────────────────────────────────
      if (!this.anims.exists('explosion') && this.textures.exists('a_expl1')) {
        this.anims.create({
          key: 'explosion',
          frames: [
            { key: 'a_expl1' }, { key: 'a_expl2' },
            { key: 'a_expl3' }, { key: 'a_expl4' }
          ],
          frameRate: 18,
          repeat: 0
        });
      }

      // ── Audio ────────────────────────────────────────────────────────────────
      Audio.init();
      this.input.on('pointerdown', () => Audio.unlock());
      this.input.keyboard.on('keydown', () => Audio.unlock());

      // ── Overlap callbacks ────────────────────────────────────────────────────
      this.physics.add.overlap(this.playerBullets, this.enemies, (b, e) => {
        b.destroy();
        e.hp -= 1;
        this.emitSparks(b.x, b.y, 3);
        this.flash(0xffe08a, 30);
        Audio.hit();
        if (e.hp <= 0) {
          this.spawnExplosion(e.x, e.y, e.type === 'warship');
          this.scoreValue += e.type === 'warship' ? 180 : 75;
          if (e.rotor) e.rotor.destroy();
          e.destroy();
        }
      });

      this.physics.add.overlap(this.player, this.fuels, (_p, f) => {
        this.fuelValue = Math.min(100, this.fuelValue + 28);
        this.scoreValue += 60;
        Audio.pickup();
        this.sparkEmitter.setPosition(f.x, f.y);
        this.sparkEmitter.setParticleTint(0x00ffcc);
        this.sparkEmitter.explode(12);
        f.destroy();
      });

      this.physics.add.overlap(this.player, this.enemyBullets, (_p, b) => {
        b.destroy();
        this.damagePlayer();
      });

      this.physics.add.overlap(this.playerBullets, this.islands, (b, i) => {
        b.destroy();
        i.hp -= 1;
        this.emitSparks(b.x, b.y, 2);
        if (i.hp <= 0) {
          this.spawnExplosion(i.x, i.y, false);
          this.scoreValue += 40;
          i.destroy();
        } else {
          Audio.hit();
        }
      });

      this.physics.world.setBounds(0, 0, GAME_W, GAME_H);
      this.updateUi();

      if (pendingStart) { pendingStart = false; this.startRun(); }
    }

    // ── Texture generation ─────────────────────────────────────────────────────
    makeTextures() {
      const g = this.make.graphics({ x: 0, y: 0, add: false });

      // jet
      g.clear(); g.fillStyle(0xe9f7ff, 1);
      g.beginPath(); g.moveTo(8, 0); g.lineTo(14, 16); g.lineTo(8, 12); g.lineTo(2, 16); g.closePath(); g.fillPath();
      g.fillStyle(0x61cbff, 1); g.fillRect(6, 6, 4, 6);
      g.generateTexture('jet', 16, 16);

      // boat
      g.clear(); g.fillStyle(0x6f7f92, 1); g.fillTriangle(8, 1, 14, 15, 2, 15);
      g.fillStyle(0xff6f3d, 1); g.fillRect(7, 7, 2, 5);
      g.generateTexture('boat', 16, 16);

      // heli
      g.clear(); g.fillStyle(0xe9ca66, 1); g.fillRoundedRect(2, 6, 12, 6, 2);
      g.fillStyle(0x2f4b61, 1); g.fillRect(6, 3, 4, 3);
      g.generateTexture('heli', 16, 16);

      // warship
      g.clear(); g.fillStyle(0x4f6070, 1); g.fillRect(1, 6, 14, 8);
      g.fillStyle(0x2f3f4d, 1); g.fillRect(5, 3, 6, 3);
      g.fillStyle(0xff6d3f, 1); g.fillRect(7, 6, 2, 4);
      g.generateTexture('warship', 16, 16);

      // fuel
      g.clear(); g.fillStyle(0x9ef2d0, 1); g.fillCircle(8, 8, 7);
      g.fillStyle(0x0d8f73, 1); g.fillRect(4, 7, 8, 2); g.fillRect(7, 4, 2, 8);
      g.generateTexture('fuel', 16, 16);

      // player bullet — bright with glow halo
      g.clear();
      g.fillStyle(0xfff8c0, 1); g.fillRect(1, 0, 2, 6);
      g.fillStyle(0xfff0a0, 0.5); g.fillRect(0, 0, 4, 6);
      g.generateTexture('pbullet', 4, 6);

      // enemy bullet
      g.clear(); g.fillStyle(0xff7e62, 1); g.fillRect(1, 0, 2, 4);
      g.fillStyle(0xff4040, 0.4); g.fillRect(0, 0, 4, 4);
      g.generateTexture('ebullet', 4, 4);

      // fallback blast
      g.clear(); g.fillStyle(0xffc074, 1); g.fillCircle(8, 8, 5); g.generateTexture('blast', 16, 16);

      // fx: spark
      g.clear(); g.fillStyle(0xffffff, 1); g.fillCircle(4, 4, 2);
      g.fillStyle(0xffee88, 0.6); g.fillCircle(4, 4, 3.5);
      g.generateTexture('spark', 8, 8);

      // fx: smoke
      g.clear(); g.fillStyle(0xffffff, 0.10); g.fillCircle(8, 8, 7.5);
      g.fillStyle(0xffffff, 0.07); g.fillCircle(8, 8, 6);
      g.fillStyle(0xffffff, 0.05); g.fillCircle(8, 8, 4.5);
      g.generateTexture('smoke', 16, 16);

      // water tile — richer with diagonal ripples
      g.clear();
      g.fillStyle(0x0d6fb5, 1); g.fillRect(0, 0, 32, 32);
      g.fillStyle(0x1588d4, 1);
      for (let row = 0; row < 4; row++) {
        g.fillRect(0, row * 8, 32, 3);
      }
      g.lineStyle(1, 0x50b8e8, 0.35);
      for (let i = 0; i < 5; i++) {
        g.beginPath(); g.moveTo(i * 8, 0); g.lineTo(i * 8 + 4, 32); g.strokePath();
      }
      g.lineStyle(1, 0x9fd9f7, 0.22);
      for (let i = 0; i < 4; i++) {
        g.beginPath(); g.moveTo(0, i * 9); g.lineTo(32, i * 9 + 3); g.strokePath();
      }
      g.generateTexture('water_tex', 32, 32);

      // fallback explosion frames (orange circles, if svg assets missing)
      const expColors = [0xff9900, 0xff6600, 0xff3300, 0xdd2200];
      expColors.forEach((c, idx) => {
        const key = `a_expl${idx + 1}`;
        if (!this.textures.exists(key)) {
          g.clear(); g.fillStyle(c, 1); g.fillCircle(8, 8, 7 - idx);
          g.generateTexture(key, 16, 16);
        }
      });
      if (!this.anims.exists('explosion')) {
        this.anims.create({
          key: 'explosion',
          frames: [
            { key: 'a_expl1' }, { key: 'a_expl2' },
            { key: 'a_expl3' }, { key: 'a_expl4' }
          ],
          frameRate: 18, repeat: 0
        });
      }
    }

    // ── Helper: scanlines ──────────────────────────────────────────────────────
    drawScanlines() {
      this.scanlines.clear();
      this.scanlines.fillStyle(0x000000, 0.07);
      for (let y = 0; y < GAME_H; y += 2) this.scanlines.fillRect(0, y, GAME_W, 1);
    }

    // ── Helper: vignette ──────────────────────────────────────────────────────
    drawVignette() {
      this.vignette.clear();
      this.vignette.fillStyle(0x000000, 0.16);
      this.vignette.fillRect(0, 0, GAME_W, 20);
      this.vignette.fillRect(0, GAME_H - 20, GAME_W, 20);
      this.vignette.fillRect(0, 0, 12, GAME_H);
      this.vignette.fillRect(GAME_W - 12, 0, 12, GAME_H);
    }

    // ── Helper: HUD update ─────────────────────────────────────────────────────
    updateUi() {
      ui.score.textContent = Math.floor(this.scoreValue);
      ui.fuel.textContent  = `${Math.ceil(this.fuelValue)}%`;
      ui.hp.textContent    = this.livesValue;
      // Fuel colour warning on HUD text
      ui.fuel.classList.remove('warn', 'danger');
      if (this.fuelValue < 20) ui.fuel.classList.add('danger');
      else if (this.fuelValue < 40) ui.fuel.classList.add('warn');
      // Fuel bar in bottom panel
      if (ui.fuelBar) {
        const pct = Math.max(0, this.fuelValue);
        ui.fuelBar.style.width = pct + '%';
        ui.fuelBar.style.background = pct < 20
          ? 'linear-gradient(90deg, #ff4444, #ff8040)'
          : pct < 40
            ? 'linear-gradient(90deg, #ffb030, #ffe060)'
            : 'linear-gradient(90deg, #3ef07a, #61dafb)';
      }
    }

    // ── Helper: flash screen ──────────────────────────────────────────────────
    flash(color, duration) {
      const r = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, color, 0.22).setDepth(30);
      this.tweens.add({ targets: r, alpha: 0, duration, onComplete: () => r.destroy() });
    }

    // ── Helper: emit sparks ───────────────────────────────────────────────────
    emitSparks(x, y, count) {
      this.sparkEmitter.setPosition(x, y);
      this.sparkEmitter.setParticleTint(0xffaa00);
      this.sparkEmitter.explode(count);
    }

    // ── Helper: spawn explosion ───────────────────────────────────────────────
    spawnExplosion(x, y, isWarship) {
      const boom = this.add.sprite(x, y, 'a_expl1').setDepth(25).setScale(isWarship ? 0.55 : 0.38);
      boom.play('explosion');
      boom.once('animationcomplete', () => boom.destroy());

      this.explosionEmitter.setPosition(x, y);
      this.explosionEmitter.explode(isWarship ? 28 : 14);

      this.sparkEmitter.setPosition(x, y);
      this.sparkEmitter.setParticleTint(0xffd700);
      this.sparkEmitter.explode(isWarship ? 22 : 10);

      Audio.explode(isWarship);
      this.cameras.main.shake(isWarship ? 240 : 110, isWarship ? 0.018 : 0.010);
    }

    // ── Helper: riverAt ───────────────────────────────────────────────────────
    riverAt(screenY) {
      const worldY  = this.scroll + screenY;
      const center  = GAME_W * 0.5 + Math.sin(worldY * 0.012) * 26 + Math.sin(worldY * 0.0043) * 12;
      const riverW  = 92 + Math.sin(worldY * 0.007) * 16;
      return { center, riverW };
    }

    // ── startRun ──────────────────────────────────────────────────────────────
    startRun() {
      this.running      = true;
      this.scroll       = 0;
      this.speed        = 105;
      this.scoreValue   = 0;
      this.fuelValue    = 100;
      this.livesValue   = 3;
      this.playerShotCd = 0;
      this.spawnCd      = 0.65;
      this.wave         = 0;

      this.player.setPosition(GAME_W * 0.5, GAME_H - 48);
      this.player.setVisible(true);
      this.player.invuln = 0;
      this.player.alpha  = 1;
      this.shadow.setVisible(true);

      this.enemies.clear(true, true);
      this.playerBullets.clear(true, true);
      this.enemyBullets.clear(true, true);
      this.fuels.clear(true, true);
      this.islands.clear(true, true);

      Audio.unlock();
      Audio.musicState.step  = 0;
      Audio.musicState.timer = 0;

      this.updateUi();
    }

    // ── stopRun ───────────────────────────────────────────────────────────────
    stopRun() {
      this.running = false;
      this.player.setVisible(false);
      this.shadow.setVisible(false);
      this.trailEmitter.stop();
      ui.overlay.classList.remove('hidden');
      ui.overlay.querySelector('h1').textContent = 'Game Over';
      ui.overlay.querySelector('p').textContent =
        `Score: ${Math.floor(this.scoreValue)}. Press "Start" to try again.`;
    }

    // ── damagePlayer ──────────────────────────────────────────────────────────
    damagePlayer() {
      if (this.player.invuln > 0) return;
      this.livesValue--;
      this.player.invuln = 1.1;
      this.flash(0xff8c73, 95);
      this.spawnExplosion(this.player.x, this.player.y, true);
      this.updateUi();
      if (this.livesValue <= 0) this.stopRun();
    }

    // ── spawnEnemyOrFuel ──────────────────────────────────────────────────────
    spawnEnemyOrFuel() {
      const r = this.riverAt(0);
      const left  = r.center - r.riverW * 0.5 + 10;
      const right = r.center + r.riverW * 0.5 - 10;
      const x = Phaser.Math.FloatBetween(left, right);
      const roll = Math.random();

      if (roll < 0.18) {
        // fuel can
        const f = this.fuels.create(x, -16, this.tex.fuel);
        f.speed = this.speed * 0.55;
        if (this.tex.fuel === 'a_fuel') f.setScale(this.svgScale * 1.1);
        f.setDepth(4);
      } else if (roll < 0.30) {
        // island
        const i = this.islands.create(x, -16, this.tex.island);
        i.speed = this.speed * 0.48;
        i.hp    = 2;
        // Island SVGs can be large — keep them small relative to river width
        if (this.tex.island === 'a_island') i.setScale(this.svgScale * 1.1);
        i.setDepth(3);
      } else {
        // enemy
        const types   = ['boat', 'heli', 'warship'];
        const weights = [0.50, 0.30, 0.20];
        let type = 'boat';
        let rr = Math.random();
        for (let wi = 0; wi < weights.length; wi++) {
          rr -= weights[wi];
          if (rr <= 0) { type = types[wi]; break; }
        }
        if (type === 'warship' && this.wave < 30) type = 'boat';

        const texKey = this.tex[type] || 'boat';
        const isSvg  = texKey.startsWith('a_');
        const eScale = isSvg
          ? (type === 'warship' ? this.svgScale * 1.8 : this.svgScale * 1.3)
          : 1;

        const e  = this.enemies.create(x, -16, texKey);
        if (isSvg) e.setScale(eScale);
        e.type   = type;
        e.hp     = type === 'warship' ? 4 : type === 'heli' ? 2 : 1;
        e.speed  = this.speed * (type === 'warship' ? 0.38 : 0.46);
        e.vx     = Phaser.Math.FloatBetween(-28, 28);
        e.fireCd = Phaser.Math.FloatBetween(1.5, 3.5);
        e.setDepth(4);

        // heli rotor
        if (type === 'heli') {
          const rotorKey = this.textures.exists('a_rotor') ? 'a_rotor' : 'heli';
          const rotorScale = rotorKey === 'a_rotor' ? this.svgScale * 1.8 : 0.6;
          e.rotor = this.add.image(e.x, e.y - 10, rotorKey)
            .setAlpha(0.7).setDepth(5).setScale(rotorScale);
        }
      }
    }

    // ── shootFromEnemy ────────────────────────────────────────────────────────
    shootFromEnemy(e) {
      const dx = this.player.x - e.x;
      const dy = this.player.y - e.y;
      const len = Math.hypot(dx, dy) || 1;
      const spd = 90;
      const b = this.enemyBullets.create(e.x, e.y + 8, 'ebullet');
      b.vx = (dx / len) * spd;
      b.vy = (dy / len) * spd;
      b.setDepth(5);
    }

    // ── drawBackground ────────────────────────────────────────────────────────
    drawBackground(dt) {
      this.scroll += this.speed * dt;
      this.waterLayer.tilePositionY = -this.scroll * 0.6;
      this.waterLayer.tilePositionX = Math.sin(this.scroll * 0.0015) * 22;

      const g = this.bg;
      g.clear();

      // ── Sky gradient at top ─────────────────────────────────────────────────────
      g.fillGradientStyle(0x1a3a5c, 0x1a3a5c, 0x233020, 0x233020, 1);
      g.fillRect(0, 0, GAME_W, 28);

      // ── Base land (earthy tones) ───────────────────────────────────────────
      g.fillStyle(0x233020, 1);
      g.fillRect(0, 28, GAME_W, GAME_H - 28);

      for (let y = -8; y < GAME_H + 24; y += 8) {
        const worldY = this.scroll + y;
        const seed   = Math.floor(worldY * 0.1);
        const center = GAME_W * 0.5
          + Math.sin(worldY * 0.012) * 26
          + Math.sin(worldY * 0.0043) * 12;
        const riverW = 92 + Math.sin(worldY * 0.007) * 16;
        const left   = center - riverW * 0.5;
        const right  = center + riverW * 0.5;

        // ── Left bank ─────────────────────────────────────────────────────────────
        const lW = Math.max(0, left);
        if (lW > 0) {
          // Dark earth base
          g.fillStyle(0x2e3b22, 1);
          g.fillRect(0, y, lW, 9);
          // Dirt stripe variation (every few rows)
          if (seed % 5 === 0) {
            g.fillStyle(0x3d4b2a, 0.7);
            g.fillRect(0, y, lW, 4);
          }
          if (seed % 7 === 2) {
            g.fillStyle(0x4a5c30, 0.5);
            g.fillRect(Math.max(0, lW - 8), y, 8, 9);
          }
          // Pebbles / rocks
          const pr = (seed * 1103515245 + 12345) & 0x7fffffff;
          if (pr % 4 === 0) {
            const rx = (pr % Math.max(1, lW - 4)) || 2;
            g.fillStyle(0x6a6a60, 0.7);
            g.fillCircle(rx, y + 4, 2);
          }
          if (pr % 6 === 1) {
            const rx2 = ((pr >> 4) % Math.max(1, lW - 4)) || 3;
            g.fillStyle(0x555550, 0.5);
            g.fillRect(rx2, y + 2, 3, 2);
          }
          // Grass tufts at water edge
          g.fillStyle(0x4d6e35, 1);
          g.fillRect(Math.max(0, lW - 5), y, 5, 9);
          if (pr % 3 === 0) {
            g.fillStyle(0x5a8040, 0.9);
            g.fillRect(Math.max(0, lW - 3), y, 3, 5);
          }
        }

        // ── Right bank ─────────────────────────────────────────────────────────────
        const rStart = right;
        const rW = GAME_W - rStart;
        if (rW > 0) {
          g.fillStyle(0x2e3b22, 1);
          g.fillRect(rStart, y, rW, 9);
          const sr = (seed * 6364136223846793005 + 1442695040888963407) & 0x7fffffff;
          if (sr % 5 === 0) {
            g.fillStyle(0x3d4b2a, 0.7);
            g.fillRect(rStart, y, rW, 4);
          }
          if (sr % 7 === 2) {
            g.fillStyle(0x4a5c30, 0.5);
            g.fillRect(rStart, y, 8, 9);
          }
          const pr2 = (seed * 22695477 + 1) & 0x7fffffff;
          if (pr2 % 4 === 0) {
            const rx = rStart + (pr2 % Math.max(1, rW - 4));
            g.fillStyle(0x6a6a60, 0.7);
            g.fillCircle(rx, y + 3, 2);
          }
          if (pr2 % 6 === 1) {
            const rx2 = rStart + ((pr2 >> 4) % Math.max(1, rW - 4));
            g.fillStyle(0x555550, 0.5);
            g.fillRect(rx2, y + 5, 3, 2);
          }
          // Grass tufts at water edge
          g.fillStyle(0x4d6e35, 1);
          g.fillRect(rStart, y, 5, 9);
          if (pr2 % 3 === 0) {
            g.fillStyle(0x5a8040, 0.9);
            g.fillRect(rStart, y, 3, 5);
          }
        }

        // ── Trees on banks (sparser, better positioned) ───────────────────────────
        const tp = Math.floor(worldY * 0.08);
        if (tp % 4 === 0 && lW > 14) {
          const tx = Math.max(4, lW - 13 - (tp % 6));
          g.fillStyle(0x4a3218, 1); g.fillRect(tx + 2, y - 8, 2, 9);
          g.fillStyle(0x1e5c30, 1); g.fillCircle(tx + 3, y - 10, 6);
          g.fillStyle(0x2d7a44, 0.75); g.fillCircle(tx + 3, y - 13, 4);
          g.fillStyle(0x3c9050, 0.4); g.fillCircle(tx + 4, y - 15, 2.5);
        }
        const tp2 = Math.floor(worldY * 0.08 + 2.1);
        if (tp2 % 4 === 0 && rW > 14) {
          const tx2 = Math.min(GAME_W - 6, rStart + 8 + (tp2 % 6));
          g.fillStyle(0x4a3218, 1); g.fillRect(tx2, y - 8, 2, 9);
          g.fillStyle(0x1e5c30, 1); g.fillCircle(tx2 + 1, y - 10, 6);
          g.fillStyle(0x2d7a44, 0.75); g.fillCircle(tx2 + 1, y - 13, 4);
          g.fillStyle(0x3c9050, 0.4); g.fillCircle(tx2 + 2, y - 15, 2.5);
        }

        // ── River water ──────────────────────────────────────────────────────────────
        g.fillStyle(0x0f78bb, 0.88);
        g.fillRect(left, y, riverW, 9);

        // Animated ripples
        const rp = Math.floor((worldY + this.scroll * 0.25) * 0.18) % 5;
        if (rp < 2) {
          g.fillStyle(0x7bc9ed, 0.28);
          g.fillRect(left + 4 + rp * 10, y + 2, riverW * 0.28, 1);
          g.fillRect(left + riverW * 0.5 + rp * 8, y + 5, riverW * 0.28, 1);
        }

        // ── Structures on banks ───────────────────────────────────────────────────
        if (Math.floor(worldY) % 80 === 0) {
          const bH = 12 + Math.floor((Math.sin(worldY * 0.13) * 0.5 + 0.5) * 12);
          if (lW > 16) {
            g.fillStyle(0x1e2830, 1); g.fillRect(Math.max(2, lW - 16), y - bH + 9, 12, bH);
            g.fillStyle(0x2c3e4e, 1); g.fillRect(Math.max(4, lW - 14), y - bH + 11, 4, 3);
            g.fillStyle(0xffdd66, 0.5); g.fillRect(Math.max(4, lW - 14), y - bH + 11, 4, 3);
          }
          if (rW > 16) {
            g.fillStyle(0x1e2830, 1); g.fillRect(Math.min(GAME_W - 14, rStart + 4), y - bH + 9, 12, bH);
            g.fillStyle(0x2c3e4e, 1); g.fillRect(Math.min(GAME_W - 12, rStart + 6), y - bH + 11, 4, 3);
            g.fillStyle(0xffdd66, 0.5); g.fillRect(Math.min(GAME_W - 12, rStart + 6), y - bH + 11, 4, 3);
          }
        }
      }
    }

    // ── update ────────────────────────────────────────────────────────────────
    update(_time, delta) {
      const dt = Math.min(0.034, delta / 1000);

      if (this.running) {
        this.trailEmitter.start();
        Audio.updateMusic(dt, this.speed);
      } else {
        this.trailEmitter.stop();
      }

      this.drawBackground(this.running ? dt : 0);
      if (!this.running) return;

      // Shadow follows player
      this.shadow.setPosition(this.player.x + 10, this.player.y + 10);
      this.shadow.rotation = this.player.rotation;
      this.shadow.alpha    = this.player.alpha * 0.25;

      // Input
      const keyX  = (this.keys.right.isDown || this.keys.d.isDown ? 1 : 0)
                  - (this.keys.left.isDown  || this.keys.a.isDown ? 1 : 0);
      const keyY  = (this.keys.down.isDown  || this.keys.s.isDown ? 1 : 0)
                  - (this.keys.up.isDown    || this.keys.w.isDown ? 1 : 0);
      const moveX = touch.x || keyX;
      const moveY = touch.y || keyY;

      this.player.x = Phaser.Math.Clamp(this.player.x + moveX * 118 * dt, 12, GAME_W - 12);
      this.player.y = Phaser.Math.Clamp(this.player.y + moveY * 84  * dt, GAME_H - 108, GAME_H - 30);
      this.player.setAngle(moveX * 16);

      // Invuln blink
      this.player.invuln = Math.max(0, this.player.invuln - dt);
      this.player.alpha  = this.player.invuln > 0 && Math.floor(this.player.invuln * 20) % 2 === 0 ? 0.4 : 1;

      // Shoot
      this.playerShotCd -= dt;
      const firing = touch.firing || this.keys.fire.isDown;
      if (firing && this.playerShotCd <= 0) {
        this.playerShotCd = 0.13;
        const b = this.playerBullets.create(this.player.x, this.player.y - 10, 'pbullet');
        b.vy = -250;
        b.setDepth(6);
        this.emitSparks(this.player.x, this.player.y - 10, 1);
        Audio.shoot();
        this.tweens.add({
          targets: this.player, duration: 75, yoyo: true,
          scaleX: this.player.baseScaleX * 0.93,
          scaleY: this.player.baseScaleY * 1.07,
          ease: 'Quad.easeOut'
        });
      }

      // Spawn
      this.spawnCd -= dt;
      if (this.spawnCd <= 0) {
        this.spawnCd = Phaser.Math.FloatBetween(0.44, 0.78);
        this.spawnEnemyOrFuel();
      }

      // Move bullets
      this.playerBullets.children.each(b => {
        b.y += b.vy * dt;
        if (b.y < -20) b.destroy();
      });
      this.enemyBullets.children.each(b => {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.y > GAME_H + 20 || b.x < -20 || b.x > GAME_W + 20) b.destroy();
      });

      // Move fuels
      this.fuels.children.each(f => {
        f.y += f.speed * dt;
        f.angle += 40 * dt;
        const rv   = this.riverAt(f.y);
        const fl   = rv.center - rv.riverW * 0.5 + 10;
        const fr   = rv.center + rv.riverW * 0.5 - 10;
        f.x = Phaser.Math.Clamp(f.x + (rv.center - f.x) * 0.015, fl, fr);
        if (f.y > GAME_H + 20) f.destroy();
      });

      // Move islands
      this.islands.children.each(i => {
        i.y += i.speed * dt;
        i.angle = Math.sin((i.y + this.scroll) * 0.03) * 3;
        if (i.y > GAME_H + 24) i.destroy();
      });

      // Move enemies
      this.enemies.children.each(e => {
        const rv  = this.riverAt(e.y);
        const el  = rv.center - rv.riverW * 0.5 + 12;
        const er  = rv.center + rv.riverW * 0.5 - 12;
        e.x += e.vx * dt;
        e.y += e.speed * dt;
        if (e.rotor) { e.rotor.x = e.x; e.rotor.y = e.y - 10; e.rotor.rotation += 14 * dt; }
        if (e.x < el || e.x > er) { e.vx *= -1; e.x = Phaser.Math.Clamp(e.x, el, er); }
        if (e.type === 'heli') e.angle = Math.sin((e.y + this.scroll) * 0.08) * 4;
        e.fireCd -= dt;
        if (e.fireCd <= 0 && e.y > 20 && e.y < GAME_H - 35) {
          e.fireCd = (e.type === 'warship' ? 2.8 : 3.2) + Phaser.Math.FloatBetween(0.4, 1.2);
          if (this.enemyBullets.countActive(true) < 6 && Math.random() > 0.55) this.shootFromEnemy(e);
        }
        if (e.y > GAME_H + 28) { if (e.rotor) e.rotor.destroy(); e.destroy(); }
      });

      // Fuel drain
      this.fuelValue = Math.max(0, this.fuelValue - 3.2 * dt);
      if (this.fuelValue <= 0) this.damagePlayer();

      // Score & speed ramp
      this.scoreValue += dt * 18;
      this.wave       += dt;
      this.speed       = 105 + Math.min(48, this.wave * 1.6);

      this.updateUi();
    }
  }

  // ─── Boot the game ────────────────────────────────────────────────────────
  function bootGame() {
    if (gameRef) return;
    gameRef = new Phaser.Game({
      type: Phaser.AUTO,
      parent: 'game-container',
      width: GAME_W,
      height: GAME_H,
      backgroundColor: '#06131f',
      pixelArt: true,
      roundPixels: true,
      physics: { default: 'arcade', arcade: { debug: false } },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: [RiverStrikeScene]
    });
  }

  // ─── Virtual stick ────────────────────────────────────────────────────────
  function setStick(cx, cy) {
    const rect = ui.stickZone.getBoundingClientRect();
    const ox   = rect.left + rect.width  * 0.5;
    const oy   = rect.top  + rect.height * 0.5;
    let dx = cx - ox, dy = cy - oy;
    const max = rect.width * 0.32;
    const len = Math.hypot(dx, dy);
    if (len > max) { dx = dx / len * max; dy = dy / len * max; }
    touch.x = dx / max;
    touch.y = dy / max;
    ui.stick.style.left = `${32 + dx}px`;
    ui.stick.style.top  = `${32 + dy}px`;
  }
  function clearStick() {
    touch.x = touch.y = 0;
    ui.stick.style.left = '32px';
    ui.stick.style.top  = '32px';
  }

  ui.stickZone.addEventListener('pointerdown', e => {
    touch.pointerId = e.pointerId;
    ui.stickZone.setPointerCapture(e.pointerId);
    setStick(e.clientX, e.clientY);
  });
  ui.stickZone.addEventListener('pointermove', e => {
    if (e.pointerId !== touch.pointerId) return;
    setStick(e.clientX, e.clientY);
  });
  ui.stickZone.addEventListener('pointerup', e => {
    if (e.pointerId !== touch.pointerId) return;
    touch.pointerId = null; clearStick();
  });
  ui.stickZone.addEventListener('pointercancel', () => { touch.pointerId = null; clearStick(); });

  ui.fire.addEventListener('pointerdown',  () => { touch.firing = true;  });
  ui.fire.addEventListener('pointerup',    () => { touch.firing = false; });
  ui.fire.addEventListener('pointercancel',() => { touch.firing = false; });

  ui.start.addEventListener('click', () => {
    Audio.unlock();
    bootGame();
    ui.overlay.classList.add('hidden');
    if (sceneRef) sceneRef.startRun();
    else pendingStart = true;
  });
})();
