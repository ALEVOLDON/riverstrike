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

  let gameRef      = null;
  let sceneRef     = null;
  let pendingStart = false;

  // ── Highscore ───────────────────────────────────────────────────────────────────────────
  const HiScore = {
    key: 'riverStrike_hi',
    get() { return parseInt(localStorage.getItem(this.key) || '0', 10); },
    save(score) {
      if (score > this.get()) { localStorage.setItem(this.key, String(Math.floor(score))); return true; }
      return false;
    }
  };

  // ── Leaderboard (top-5) ────────────────────────────────────────────────────────
  const Leaderboard = {
    key: 'riverStrike_lb',
    get() {
      try { return JSON.parse(localStorage.getItem(this.key) || '[]'); }
      catch { return []; }
    },
    add(score) {
      const board = this.get();
      board.push({ score, ts: Date.now() });
      board.sort((a, b) => b.score - a.score);
      const top = board.slice(0, 5);
      localStorage.setItem(this.key, JSON.stringify(top));
      return top;
    }
  };

  // ── Haptic feedback ───────────────────────────────────────────────────────────────────────
  const Haptic = {
    tap(pattern = [40])  { if (navigator.vibrate) navigator.vibrate(pattern); },
    hit()                { this.tap([30]);       },
    kill()               { this.tap([60, 30, 60]); },
    damage()             { this.tap([100, 40, 80]); },
    fuel()               { this.tap([20]);       }
  };

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

    shieldHum() {
      // Short electric hum pulse — call each frame shield is active
      if (!this.ctx || this.ctx.state !== 'running') return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sine'; o.frequency.value = 320;
      g.gain.setValueAtTime(0.012, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      o.connect(g); g.connect(this.sfx);
      o.start(t); o.stop(t + 0.08);
    },

    bridgeScrape() {
      // Metal scrape noise on bridge collision
      if (!this.ctx || this.ctx.state !== 'running') return;
      const t = this.ctx.currentTime;
      const sz  = Math.floor(this.ctx.sampleRate * 0.18);
      const buf = this.ctx.createBuffer(1, sz, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < sz; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / sz);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 1200;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.35, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      src.connect(hp); hp.connect(g); g.connect(this.sfx);
      src.start(t);
      this.playTone(220, 0.15, 'sawtooth', 0.06, this.sfx, 0.002, 0.1);
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
      // ── Combo system
      this.combo         = 0;
      this.comboTimer    = 0;
      this.comboText     = null;
      // ── Power-up state
      this.shieldActive  = false;
      this.shieldTimer   = 0;
      this.doubleShotOn  = false;
      this.doubleShotTimer = 0;
      this.bombPending   = false;
      // ── Fuel alarm
      this.fuelAlarmCd   = 0;
      // ── Pause
      this.paused        = false;
      // ── Boss
      this.bossCd        = 120;  // first boss after 120s
      this.bossActive    = false;
      // ── Wave banner
      this.lastWaveBanner = 0;
      // ── Damage smoke
      this.damageSmokeTimer = 0;

      this.keys = this.input.keyboard.addKeys({
        left:  Phaser.Input.Keyboard.KeyCodes.LEFT,
        right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
        up:    Phaser.Input.Keyboard.KeyCodes.UP,
        down:  Phaser.Input.Keyboard.KeyCodes.DOWN,
        a:     Phaser.Input.Keyboard.KeyCodes.A,
        d:     Phaser.Input.Keyboard.KeyCodes.D,
        w:     Phaser.Input.Keyboard.KeyCodes.W,
        s:     Phaser.Input.Keyboard.KeyCodes.S,
        fire:  Phaser.Input.Keyboard.KeyCodes.SPACE,
        pause: Phaser.Input.Keyboard.KeyCodes.P
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
      // Parallax far-background layer (trees/hills behind everything)
      this.bgFar      = this.add.graphics().setDepth(-2);
      // Wake trails layer (behind enemies but in front of water)
      this.wakeGfx    = this.add.graphics().setDepth(-0.5);
      // Stars layer (for night phase)
      this.starsGfx   = this.add.graphics().setDepth(-2.8);

      // Day/night cycle state (0 = dawn, 1 = full day, 2 = dusk, 3 = night)
      this.dayTime  = 0;   // 0..1 within current phase, advances with wave
      this.dayPhase = 1;   // start in daytime
      this.dayOverlay = this.add.rectangle(GAME_W * 0.5, GAME_H * 0.5, GAME_W, GAME_H, 0x000020, 0)
        .setDepth(20.5).setScrollFactor(0);

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
      this.powerups      = this.physics.add.group();   // NEW: power-up drops
      this.bridges       = [];                          // NEW: bridge obstacles (graphics array)

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
        Haptic.hit();
        if (e.hp <= 0) {
          this.spawnExplosion(e.x, e.y, e.type === 'warship');
          const baseScore = e.type === 'warship' ? 180 : 75;
          // Combo
          this.combo++;
          this.comboTimer = 3.0;
          const mult = Math.min(4, 1 + Math.floor(this.combo / 3));
          this.scoreValue += baseScore * mult;
          if (mult > 1) this.showCombo(e.x, e.y, mult);
          Haptic.kill();
          if (e.rotor) e.rotor.destroy();
          e.destroy();
        }
      });

      // Power-up pickup
      this.physics.add.overlap(this.player, this.powerups, (_p, pu) => {
        this.collectPowerup(pu.puType);
        pu.destroy();
      });

      // Player vs bridges
      this.overlapBridges = () => {
        for (const br of this.bridges) {
          if (!br.active || !this.running) continue;
          const px = this.player.x, py = this.player.y;
          if (py > br.y - 6 && py < br.y + 6 && px > br.lx && px < br.rx) {
            this.damagePlayer();
            break;
          }
        }
      };

      this.physics.add.overlap(this.player, this.fuels, (_p, f) => {
        this.fuelValue = Math.min(100, this.fuelValue + 28);
        this.scoreValue += 60;
        Audio.pickup();
        Haptic.fuel();
        this.sparkEmitter.setPosition(f.x, f.y);
        this.sparkEmitter.setParticleTint(0x00ffcc);
        this.sparkEmitter.explode(12);
        f.destroy();
      });

      this.physics.add.overlap(this.player, this.enemyBullets, (_p, b) => {
        b.destroy();
        this.damagePlayer();
      });

      // Kamikaze enemies damage player on contact
      this.physics.add.overlap(this.player, this.enemies, (_p, e) => {
        if (e.type !== 'kamikaze') return;
        this.spawnExplosion(e.x, e.y, false);
        if (e.rotor) e.rotor.destroy();
        e.destroy();
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
          Haptic.hit();
        }
      });

      this.physics.world.setBounds(0, 0, GAME_W, GAME_H);
      this.updateUi();
      // Show leaderboard on the start overlay
      const board = Leaderboard.get();
      const hiLine = document.getElementById('hi-line');
      if (hiLine && board.length > 0) {
        hiLine.innerHTML = board
          .map((e, i) => `${['🥇','🥈','🥉','4.','5.'][i] || ''} ${e.score}`)
          .join(' &nbsp; ');
      }

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

      // ── boat (20x16) — patrol boat with hull, cabin, and gun
      g.clear();
      g.fillStyle(0x3c6070, 1);
      g.fillTriangle(10, 1, 19, 15, 1, 15);              // hull triangle
      g.fillStyle(0x2a4a58, 1); g.fillRect(6, 8, 8, 5);  // cabin
      g.fillStyle(0x4a7888, 0.8); g.fillRect(7, 9, 6, 2); // cabin window
      g.fillStyle(0xcc4422, 1); g.fillRect(9, 4, 2, 6);  // gun barrel
      g.fillStyle(0x8a5020, 1); g.fillRect(8, 9, 4, 3);  // gun base
      g.fillStyle(0x1a3040, 0.7); g.fillRect(2, 14, 16, 2); // waterline
      g.generateTexture('boat', 20, 16);

      // ── heli (24x14) — gunship helicopter, top-down view
      g.clear();
      g.fillStyle(0x5a7040, 1); g.fillRoundedRect(4, 4, 16, 7, 2); // body
      g.fillStyle(0x3a5030, 1); g.fillRoundedRect(6, 5, 12, 5, 2); // body shadow
      g.fillStyle(0x8ab878, 0.6); g.fillRect(7, 5, 8, 2);           // cockpit glass
      g.fillStyle(0x4c6838, 1); g.fillRect(18, 6, 6, 2);            // tail boom
      g.fillStyle(0x3a5028, 1); g.fillRect(22, 5, 2, 4);            // tail fin
      g.fillStyle(0xb0c890, 0.4); g.fillRect(0, 6, 24, 2);          // rotor disc
      g.fillStyle(0x283820, 1); g.fillCircle(9, 7, 2);               // rotor hub
      g.fillStyle(0x3c5030, 1); g.fillRect(3, 9, 3, 2);              // left skid
      g.fillStyle(0x3c5030, 1); g.fillRect(18, 9, 3, 2);             // right skid
      g.fillStyle(0xff3333, 0.9); g.fillRect(10, 3, 2, 2);           // gun sight
      g.generateTexture('heli', 24, 14);

      // ── warship (28x18) — heavy gunboat, top-down
      g.clear();
      g.fillStyle(0x3a4e5c, 1); g.fillRect(3, 3, 22, 14);            // hull base
      g.fillStyle(0x1e3040, 1); g.fillTriangle(14, 0, 25, 3, 3, 3);  // bow
      g.fillStyle(0x4a6072, 1); g.fillRect(5, 5, 18, 9);             // deck lighter
      g.fillStyle(0x1e3040, 0.8); g.fillRect(3, 15, 22, 3);           // stern/waterline
      g.fillStyle(0x2a3e50, 1); g.fillRect(9, 4, 10, 7);             // superstructure
      g.fillStyle(0x3c5264, 1); g.fillRect(11, 3, 6, 3);             // bridge
      g.fillStyle(0x6a8898, 0.5); g.fillRect(12, 3, 4, 2);           // bridge window
      g.fillStyle(0x1a2c3c, 1);
      g.fillRect(4, 8, 7, 3);    // left main gun
      g.fillRect(17, 8, 7, 3);   // right main gun
      g.fillRect(12, 1, 4, 4);   // bow gun
      g.fillStyle(0xcc3333, 0.8); g.fillRect(5, 9, 5, 1);            // left tracer
      g.fillStyle(0xcc3333, 0.8); g.fillRect(18, 9, 5, 1);           // right tracer
      g.fillStyle(0x5a7888, 0.6); g.fillRect(6, 5, 3, 2);            // AA left
      g.fillStyle(0x5a7888, 0.6); g.fillRect(19, 5, 3, 2);           // AA right
      g.generateTexture('warship', 28, 18);

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

      // ── Island type 1: dense forest island ─────────────────────────────────
      g.clear();
      g.fillStyle(0x4ab8d4, 0.28); g.fillCircle(16, 16, 15);   // water shimmer
      g.fillStyle(0xd4b454, 1);    g.fillCircle(16, 16, 12);   // sandy beach
      g.fillStyle(0xc09c40, 0.55); g.fillCircle(18, 18, 7);    // sand shading
      g.fillStyle(0x4a8c38, 1);    g.fillCircle(15, 14, 9);    // grass base
      g.fillStyle(0x3a7030, 1);    g.fillCircle(14, 13, 6);    // dark grass
      g.fillStyle(0x6c4428, 1);    g.fillRect(13, 7, 3, 7);   // tree trunk
      g.fillStyle(0x2c6c28, 1);    g.fillCircle(15, 9, 6);     // foliage 1
      g.fillStyle(0x3c8038, 0.9);  g.fillCircle(14, 7, 4);     // foliage 2
      g.fillStyle(0x50a048, 0.7);  g.fillCircle(15, 5, 3);     // foliage top
      g.generateTexture('isl1', 32, 32);

      // ── Island type 2: elongated sandbar ────────────────────────────────────
      g.clear();
      g.fillStyle(0x4ab8d4, 0.24);
      g.fillCircle(7, 16, 7); g.fillCircle(25, 16, 7);         // water edge caps
      g.fillRect(7, 9, 18, 14);                                 // water edge body
      g.fillStyle(0xdcbc58, 1);
      g.fillCircle(8, 16, 6); g.fillCircle(24, 16, 6);         // sand caps
      g.fillRect(8, 10, 16, 12);                                // sand body
      g.fillStyle(0xa8904c, 0.5); g.fillCircle(22, 17, 5);     // sand shadow
      g.fillStyle(0x58903c, 1);   g.fillCircle(9, 14, 4);      // left grass patch
      g.fillStyle(0x447030, 1);   g.fillCircle(9, 13, 3);
      g.fillStyle(0x6c4428, 1);   g.fillRect(8, 7, 2, 6);      // small tree
      g.fillStyle(0x306028, 1);   g.fillCircle(9, 8, 4);
      g.fillStyle(0x407833, 0.8); g.fillCircle(9, 6, 3);
      g.generateTexture('isl2', 32, 32);

      // ── Island type 3: ruins island ─────────────────────────────────────────
      g.clear();
      g.fillStyle(0x4ab8d4, 0.25); g.fillCircle(16, 16, 14);   // water shimmer
      g.fillStyle(0xc8a84a, 1);    g.fillCircle(16, 16, 12);   // sandy base
      g.fillStyle(0x4a8838, 1);    g.fillCircle(15, 16, 9);    // grass
      g.fillStyle(0x386828, 1);    g.fillCircle(16, 17, 6);    // dark grass
      g.fillStyle(0x8a8070, 1);    g.fillRect(11, 8, 4, 8);    // left wall
      g.fillStyle(0x8a8070, 1);    g.fillRect(17, 8, 4, 8);    // right wall
      g.fillStyle(0x8a8070, 1);    g.fillRect(11, 8, 10, 3);   // lintel
      g.fillStyle(0xaaa090, 1);    g.fillRect(11, 8, 10, 1);   // stone highlight
      g.fillStyle(0xaaa090, 1);    g.fillRect(11, 8, 1, 8);    // side highlight
      g.fillStyle(0x282018, 1);    g.fillRect(13, 11, 6, 5);   // doorway
      g.fillStyle(0x5e5848, 0.8);  g.fillRect(19, 10, 1, 4);   // wall crack
      g.generateTexture('isl3', 32, 32);

      // ── Boss cruiser texture (60x40) ──────────────────────────────────
      g.clear();
      // Hull
      g.fillStyle(0x2a3840, 1); g.fillRect(10, 4, 40, 28);
      g.fillStyle(0x1a2830, 1); g.fillRect(15, 2, 30, 5);     // bow
      g.fillStyle(0x344c5a, 1); g.fillRect(12, 8, 36, 18);    // deck lighter
      // Armour stripe
      g.fillStyle(0x4a6878, 0.8); g.fillRect(12, 8, 36, 2);
      g.fillStyle(0x142030, 0.9); g.fillRect(12, 28, 36, 2);  // waterline
      // Superstructure
      g.fillStyle(0x3c5060, 1); g.fillRect(22, 4, 16, 12);
      g.fillStyle(0x4e6678, 1); g.fillRect(24, 2, 12, 4);
      // Main cannons (3 guns)
      g.fillStyle(0x1e2c38, 1);
      g.fillRect(14, 12, 8, 3);   // left gun
      g.fillRect(38, 12, 8, 3);   // right gun
      g.fillRect(26, 1, 8, 4);    // centre top gun
      // Turret details
      g.fillStyle(0x607888, 1);
      g.fillRect(24, 8, 12, 6);   // bridge window
      g.fillStyle(0x8ab0c0, 0.5);
      g.fillRect(25, 9, 10, 2);
      // HP bar bg (red bottom strip as hint)
      g.fillStyle(0xcc2222, 0.9); g.fillRect(12, 30, 36, 2);
      g.generateTexture('boss_tex', 60, 40);

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
      // ── Power-up status chip
      const puEl = document.getElementById('powerup-status');
      if (puEl) {
        if (this.shieldActive && this.shieldTimer > 0) {
          puEl.textContent = `💠 SHIELD ${Math.ceil(this.shieldTimer)}s`;
        } else if (this.doubleShotOn && this.doubleShotTimer > 0) {
          puEl.textContent = `⚡ DOUBLE ${Math.ceil(this.doubleShotTimer)}s`;
        } else {
          puEl.textContent = '';
        }
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
      this.combo        = 0;
      this.comboTimer   = 0;
      this.shieldActive = false; this.shieldTimer = 0;
      this.doubleShotOn = false; this.doubleShotTimer = 0;
      this.fuelAlarmCd  = 0;
      this.paused       = false;
      this.bossCd       = 120;
      this.bossActive   = false;
      this.lastWaveBanner = 0;
      this.damageSmokeTimer = 0;
      // Clear bridges
      this.bridges.forEach(b => { if (b.gfx) b.gfx.destroy(); });
      this.bridges = [];
      // Clear powerup labels then group
      this.powerups.children.each(pu => { if (pu.label) pu.label.destroy(); });
      this.powerups.clear(true, true);

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
      Haptic.damage();
      // ── Top-5 leaderboard
      const score = Math.floor(this.scoreValue);
      const board = Leaderboard.add(score);
      const isNew = board[0].score === score && board[0].ts === board[0].ts; // just saved
      const hi    = board[0].score;
      ui.overlay.classList.remove('hidden');
      ui.overlay.querySelector('h1').textContent = 'Game Over';
      const hiLine = document.getElementById('hi-line');
      if (hiLine) {
        hiLine.innerHTML = board
          .map((e, i) => `${['🥇','🥈','🥉','4.','5.'][i] || ''} ${e.score}`)
          .join(' &nbsp; ');
      }
      ui.overlay.querySelector('p').textContent =
        `Score: ${score}${score === hi && board.length === 1 ? ' 🏆 New Record!' : ''}`;
    }

    // ── damagePlayer ──────────────────────────────────────────────────────────
    damagePlayer() {
      if (this.player.invuln > 0) return;
      // Shield absorbs one hit
      if (this.shieldActive) {
        this.shieldActive = false;
        this.shieldTimer  = 0;
        this.player.invuln = 0.6;
        this.flash(0x55aaff, 120);
        this.cameras.main.shake(80, 0.008);
        Haptic.hit();
        this.updateUi();
        return;
      }
      this.livesValue--;
      this.player.invuln = 1.1;
      this.damageSmokeTimer = 4.0;  // smoke trail for 4 seconds
      this.flash(0xff8c73, 95);
      this.spawnExplosion(this.player.x, this.player.y, true);
      Haptic.damage();
      this.updateUi();
      if (this.livesValue <= 0) this.stopRun();
    }

    // ── showWaveBanner ────────────────────────────────────────────────────────
    showWaveBanner(waveNum) {
      const txt = this.add.text(GAME_W * 0.5, GAME_H * 0.5 - 20, `WAVE  ${waveNum}`, {
        fontFamily: 'Orbitron, monospace', fontSize: '18px',
        color: '#ffe060', stroke: '#000', strokeThickness: 4
      }).setDepth(35).setOrigin(0.5, 0.5).setAlpha(0);
      this.tweens.add({
        targets: txt, alpha: 1, duration: 300, ease: 'Cubic.easeOut',
        onComplete: () => {
          this.tweens.add({ targets: txt, alpha: 0, duration: 500, delay: 800,
            onComplete: () => txt.destroy() });
        }
      });
    }

    // ── spawnBoss ─────────────────────────────────────────────────────────────
    spawnBoss() {
      if (this.bossActive) return;
      const r  = this.riverAt(0);
      const bx = r.center;
      const b  = this.enemies.create(bx, -32, 'boss_tex');
      b.type    = 'boss';
      b.hp      = 12;
      b.speed   = this.speed * 0.28;
      b.vx      = 0;
      b.fireCd  = 1.2;
      b.setDepth(8);
      this.bossActive = true;
      // Banner
      const warn = this.add.text(GAME_W * 0.5, GAME_H * 0.5 - 40, '⚠ BOSS ⚠', {
        fontFamily: 'Orbitron, monospace', fontSize: '16px',
        color: '#ff4444', stroke: '#000', strokeThickness: 4
      }).setDepth(36).setOrigin(0.5).setAlpha(0);
      this.tweens.add({ targets: warn, alpha: 1, duration: 200, yoyo: true,
        repeat: 4, onComplete: () => warn.destroy() });
      Audio.explode(true);
      this.cameras.main.shake(200, 0.022);
    }

    // ── showCombo ─────────────────────────────────────────────────────────────
    showCombo(x, y, mult) {
      const txt = this.add.text(x, y, `x${mult}!`, {
        fontFamily: 'Orbitron, monospace', fontSize: '14px',
        color: ['#fff', '#ffe048', '#ff9900', '#ff4400'][mult - 1] || '#ff4400',
        stroke: '#000', strokeThickness: 3
      }).setDepth(30).setOrigin(0.5, 1);
      this.tweens.add({ targets: txt, y: y - 30, alpha: 0, duration: 900,
        ease: 'Quad.easeOut', onComplete: () => txt.destroy() });
    }

    // ── collectPowerup ────────────────────────────────────────────────────────
    collectPowerup(type) {
      Audio.pickup();
      Haptic.fuel();
      this.flash(0xeeffee, 80);
      if (type === 'shield') {
        this.shieldActive = true;
        this.shieldTimer  = 8;
      } else if (type === 'double') {
        this.doubleShotOn    = true;
        this.doubleShotTimer = 10;
      } else if (type === 'bomb') {
        this.enemies.children.each(e => {
          this.spawnExplosion(e.x, e.y, false);
          if (e.rotor) e.rotor.destroy();
          e.destroy();
        });
        this.cameras.main.shake(300, 0.025);
        this.flash(0xfff0a0, 200);
        Haptic.kill();
      }
    }

    // ── spawnPowerup ──────────────────────────────────────────────────────────
    spawnPowerup(x) {
      const types  = ['shield', 'double', 'bomb'];
      const puType = types[Math.floor(Math.random() * types.length)];
      const colors = { shield: 0x55aaff, double: 0xffee00, bomb: 0xff6622 };
      const pu = this.powerups.create(x, -16, 'spark');
      pu.puType = puType;
      pu.speed  = this.speed * 0.50;
      pu.setScale(2.2).setDepth(5).setTint(colors[puType]);
      this.tweens.add({ targets: pu, scaleX: 2.8, scaleY: 2.8, alpha: 0.7,
        duration: 400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      const labels = { shield: '💠', double: '⚡', bomb: '💣' };
      const lbl = this.add.text(x, -16, labels[puType], { fontSize: '10px' })
        .setDepth(6).setOrigin(0.5, 0.5);
      pu.label = lbl;
    }

    // ── spawnBridge ───────────────────────────────────────────────────────────
    spawnBridge() {
      const r = this.riverAt(0);
      this.bridges.push({
        active: true, y: -20,
        lx: r.center - r.riverW * 0.5,
        rx: r.center + r.riverW * 0.5,
        speed: this.speed * 0.45
      });
    }

    // ── spawnEnemyOrFuel ──────────────────────────────────────────────────────
    spawnEnemyOrFuel() {
      const r = this.riverAt(0);
      const left  = r.center - r.riverW * 0.5 + 10;
      const right = r.center + r.riverW * 0.5 - 10;
      const x = Phaser.Math.FloatBetween(left, right);
      const roll = Math.random();

      if (this.wave > 20 && Math.random() < 0.06) { this.spawnBridge(); return; }
      if (Math.random() < 0.05) { this.spawnPowerup(x); return; }
      // Kamikaze heli: 8% chance after wave 40
      if (this.wave > 40 && Math.random() < 0.08) {
        const e = this.enemies.create(x, -16, this.tex.heli || 'heli');
        e.type   = 'kamikaze';
        e.hp     = 2;
        e.speed  = this.speed * 0.55;
        e.vx     = 0;
        e.fireCd = 999;
        e.setDepth(5);
        const rk = this.textures.exists('a_rotor') ? 'a_rotor' : 'heli';
        e.rotor = this.add.image(x, -26, rk).setAlpha(0.75).setDepth(6)
                    .setScale(this.textures.exists('a_rotor') ? this.svgScale * 1.8 : 0.6);
        this.tweens.add({ targets: e.rotor, angle: 360, duration: 280, repeat: -1, ease: 'Linear' });
        return;
      }

      if (roll < 0.18) {
        const f = this.fuels.create(x, -16, this.tex.fuel);
        f.speed = this.speed * 0.55;
        if (this.tex.fuel === 'a_fuel') f.setScale(this.svgScale * 1.1);
        f.setDepth(4);
      } else if (roll < 0.30) {
        const islKeys = ['isl1', 'isl2', 'isl3'];
        const islKey  = islKeys[Math.floor(Math.random() * islKeys.length)];
        const i = this.islands.create(x, -16, islKey);
        i.speed = this.speed * 0.48;
        i.hp    = islKey === 'isl3' ? 3 : 2;  // ruins are tougher
        i.setDepth(3);
      } else {
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

        // V-formation after wave 15
        const useFormation = this.wave > 15 && type !== 'warship' && Math.random() < 0.22;
        const fpos = useFormation
          ? [{ dx: 0, dy: 0 }, { dx: -18, dy: 14 }, { dx: 18, dy: 14 }]
          : [{ dx: 0, dy: 0 }];

        fpos.forEach(fp => {
          const ex = Phaser.Math.Clamp(x + fp.dx, left, right);
          const e  = this.enemies.create(ex, -16 + fp.dy, texKey);
          if (isSvg) e.setScale(eScale);
          e.type   = type;
          e.hp     = type === 'warship' ? 4 : type === 'heli' ? 2 : 1;
          e.speed  = this.speed * (type === 'warship' ? 0.38 : 0.46);
          e.vx     = Phaser.Math.FloatBetween(-28, 28);
          e.fireCd = Phaser.Math.FloatBetween(1.5, 3.5);
          e.setDepth(4);
          if (type === 'heli') {
            const rk = this.textures.exists('a_rotor') ? 'a_rotor' : 'heli';
            const rs = rk === 'a_rotor' ? this.svgScale * 1.8 : 0.6;
            e.rotor = this.add.image(ex, -16 + fp.dy - 10, rk).setAlpha(0.75).setDepth(5).setScale(rs);
            this.tweens.add({ targets: e.rotor, angle: 360, duration: 420, repeat: -1, ease: 'Linear' });
          }
        });
      }
    }

    // ── shootFromEnemy ────────────────────────────────────────────────────────
    shootFromEnemy(e, angleOffsetDeg = 0) {
      const dx = this.player.x - e.x;
      const dy = this.player.y - e.y;
      const baseAngle = Math.atan2(dy, dx);
      const angle = baseAngle + (angleOffsetDeg * Math.PI / 180);
      const spd = e.type === 'boss' ? 110 : 90;
      const b = this.enemyBullets.create(e.x, e.y + 8, 'ebullet');
      b.vx = Math.cos(angle) * spd;
      b.vy = Math.sin(angle) * spd;
      b.setDepth(5);
    }

    // ── drawBackground ────────────────────────────────────────────────────────
    drawBackground(dt) {
      this.scroll += this.speed * dt;
      this.waterLayer.tilePositionY = -this.scroll * 0.6;
      this.waterLayer.tilePositionX = Math.sin(this.scroll * 0.0015) * 22;

      const g = this.bg;
      g.clear();

      // ── Parallax far-background trees (scroll at 30% speed) ────────────────────
      const gf = this.bgFar;
      gf.clear();
      const farScroll = this.scroll * 0.3;
      const isNight   = this.dayPhase === 2;
      const farColor  = isNight ? 0x0c1a0c : 0x1a2e14;
      for (let y = -16; y < GAME_H + 32; y += 14) {
        const wy = farScroll + y;
        const wc  = GAME_W * 0.5 + Math.sin(wy * 0.012) * 26 + Math.sin(wy * 0.0043) * 12;
        const wrW = 92 + Math.sin(wy * 0.007) * 16;
        const lx  = wc - wrW * 0.5;
        const rx  = wc + wrW * 0.5;
        // Far silhouette trees on left
        const fp1 = Math.floor(wy * 0.06);
        if (fp1 % 3 === 0 && lx > 8) {
          const ftx = Math.max(2, lx - 18 - (fp1 % 9) * 2);
          gf.fillStyle(farColor, 1);
          gf.fillTriangle(ftx + 5, y - 14, ftx, y + 2, ftx + 10, y + 2);
          gf.fillRect(ftx + 4, y + 2, 3, 6);
        }
        // Far silhouette trees on right
        const fp2 = Math.floor(wy * 0.06 + 1.8);
        if (fp2 % 3 === 0 && GAME_W - rx > 8) {
          const ftx2 = Math.min(GAME_W - 12, rx + 8 + (fp2 % 9) * 2);
          gf.fillStyle(farColor, 1);
          gf.fillTriangle(ftx2 + 5, y - 14, ftx2, y + 2, ftx2 + 10, y + 2);
          gf.fillRect(ftx2 + 4, y + 2, 3, 6);
        }
      }

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

      // ── Pause toggle
      if (Phaser.Input.Keyboard.JustDown(this.keys.pause) && this.running) {
        this.paused = !this.paused;
        if (this.paused) {
          const pauseTxt = this.add.text(GAME_W * 0.5, GAME_H * 0.5, 'PAUSED', {
            fontFamily: 'Orbitron, monospace', fontSize: '22px',
            color: '#ffe060', stroke: '#000', strokeThickness: 5
          }).setDepth(40).setOrigin(0.5).setName('pauseLabel');
        } else {
          const lbl = this.children.getByName('pauseLabel');
          if (lbl) lbl.destroy();
        }
      }
      if (this.paused) return;

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
        b.vy = -250; b.vx = 0; b.setDepth(6);
        if (this.doubleShotOn) {
          // Angled spread bullets
          const b2 = this.playerBullets.create(this.player.x - 5, this.player.y - 6, 'pbullet');
          b2.vx = -55; b2.vy = -240; b2.setDepth(6);
          const b3 = this.playerBullets.create(this.player.x + 5, this.player.y - 6, 'pbullet');
          b3.vx =  55; b3.vy = -240; b3.setDepth(6);
        }
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

      // Move bullets (player)
      this.playerBullets.children.each(b => {
        b.x += (b.vx || 0) * dt;
        b.y += b.vy * dt;
        if (b.y < -20 || b.x < -10 || b.x > GAME_W + 10) {
          // Water splash: if bullet exits over the river, spawn a small splash
          const rv = this.riverAt(0);
          if (b.x > rv.center - rv.riverW * 0.5 && b.x < rv.center + rv.riverW * 0.5 && b.y < 10) {
            this.sparkEmitter.setPosition(b.x, 2);
            this.sparkEmitter.setParticleTint(0x7bcfef);
            this.sparkEmitter.explode(4);
          }
          b.destroy();
        }
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

      // Move islands (no rotation — islands are fixed geological features)
      this.islands.children.each(i => {
        i.y += i.speed * dt;
        if (i.y > GAME_H + 24) i.destroy();
      });

      // Move enemies
      this.enemies.children.each(e => {
        const rv  = this.riverAt(e.y);
        const el  = rv.center - rv.riverW * 0.5 + 12;
        const er  = rv.center + rv.riverW * 0.5 - 12;
        if (e.type === 'kamikaze') {
          // Dive toward player
          const dx = this.player.x - e.x;
          const dy = this.player.y - e.y;
          const len = Math.hypot(dx, dy) || 1;
          const spd = e.speed * 1.8;
          e.x += (dx / len) * spd * dt;
          e.y += (dy / len) * spd * dt;
          e.angle = Math.atan2(dx, -dy) * 180 / Math.PI;
          if (e.rotor) { e.rotor.x = e.x; e.rotor.y = e.y - 10; }
        } else if (e.type === 'boss') {
          // Slow down descent, sweep left/right
          e.x += Math.sin(this.wave * 1.2) * 40 * dt;
          e.y += e.speed * dt;
          e.x = Phaser.Math.Clamp(e.x, el + 10, er - 10);
        } else {
          e.x += e.vx * dt;
          e.y += e.speed * dt;
          if (e.rotor) { e.rotor.x = e.x; e.rotor.y = e.y - 10; }
          if (e.x < el || e.x > er) { e.vx *= -1; e.x = Phaser.Math.Clamp(e.x, el, er); }
          if (e.type === 'heli') e.angle = Math.sin((e.y + this.scroll) * 0.08) * 4;
        }
        e.fireCd -= dt;
        if (e.fireCd <= 0 && e.y > 20 && e.y < GAME_H - 35 && e.type !== 'kamikaze') {
          if (e.type === 'boss') {
            // Boss fires 3 bullets in a spread
            e.fireCd = 1.4 + Phaser.Math.FloatBetween(0.2, 0.8);
            [-1, 0, 1].forEach(spread => {
              if (this.enemyBullets.countActive(true) < 12) this.shootFromEnemy(e, spread * 30);
            });
          } else {
            e.fireCd = (e.type === 'warship' ? 2.8 : 3.2) + Phaser.Math.FloatBetween(0.4, 1.2);
            if (this.enemyBullets.countActive(true) < 8 && Math.random() > 0.55) this.shootFromEnemy(e, 0);
          }
        }
        if (e.y > GAME_H + 28) {
          if (e.rotor) e.rotor.destroy();
          if (e.type === 'boss') this.bossActive = false;
          e.destroy();
        }
      });

      // ── Move power-ups
      this.powerups.children.each(pu => {
        pu.y += pu.speed * dt;
        if (pu.label) { pu.label.x = pu.x; pu.label.y = pu.y; }
        if (pu.y > GAME_H + 20) { if (pu.label) pu.label.destroy(); pu.destroy(); }
      });

      // ── Wake trails (boats & warships)
      this.wakeGfx.clear();
      this.enemies.children.each(e => {
        if (e.type !== 'boat' && e.type !== 'warship') return;
        const wAlpha = e.type === 'warship' ? 0.22 : 0.16;
        const wW     = e.type === 'warship' ? 10 : 6;
        this.wakeGfx.fillStyle(0xb8e4f9, wAlpha);
        this.wakeGfx.fillTriangle(e.x, e.y, e.x - wW, e.y + 20, e.x + wW, e.y + 20);
      });

      // ── Bridge move & render
      const bg = this.bg;
      this.bridges = this.bridges.filter(br => {
        br.y += br.speed * dt;
        if (br.y > GAME_H + 30) { br.active = false; return false; }

        const bW   = br.rx - br.lx;  // river span
        const abW  = 18;             // abutment width (extends onto bank)
        const dkH  = 8;             // deck thickness
        const deckL = br.lx - abW;
        const deckR = br.rx + abW;

        // Shadow under arch into water
        bg.fillStyle(0x000000, 0.20);
        bg.fillRect(br.lx + 2, br.y + dkH, bW - 4, 7);

        // Arch underside (darker, below deck, over river)
        bg.fillStyle(0x3a2e1a, 0.90);
        bg.fillRect(br.lx + 3, br.y + dkH - 1, bW - 6, 5);

        // Left bank abutment
        bg.fillStyle(0x5c534a, 1);
        bg.fillRect(deckL, br.y - 3, abW + 1, dkH + 6);
        bg.fillStyle(0x7a6e60, 1);
        bg.fillRect(deckL + 1, br.y - 2, abW - 1, 2);
        bg.fillStyle(0x3e3630, 1);
        bg.fillRect(deckL, br.y + dkH + 2, abW + 1, 2);

        // Right bank abutment
        bg.fillStyle(0x5c534a, 1);
        bg.fillRect(br.rx - 1, br.y - 3, abW + 1, dkH + 6);
        bg.fillStyle(0x7a6e60, 1);
        bg.fillRect(br.rx, br.y - 2, abW - 1, 2);
        bg.fillStyle(0x3e3630, 1);
        bg.fillRect(br.rx - 1, br.y + dkH + 2, abW + 1, 2);

        // Bridge deck
        bg.fillStyle(0x6a6052, 1);
        bg.fillRect(deckL, br.y, deckR - deckL, dkH);

        // Road surface top strip
        bg.fillStyle(0x88786a, 1);
        bg.fillRect(deckL + 1, br.y + 1, deckR - deckL - 2, 2);

        // Guardrail top highlight
        bg.fillStyle(0xb0a898, 0.85);
        bg.fillRect(deckL, br.y, deckR - deckL, 1);

        // Guardrail bottom shadow
        bg.fillStyle(0x2e2820, 0.90);
        bg.fillRect(deckL, br.y + dkH, deckR - deckL, 2);

        // Dashed centre line
        bg.fillStyle(0xf0e070, 0.70);
        for (let dx = br.lx + 6; dx < br.rx - 10; dx += 14) {
          bg.fillRect(dx, br.y + 3, 8, 1);
        }

        // Water pylons
        const midX  = (br.lx + br.rx) * 0.5;
        const pylons = bW > 60
          ? [br.lx + bW * 0.28, midX, br.rx - bW * 0.28]
          : [midX];
        pylons.forEach(plx => {
          bg.fillStyle(0x585044, 1);
          bg.fillRect(plx - 5, br.y + dkH, 10, 3);     // cap
          bg.fillStyle(0x48403a, 1);
          bg.fillRect(plx - 3, br.y + dkH + 3, 7, 11); // shaft
          bg.fillStyle(0x38302c, 1);
          bg.fillRect(plx - 5, br.y + dkH + 13, 11, 3); // footing
        });

        // Collision (river span only)
        const ppx = this.player.x, ppy = this.player.y;
        if (this.player.invuln === 0 &&
            ppy > br.y - 4 && ppy < br.y + dkH + 2 &&
            ppx > br.lx - 2 && ppx < br.rx + 2) {
          Audio.bridgeScrape();
          this.damagePlayer();
        }
        return true;
      });

      // Fuel drain
      this.fuelValue = Math.max(0, this.fuelValue - 3.2 * dt);
      if (this.fuelValue <= 0) this.damagePlayer();

      // Score & speed ramp
      this.scoreValue += dt * 18;
      this.wave       += dt;
      this.speed       = 105 + Math.min(48, this.wave * 1.6);

      // ── Boss cooldown
      this.bossCd -= dt;
      if (this.bossCd <= 0 && !this.bossActive) {
        this.spawnBoss();
        this.bossCd = 120 + Math.random() * 30;
      }

      // ── Wave banner every 30s
      const waveNum = Math.floor(this.wave / 30) + 1;
      if (waveNum > this.lastWaveBanner) {
        this.lastWaveBanner = waveNum;
        if (waveNum > 1) this.showWaveBanner(waveNum);
      }

      // ── Damage smoke trail
      if (this.damageSmokeTimer > 0) {
        this.damageSmokeTimer -= dt;
        this.explosionEmitter.setPosition(this.player.x, this.player.y + 8);
        this.explosionEmitter.explode(1);
      }

      // ── Combo decay
      if (this.comboTimer > 0) {
        this.comboTimer -= dt;
        if (this.comboTimer <= 0) this.combo = 0;
      }

      // ── Power-up timers
      if (this.shieldTimer > 0) {
        this.shieldTimer -= dt;
        if (this.shieldTimer <= 0) { this.shieldActive = false; }
      }
      if (this.doubleShotTimer > 0) {
        this.doubleShotTimer -= dt;
        if (this.doubleShotTimer <= 0) { this.doubleShotOn = false; }
      }

      // ── Shield ring visual (drawn on wakeGfx so it's not wiped by drawBackground)
      if (this.shieldActive) {
        const pulse = 0.45 + 0.35 * Math.sin(this.wave * 10);
        this.wakeGfx.lineStyle(2, 0x55aaff, pulse);
        this.wakeGfx.strokeCircle(this.player.x, this.player.y, 15);
        this.wakeGfx.lineStyle(1, 0xaaddff, pulse * 0.5);
        this.wakeGfx.strokeCircle(this.player.x, this.player.y, 18);
        // Shield hum: play every 0.3s
        this.shieldHumCd = (this.shieldHumCd || 0) - dt;
        if (this.shieldHumCd <= 0) { Audio.shieldHum(); this.shieldHumCd = 0.3; }
      }

      // ── Night stars overlay (starsGfx cleared in drawBackground)
      if (this.dayPhase === 2) {
        const starAlpha = Math.min(0.9, (this.dayTime + 0.3));
        this.starsGfx.clear();
        for (let si = 0; si < 28; si++) {
          const sx = ((si * 73 + this.scroll * 0.02) % GAME_W);
          const sy = (si * 47) % (GAME_H * 0.6);
          this.starsGfx.fillStyle(0xffffff, (0.3 + (si % 5) * 0.14) * starAlpha);
          this.starsGfx.fillRect(sx, sy, 1, 1);
        }
      } else {
        this.starsGfx.clear();
      }

      // ── Fuel alarm beep
      this.fuelAlarmCd -= dt;
      if (this.fuelValue < 20 && this.fuelAlarmCd <= 0) {
        Audio.playTone(880, 0.06, 'square', 0.08, Audio.sfx, 0.002, 0.04);
        this.fuelAlarmCd = 1.6;
      }

      // ── Day/Night cycle ─────────────────────────────────────────────────────
      // Phase advances every 60s of wave time; 4 phases: 1=day, 2=dusk, 3=night, 4=dawn
      const PHASE_LEN = 60;
      this.dayTime = (this.wave % PHASE_LEN) / PHASE_LEN;      // 0..1
      this.dayPhase = Math.floor(this.wave / PHASE_LEN) % 4;   // 0=day,1=dusk,2=night,3=dawn

      // Overlay tint & alpha by phase
      let dayAlpha  = 0;
      let dayColor  = 0x000030;
      if (this.dayPhase === 0) { dayAlpha = 0; }              // full day
      else if (this.dayPhase === 1) {                          // dusk: fade to orange-dark
        dayAlpha = this.dayTime * 0.38;
        dayColor = 0x2a0d00;
        this.dayOverlay.setFillStyle(dayColor, dayAlpha);
      } else if (this.dayPhase === 2) {                        // night
        dayAlpha = 0.38 + this.dayTime * 0.10;
        dayColor = 0x00001a;
        this.dayOverlay.setFillStyle(dayColor, dayAlpha);
      } else {                                                  // dawn: fade back
        dayAlpha = Math.max(0, 0.48 - this.dayTime * 0.48);
        dayColor = 0x1a0a00;
        this.dayOverlay.setFillStyle(dayColor, dayAlpha);
      }
      // Water gets darker at night
      const nightTint = this.dayPhase === 2
        ? Phaser.Display.Color.ValueToColor(0x3355aa)
        : Phaser.Display.Color.ValueToColor(0xffffff);
      this.waterLayer.setTint(nightTint.color);

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
