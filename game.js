(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const ui = {
    score: document.getElementById('score'),
    fuel: document.getElementById('fuel'),
    hp: document.getElementById('hp'),
    overlay: document.getElementById('overlay'),
    start: document.getElementById('start')
  };

  const stickZone = document.getElementById('stick-zone');
  const stick = document.getElementById('stick');
  const fireBtn = document.getElementById('fire');

  const world = {
    width: 420,
    segments: [],
    segStep: 120,
    maxSeg: 200,
    scroll: 0,
    speed: 170,
    targetSpeed: 170,
    score: 0,
    running: false,
    lastSpawnY: 1000
  };

  const player = {
    x: 210,
    y: 640,
    r: 15,
    hp: 3,
    fuel: 100,
    cooldown: 0,
    invuln: 0
  };

  const controls = {
    x: 0,
    y: 0,
    firing: false,
    pointerId: null
  };
  const keys = new Set();
  const keyMap = {
    ArrowLeft: 'left',
    KeyA: 'left',
    ArrowRight: 'right',
    KeyD: 'right',
    ArrowUp: 'up',
    KeyW: 'up',
    ArrowDown: 'down',
    KeyS: 'down'
  };

  const bullets = [];
  const enemyBullets = [];
  const enemies = [];
  const pickups = [];
  const obstacles = [];
  const blasts = [];
  const particles = [];
  const assets = {};
  const assetList = {
    plane: 'assets/plane.svg',
    boat: 'assets/boat.svg',
    heliBody: 'assets/heli_body.svg',
    heliRotor: 'assets/heli_rotor.svg',
    warship: 'assets/warship.svg',
    island: 'assets/island.svg',
    fuel: 'assets/fuel.svg',
    boom1: 'assets/explosion_1.svg',
    boom2: 'assets/explosion_2.svg',
    boom3: 'assets/explosion_3.svg',
    boom4: 'assets/explosion_4.svg'
  };
  const assetState = { ready: false };

  let vw = 0;
  let vh = 0;
  let dpr = 1;
  let lastTime = 0;
  let animClock = 0;
  let playerTilt = 0;
  let audioCtx = null;
  let masterGain = null;
  let musicGain = null;
  let sfxGain = null;
  let audioUnlocked = false;
  const musicState = {
    timer: 0,
    step: 0,
    melody: [523.25, 659.25, 783.99, 659.25, 587.33, 659.25, 698.46, 659.25],
    bass: [130.81, 146.83, 164.81, 146.83]
  };

  function rand(min, max) {
    return Math.random() * (max - min) + min;
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  async function loadAssets() {
    const keys = Object.keys(assetList);
    const loaded = await Promise.all(keys.map((k) => loadImage(assetList[k])));
    keys.forEach((k, i) => {
      assets[k] = loaded[i];
    });
    assetState.ready = true;
    const msg = ui.overlay.querySelector('p');
    if (msg && !world.running) {
      msg.textContent = 'Веди истребитель по реке, уничтожай цели и собирай топливо.';
    }
  }

  function drawSprite(img, x, y, w, h, rot = 0, alpha = 1) {
    if (!img) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, -w * 0.5, -h * 0.5, w, h);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function spawnBlast(x, y, size = 1) {
    blasts.push({ x, y, age: 0, life: 0.32, size });
  }

  function initAudio() {
    if (audioCtx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = new Ctx();
    masterGain = audioCtx.createGain();
    musicGain = audioCtx.createGain();
    sfxGain = audioCtx.createGain();
    masterGain.gain.value = 1.0;
    musicGain.gain.value = 0.95;
    sfxGain.gain.value = 1.35;
    musicGain.connect(masterGain);
    sfxGain.connect(masterGain);
    masterGain.connect(audioCtx.destination);
  }

  function ensureAudio() {
    initAudio();
    if (!audioCtx) return;
    if (audioCtx.state !== 'running') {
      audioCtx.resume().then(() => {
        audioUnlocked = audioCtx.state === 'running';
      }).catch(() => {});
    } else {
      audioUnlocked = true;
    }
  }

  function playTone(freq, duration, type, gainValue, targetGain, attack = 0.004, decay = 0.08) {
    if (!audioCtx || !targetGain || audioCtx.state !== 'running') return;
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(gainValue, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration + decay);
    osc.connect(gain);
    gain.connect(targetGain);
    osc.start(now);
    osc.stop(now + duration + decay + 0.02);
  }

  function playShootSound() {
    playTone(920, 0.045, 'square', 0.14, sfxGain, 0.001, 0.02);
  }

  function playPickupSound() {
    playTone(740, 0.08, 'triangle', 0.12, sfxGain, 0.002, 0.05);
    playTone(988, 0.09, 'triangle', 0.1, sfxGain, 0.004, 0.05);
  }

  function playHitSound() {
    playTone(180, 0.1, 'sawtooth', 0.15, sfxGain, 0.001, 0.05);
  }

  function playExplosionSound() {
    if (!audioCtx || !sfxGain || audioCtx.state !== 'running') return;
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(240, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.24);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  function updateMusic(dt) {
    if (!audioCtx || !musicGain || !world.running) return;
    musicState.timer -= dt;
    const beat = Math.max(0.13, 0.21 - (world.speed - 170) * 0.00015);
    while (musicState.timer <= 0) {
      const m = musicState.melody[musicState.step % musicState.melody.length];
      const b = musicState.bass[musicState.step % musicState.bass.length];
      playTone(m, beat * 0.52, 'triangle', 0.075, musicGain, 0.004, 0.07);
      playTone(b, beat * 0.78, 'sine', 0.062, musicGain, 0.005, 0.09);
      musicState.step += 1;
      musicState.timer += beat;
    }
  }

  function getScale() {
    return Math.min(vw / world.width, 1.8);
  }

  function defaultPlayerY() {
    const scale = getScale() || 1;
    return clamp(vh * 0.24, 140, 300) / scale;
  }

  function resetWorld() {
    world.scroll = 0;
    world.speed = 170;
    world.targetSpeed = 170;
    world.score = 0;
    world.lastSpawnY = 1000;

    player.x = world.width / 2;
    player.y = defaultPlayerY();
    player.hp = 3;
    player.fuel = 100;
    player.cooldown = 0;
    player.invuln = 0;

    bullets.length = 0;
    enemyBullets.length = 0;
    enemies.length = 0;
    pickups.length = 0;
    obstacles.length = 0;
    blasts.length = 0;
    particles.length = 0;
    musicState.timer = 0;
    musicState.step = 0;

    world.segments.length = 0;
    let center = world.width / 2;
    let width = 220;
    for (let i = 0; i < world.maxSeg; i++) {
      center += rand(-30, 30);
      width += rand(-24, 24);
      width = clamp(width, 150, 260);
      center = clamp(center, width / 2 + 8, world.width - width / 2 - 8);
      world.segments.push({ y: i * world.segStep, center, width });
    }

    ui.score.textContent = '0';
    ui.fuel.textContent = '100%';
    ui.hp.textContent = '3';
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    vw = window.innerWidth;
    vh = window.innerHeight;
    canvas.width = Math.floor(vw * dpr);
    canvas.height = Math.floor(vh * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    player.y = defaultPlayerY();
  }

  function getRiverAt(y) {
    const step = world.segStep;
    const i = Math.floor(y / step);
    const len = world.segments.length;
    const ai = ((i % len) + len) % len;
    const bi = (((i + 1) % len) + len) % len;
    const a = world.segments[ai];
    const b = world.segments[bi];
    const t = (y - i * step) / step;
    return {
      center: a.center + (b.center - a.center) * t,
      width: a.width + (b.width - a.width) * t
    };
  }

  function spawnEntities() {
    while (world.lastSpawnY < world.scroll + 2400) {
      world.lastSpawnY += rand(200, 360);
      const r = getRiverAt(world.lastSpawnY);
      const x = r.center + rand(-r.width * 0.35, r.width * 0.35);
      const kindRoll = Math.random();

      if (kindRoll < 0.55) {
        const enemyRoll = Math.random();
        const isHeli = enemyRoll < 0.24;
        const isWarship = enemyRoll > 0.82;
        enemies.push({
          x,
          y: world.lastSpawnY,
          vx: isWarship ? rand(-12, 12) : rand(-25, 25),
          hp: isWarship ? 4 : isHeli ? 2 : 1,
          type: isWarship ? 'warship' : isHeli ? 'heli' : 'boat',
          r: isWarship ? 23 : isHeli ? 18 : 14,
          fireCooldown: rand(0.4, 1.2)
        });
      } else if (kindRoll < 0.78) {
        pickups.push({ x, y: world.lastSpawnY, r: 14, pulse: rand(0, Math.PI * 2) });
      } else {
        const ox = r.center + rand(-r.width * 0.28, r.width * 0.28);
        obstacles.push({
          x: ox,
          y: world.lastSpawnY,
          r: rand(20, 30),
          hp: 4,
          pulse: rand(0, Math.PI * 2)
        });
      }
    }
  }

  function hitFx(x, y, count, color) {
    for (let i = 0; i < count; i++) {
      particles.push({
        x,
        y,
        vx: rand(-120, 120),
        vy: rand(-120, 120),
        life: rand(0.25, 0.8),
        size: rand(2, 6),
        color
      });
    }
  }

  function damagePlayer() {
    if (player.invuln > 0) return;
    player.hp -= 1;
    player.invuln = 1.25;
    playHitSound();
    hitFx(player.x, world.scroll + player.y, 24, '#ff9c62');
    if (player.hp <= 0) {
      world.running = false;
      ui.overlay.classList.remove('hidden');
      ui.overlay.querySelector('h1').textContent = 'Игра окончена';
      ui.overlay.querySelector('p').textContent = `Счет: ${Math.floor(world.score)}. Нажми "Старт" для новой попытки.`;
    }
  }

  function update(dt) {
    animClock += dt;
    updateMusic(dt);
    world.speed += (world.targetSpeed - world.speed) * dt * 2.2;
    world.scroll += world.speed * dt;
    world.score += dt * (18 + world.speed * 0.15);
    player.fuel = Math.max(0, player.fuel - dt * 4.2);
    if (player.fuel <= 0) {
      world.targetSpeed = 90;
      if (world.speed < 95) damagePlayer();
    }

    const keyX = (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0);
    const keyY = (keys.has('down') ? 1 : 0) - (keys.has('up') ? 1 : 0);
    const moveX = controls.x || keyX;
    const moveY = controls.y || keyY;
    playerTilt = moveX;

    const moveSpeed = 165;
    player.x += moveX * moveSpeed * dt;
    player.y -= moveY * 100 * dt;
    player.y = clamp(player.y, 80, 360);

    player.cooldown = Math.max(0, player.cooldown - dt);
    player.invuln = Math.max(0, player.invuln - dt);

    if ((controls.firing || keys.has('fire')) && player.cooldown <= 0) {
      player.cooldown = 0.12;
      bullets.push({ x: player.x, y: world.scroll + player.y + 24, vy: 430, r: 4 });
      playShootSound();
    }

    const r = getRiverAt(world.scroll + player.y);
    const half = r.width / 2 - player.r;
    if (player.x < r.center - half || player.x > r.center + half) {
      damagePlayer();
    }
    player.x = clamp(player.x, 20, world.width - 20);

    spawnEntities();

    const viewDepth = vh / getScale();
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.y += b.vy * dt;
      if (b.y > world.scroll + viewDepth + 120) bullets.splice(i, 1);
    }

    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const b = enemyBullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.y < world.scroll - 120) {
        enemyBullets.splice(i, 1);
        continue;
      }
      const dx = b.x - player.x;
      const dy = b.y - (world.scroll + player.y);
      if (dx * dx + dy * dy < (b.r + player.r) ** 2) {
        enemyBullets.splice(i, 1);
        damagePlayer();
        hitFx(b.x, b.y, 10, '#ffb19f');
      }
    }

    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i];
      p.pulse += dt * 5;
      if (p.y < world.scroll - 150) {
        pickups.splice(i, 1);
        continue;
      }
      const dy = p.y - (world.scroll + player.y);
      const dx = p.x - player.x;
      if (dx * dx + dy * dy < (p.r + player.r) ** 2) {
        player.fuel = Math.min(100, player.fuel + 32);
        world.score += 120;
        playPickupSound();
        hitFx(p.x, p.y, 15, '#9dfff0');
        pickups.splice(i, 1);
      }
    }

    for (let i = obstacles.length - 1; i >= 0; i--) {
      const o = obstacles[i];
      o.pulse += dt * 2;
      if (o.y < world.scroll - 180) {
        obstacles.splice(i, 1);
        continue;
      }

      for (let j = bullets.length - 1; j >= 0; j--) {
        const b = bullets[j];
        const dx = o.x - b.x;
        const dy = o.y - b.y;
        if (dx * dx + dy * dy < (o.r + b.r) ** 2) {
          bullets.splice(j, 1);
          o.hp -= 1;
          hitFx(b.x, b.y, 10, '#fff1c6');
          if (o.hp <= 0) {
            obstacles.splice(i, 1);
            world.score += 60;
            playExplosionSound();
            spawnBlast(o.x, o.y, 1.15);
            hitFx(o.x, o.y, 24, '#e3c78d');
          }
          break;
        }
      }
    }

    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      e.y += (e.type === 'heli' ? 50 : e.type === 'warship' ? 15 : 25) * dt;
      e.x += e.vx * dt;
      const rr = getRiverAt(e.y);
      const bound = rr.width / 2 - (e.type === 'warship' ? 24 : 14);
      if (e.x < rr.center - bound || e.x > rr.center + bound) e.vx *= -1;

      if (e.y < world.scroll - 160) {
        enemies.splice(i, 1);
        continue;
      }

      const isAirTarget = e.type === 'heli';
      if (isAirTarget) {
        const dxp = e.x - player.x;
        const dyp = e.y - (world.scroll + player.y);
        if (dxp * dxp + dyp * dyp < (e.r + player.r) ** 2) {
          enemies.splice(i, 1);
          damagePlayer();
          hitFx(e.x, e.y, 22, '#ff784f');
          continue;
        }
      }

      e.fireCooldown -= dt;
      if (e.fireCooldown <= 0) {
        const playerWorldY = world.scroll + player.y;
        const enemyScreenY = worldToScreenY(e.y, getScale());
        const enemyVisible = enemyScreenY >= -40 && enemyScreenY <= vh + 40;
        if (enemyVisible && e.y > playerWorldY + 40) {
          const fireRate = e.type === 'warship' ? 2.25 : e.type === 'heli' ? 2.6 : 2.9;
          e.fireCooldown = fireRate + rand(0.35, 0.9);
          if (enemyBullets.length > 8 || Math.random() < 0.45) continue;
          const aimX = player.x + (player.x - e.x) * 0.12 + rand(-10, 10);
          const dx = aimX - e.x;
          const dy = playerWorldY - e.y;
          const len = Math.hypot(dx, dy) || 1;
          const speed = e.type === 'warship' ? 225 : 260;
          enemyBullets.push({
            x: e.x,
            y: e.y - 14,
            vx: (dx / len) * speed * 0.28,
            vy: (dy / len) * speed,
            r: e.type === 'warship' ? 4.4 : 3.8
          });
        } else {
          e.fireCooldown = rand(0.7, 1.2);
        }
      }

      for (let j = bullets.length - 1; j >= 0; j--) {
        const b = bullets[j];
        const dx = e.x - b.x;
        const dy = e.y - b.y;
        if (dx * dx + dy * dy < (e.r + b.r) ** 2) {
          bullets.splice(j, 1);
          e.hp -= 1;
          hitFx(b.x, b.y, 8, '#ffe88b');
          if (e.hp <= 0) {
            enemies.splice(i, 1);
            world.score += e.type === 'warship' ? 220 : 90;
            playExplosionSound();
            spawnBlast(e.x, e.y, e.type === 'warship' ? 1.35 : 1.0);
            hitFx(e.x, e.y, 20, '#ff885e');
          }
          break;
        }
      }
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.98;
      p.vy *= 0.98;
      if (p.life <= 0) particles.splice(i, 1);
    }

    for (let i = blasts.length - 1; i >= 0; i--) {
      const b = blasts[i];
      b.age += dt;
      if (b.age >= b.life) blasts.splice(i, 1);
    }

    ui.score.textContent = Math.floor(world.score).toString();
    ui.fuel.textContent = `${Math.floor(player.fuel)}%`;
    ui.hp.textContent = player.hp.toString();
  }

  function worldToScreenX(x, scale, left) {
    return left + x * scale;
  }

  function worldToScreenY(y, scale) {
    return vh - (y - world.scroll) * scale;
  }

  function screenToWorldY(y, scale) {
    return world.scroll + (vh - y) / scale;
  }

  function drawBackground(scale, left) {
    const sky = ctx.createLinearGradient(0, 0, 0, vh);
    sky.addColorStop(0, '#062037');
    sky.addColorStop(0.45, '#0b3654');
    sky.addColorStop(1, '#0f4f72');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, vw, vh);

    for (let i = 0; i < 18; i++) {
      const y = (i * 180 + (world.scroll * 0.2) % 1800) % 1800 - 120;
      const x = ((i * 191) % 700) / 700 * vw;
      ctx.fillStyle = 'rgba(255,255,255,0.09)';
      ctx.beginPath();
      ctx.ellipse(x, y, 70, 18, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.save();
    ctx.beginPath();
    for (let sy = -30; sy <= vh + 40; sy += 14) {
      const wy = screenToWorldY(sy, scale);
      const r = getRiverAt(wy);
      const x = worldToScreenX(r.center, scale, left);
      const hw = (r.width * scale) / 2;
      if (sy === -30) ctx.moveTo(x - hw, sy);
      else ctx.lineTo(x - hw, sy);
    }
    for (let sy = vh + 40; sy >= -30; sy -= 14) {
      const wy = screenToWorldY(sy, scale);
      const r = getRiverAt(wy);
      const x = worldToScreenX(r.center, scale, left);
      const hw = (r.width * scale) / 2;
      ctx.lineTo(x + hw, sy);
    }
    ctx.closePath();

    const water = ctx.createLinearGradient(0, 0, 0, vh);
    water.addColorStop(0, '#0fb9f8');
    water.addColorStop(0.35, '#0689ce');
    water.addColorStop(1, '#035a9b');
    ctx.fillStyle = water;
    ctx.fill();

    ctx.clip();
    for (let i = 0; i < 42; i++) {
      const y = (i * 64 + (world.scroll * 2.3) % 1200) % 1200 - 100;
      ctx.strokeStyle = `rgba(197,238,255,${0.06 + (i % 6) * 0.015})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.quadraticCurveTo(vw * 0.5, y + (i % 2 ? 5 : -5), vw, y);
      ctx.stroke();
    }

    ctx.restore();

    ctx.strokeStyle = 'rgba(177, 242, 255, 0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let sy = -30; sy <= vh + 40; sy += 14) {
      const wy = screenToWorldY(sy, scale);
      const r = getRiverAt(wy);
      const x = worldToScreenX(r.center, scale, left);
      const hw = (r.width * scale) / 2;
      if (sy === -30) ctx.moveTo(x - hw, sy);
      else ctx.lineTo(x - hw, sy);
    }
    ctx.stroke();

    ctx.beginPath();
    for (let sy = -30; sy <= vh + 40; sy += 14) {
      const wy = screenToWorldY(sy, scale);
      const r = getRiverAt(wy);
      const x = worldToScreenX(r.center, scale, left);
      const hw = (r.width * scale) / 2;
      if (sy === -30) ctx.moveTo(x + hw, sy);
      else ctx.lineTo(x + hw, sy);
    }
    ctx.stroke();
  }

  function drawPlayer(scale, left) {
    const x = worldToScreenX(player.x, scale, left);
    const y = vh - player.y * scale;

    if (player.invuln > 0 && Math.floor(player.invuln * 14) % 2 === 0) return;
    const w = 44 * scale;
    const h = 44 * scale;
    drawSprite(assets.plane, x, y, w, h, playerTilt * 0.3);

    const flameSize = (9 + Math.sin(animClock * 45) * 2.2) * scale;
    ctx.fillStyle = 'rgba(255,152,88,0.8)';
    ctx.beginPath();
    ctx.ellipse(x, y + 16 * scale, flameSize * 0.6, flameSize, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawEnemies(scale, left) {
    enemies.forEach((e) => {
      const sy = worldToScreenY(e.y, scale);
      if (sy < -80 || sy > vh + 80) return;
      const sx = worldToScreenX(e.x, scale, left);
      if (e.type === 'heli') {
        drawSprite(assets.heliBody, sx, sy, 42 * scale, 42 * scale, 0);
        drawSprite(assets.heliRotor, sx, sy - 10 * scale, 46 * scale, 46 * scale, animClock * 20);
      } else if (e.type === 'warship') {
        drawSprite(assets.warship, sx, sy + Math.sin(animClock * 2 + e.x) * 1.5 * scale, 60 * scale, 44 * scale, 0);
      } else {
        drawSprite(assets.boat, sx, sy + Math.sin(animClock * 3 + e.x) * scale, 40 * scale, 34 * scale, e.vx * 0.004);
      }
    });
  }

  function drawPickups(scale, left) {
    pickups.forEach((p) => {
      const sy = worldToScreenY(p.y, scale);
      if (sy < -40 || sy > vh + 40) return;
      const sx = worldToScreenX(p.x, scale, left);
      const bob = Math.sin(p.pulse) * 3 * scale;
      const glow = 16 + Math.sin(p.pulse * 1.2) * 3;
      ctx.fillStyle = 'rgba(160,255,220,0.22)';
      ctx.beginPath();
      ctx.arc(sx, sy, glow * scale, 0, Math.PI * 2);
      ctx.fill();
      drawSprite(assets.fuel, sx, sy + bob, 30 * scale, 30 * scale, 0);
    });
  }

  function drawObstacles(scale, left) {
    obstacles.forEach((o) => {
      const sy = worldToScreenY(o.y, scale);
      if (sy < -60 || sy > vh + 60) return;
      const sx = worldToScreenX(o.x, scale, left);
      const wobble = Math.sin(o.pulse) * 2 * scale;
      const size = o.r * 2.2 * scale;
      drawSprite(assets.island, sx, sy + wobble, size, size * 0.85, 0);
    });
  }

  function drawBullets(scale, left) {
    ctx.fillStyle = '#ffe4ad';
    bullets.forEach((b) => {
      const sy = worldToScreenY(b.y, scale);
      if (sy < -20 || sy > vh + 20) return;
      const sx = worldToScreenX(b.x, scale, left);
      ctx.beginPath();
      ctx.arc(sx, sy, 2.8 * scale, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawEnemyBullets(scale, left) {
    ctx.fillStyle = '#ff7e62';
    enemyBullets.forEach((b) => {
      const sy = worldToScreenY(b.y, scale);
      if (sy < -24 || sy > vh + 24) return;
      const sx = worldToScreenX(b.x, scale, left);
      ctx.beginPath();
      ctx.arc(sx, sy, b.r * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,163,136,0.55)';
      ctx.lineWidth = 1.2 * scale;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx - b.vx * 0.028 * scale, sy - b.vy * 0.028 * scale);
      ctx.stroke();
    });
  }

  function drawParticles(scale, left) {
    particles.forEach((p) => {
      const sy = worldToScreenY(p.y, scale);
      if (sy < -40 || sy > vh + 40) return;
      const sx = worldToScreenX(p.x, scale, left);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, p.life * 1.2);
      ctx.beginPath();
      ctx.arc(sx, sy, p.size * scale * Math.max(0.4, p.life), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    });
  }

  function drawBlasts(scale, left) {
    const frames = [assets.boom1, assets.boom2, assets.boom3, assets.boom4];
    blasts.forEach((b) => {
      const sy = worldToScreenY(b.y, scale);
      if (sy < -90 || sy > vh + 90) return;
      const sx = worldToScreenX(b.x, scale, left);
      const t = clamp(b.age / b.life, 0, 0.999);
      const frameIndex = Math.min(frames.length - 1, Math.floor(t * frames.length));
      const size = (46 + t * 54) * b.size * scale;
      drawSprite(frames[frameIndex], sx, sy, size, size, 0, 1 - t * 0.3);
    });
  }

  function render() {
    const scale = Math.min(vw / world.width, 1.8);
    const left = (vw - world.width * scale) * 0.5;

    drawBackground(scale, left);
    drawObstacles(scale, left);
    drawPickups(scale, left);
    drawEnemies(scale, left);
    drawBullets(scale, left);
    drawEnemyBullets(scale, left);
    drawBlasts(scale, left);
    drawParticles(scale, left);
    drawPlayer(scale, left);
  }

  function loop(ts) {
    const dt = Math.min(0.035, (ts - lastTime) / 1000 || 0.016);
    lastTime = ts;

    if (world.running) update(dt);
    render();

    requestAnimationFrame(loop);
  }

  function setStick(clientX, clientY) {
    const rect = stickZone.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const max = rect.width * 0.32;
    const len = Math.hypot(dx, dy);
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    controls.x = dx / max;
    controls.y = dy / max;
    stick.style.left = `${32 + dx}px`;
    stick.style.top = `${32 + dy}px`;
  }

  function clearStick() {
    controls.x = 0;
    controls.y = 0;
    stick.style.left = '32px';
    stick.style.top = '32px';
  }

  stickZone.addEventListener('pointerdown', (e) => {
    controls.pointerId = e.pointerId;
    stickZone.setPointerCapture(e.pointerId);
    setStick(e.clientX, e.clientY);
  });

  stickZone.addEventListener('pointermove', (e) => {
    if (controls.pointerId !== e.pointerId) return;
    setStick(e.clientX, e.clientY);
  });

  stickZone.addEventListener('pointerup', (e) => {
    if (controls.pointerId !== e.pointerId) return;
    controls.pointerId = null;
    clearStick();
  });

  stickZone.addEventListener('pointercancel', () => {
    controls.pointerId = null;
    clearStick();
  });

  fireBtn.addEventListener('pointerdown', () => {
    ensureAudio();
    controls.firing = true;
  });
  fireBtn.addEventListener('pointerup', () => {
    controls.firing = false;
  });
  fireBtn.addEventListener('pointercancel', () => {
    controls.firing = false;
  });

  window.addEventListener('keydown', (e) => {
    ensureAudio();
    const dir = keyMap[e.code];
    if (dir) {
      keys.add(dir);
      e.preventDefault();
      return;
    }
    if (e.code === 'Space') {
      keys.add('fire');
      e.preventDefault();
    }
  });

  window.addEventListener('keyup', (e) => {
    const dir = keyMap[e.code];
    if (dir) {
      keys.delete(dir);
      e.preventDefault();
      return;
    }
    if (e.code === 'Space') {
      keys.delete('fire');
      e.preventDefault();
    }
  });

  ui.start.addEventListener('click', () => {
    if (!assetState.ready) {
      ui.overlay.querySelector('p').textContent = 'Загружаю графику... попробуй через 1-2 секунды.';
      return;
    }
    ensureAudio();
    playPickupSound();
    ui.overlay.classList.add('hidden');
    ui.overlay.querySelector('h1').textContent = 'River Strike';
    ui.overlay.querySelector('p').textContent = 'Веди истребитель по реке, уничтожай цели и собирай топливо.';
    resetWorld();
    world.running = true;
  });

  window.addEventListener('resize', resize);
  window.addEventListener('pointerdown', ensureAudio, { passive: true });
  window.addEventListener('touchstart', ensureAudio, { passive: true });

  resize();
  resetWorld();
  ui.overlay.querySelector('p').textContent = 'Загружаю графику...';
  loadAssets().catch(() => {
    ui.overlay.querySelector('p').textContent = 'Ошибка загрузки графики. Обнови страницу.';
  });
  requestAnimationFrame(loop);
})();
