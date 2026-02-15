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
    segStep: 120,
    maxSeg: 180,
    segments: [],
    scroll: 0,
    speed: 170,
    score: 0,
    running: false,
    lastSpawnY: 900
  };

  const player = { x: 210, y: 220, r: 15, hp: 3, fuel: 100, cd: 0, inv: 0 };
  const touch = { x: 0, y: 0, fire: false, pid: null };
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
  const enemies = [];
  const pickups = [];
  const particles = [];

  let vw = 0;
  let vh = 0;
  let dpr = 1;
  let last = 0;

  const rand = (a, b) => Math.random() * (b - a) + a;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const scale = () => Math.min(vw / world.width, 1.8);

  function defaultY() {
    return clamp(vh * 0.24, 140, 300) / (scale() || 1);
  }

  function reset() {
    world.scroll = 0;
    world.speed = 170;
    world.score = 0;
    world.lastSpawnY = 900;

    player.x = world.width * 0.5;
    player.y = defaultY();
    player.hp = 3;
    player.fuel = 100;
    player.cd = 0;
    player.inv = 0;

    bullets.length = 0;
    enemies.length = 0;
    pickups.length = 0;
    particles.length = 0;

    world.segments.length = 0;
    let c = world.width * 0.5;
    let w = 220;
    for (let i = 0; i < world.maxSeg; i++) {
      c += rand(-30, 30);
      w += rand(-22, 22);
      w = clamp(w, 160, 260);
      c = clamp(c, w / 2 + 12, world.width - w / 2 - 12);
      world.segments.push({ center: c, width: w });
    }
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    vw = window.innerWidth;
    vh = window.innerHeight;
    canvas.width = Math.floor(vw * dpr);
    canvas.height = Math.floor(vh * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    player.y = defaultY();
  }

  function riverAt(y) {
    const i = Math.floor(y / world.segStep);
    const len = world.segments.length;
    const a = world.segments[((i % len) + len) % len];
    const b = world.segments[(((i + 1) % len) + len) % len];
    const t = (y - i * world.segStep) / world.segStep;
    return {
      center: a.center + (b.center - a.center) * t,
      width: a.width + (b.width - a.width) * t
    };
  }

  function spawn() {
    while (world.lastSpawnY < world.scroll + 2400) {
      world.lastSpawnY += rand(220, 360);
      const r = riverAt(world.lastSpawnY);
      const x = r.center + rand(-r.width * 0.35, r.width * 0.35);
      if (Math.random() < 0.74) {
        const heli = Math.random() < 0.25;
        enemies.push({ x, y: world.lastSpawnY, vx: rand(-25, 25), hp: heli ? 2 : 1, type: heli ? 'heli' : 'boat', r: heli ? 18 : 14 });
      } else {
        pickups.push({ x, y: world.lastSpawnY, r: 14, pulse: rand(0, Math.PI * 2) });
      }
    }
  }

  function hitFx(x, y, n, color) {
    for (let i = 0; i < n; i++) particles.push({ x, y, vx: rand(-120, 120), vy: rand(-120, 120), life: rand(0.25, 0.8), size: rand(2, 6), color });
  }

  function hurt() {
    if (player.inv > 0) return;
    player.hp -= 1;
    player.inv = 1.2;
    hitFx(player.x, world.scroll + player.y, 20, '#ff8e5e');
    if (player.hp <= 0) {
      world.running = false;
      ui.overlay.classList.remove('hidden');
      ui.overlay.querySelector('h1').textContent = 'Игра окончена';
      ui.overlay.querySelector('p').textContent = `Счет: ${Math.floor(world.score)}. Нажми "Старт".`;
    }
  }

  function update(dt) {
    world.scroll += world.speed * dt;
    world.score += dt * (18 + world.speed * 0.15);
    player.fuel = Math.max(0, player.fuel - dt * 4.1);

    const keyX = (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0);
    const keyY = (keys.has('down') ? 1 : 0) - (keys.has('up') ? 1 : 0);
    const moveX = touch.x || keyX;
    const moveY = touch.y || keyY;

    player.x += moveX * 165 * dt;
    player.y -= moveY * 100 * dt;
    player.y = clamp(player.y, 80, 360);
    player.x = clamp(player.x, 20, world.width - 20);

    player.cd = Math.max(0, player.cd - dt);
    player.inv = Math.max(0, player.inv - dt);

    if ((touch.fire || keys.has('fire')) && player.cd <= 0) {
      player.cd = 0.12;
      bullets.push({ x: player.x, y: world.scroll + player.y + 24, vy: 430, r: 4 });
    }

    const pr = riverAt(world.scroll + player.y);
    const hw = pr.width / 2 - player.r;
    if (player.x < pr.center - hw || player.x > pr.center + hw) hurt();

    spawn();

    const viewD = vh / scale();
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.y += b.vy * dt;
      if (b.y > world.scroll + viewD + 120) bullets.splice(i, 1);
    }

    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i];
      p.pulse += dt * 5;
      if (p.y < world.scroll - 150) { pickups.splice(i, 1); continue; }
      const dx = p.x - player.x;
      const dy = p.y - (world.scroll + player.y);
      if (dx * dx + dy * dy < (p.r + player.r) ** 2) {
        player.fuel = Math.min(100, player.fuel + 32);
        world.score += 120;
        hitFx(p.x, p.y, 14, '#9dfff0');
        pickups.splice(i, 1);
      }
    }

    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      e.y += (e.type === 'heli' ? 50 : 25) * dt;
      e.x += e.vx * dt;
      const rr = riverAt(e.y);
      const b = rr.width / 2 - 14;
      if (e.x < rr.center - b || e.x > rr.center + b) e.vx *= -1;
      if (e.y < world.scroll - 160) { enemies.splice(i, 1); continue; }

      const dxp = e.x - player.x;
      const dyp = e.y - (world.scroll + player.y);
      if (dxp * dxp + dyp * dyp < (e.r + player.r) ** 2) {
        enemies.splice(i, 1);
        hurt();
        hitFx(e.x, e.y, 20, '#ff784f');
        continue;
      }

      for (let j = bullets.length - 1; j >= 0; j--) {
        const bb = bullets[j];
        const dx = e.x - bb.x;
        const dy = e.y - bb.y;
        if (dx * dx + dy * dy < (e.r + bb.r) ** 2) {
          bullets.splice(j, 1);
          e.hp -= 1;
          hitFx(bb.x, bb.y, 8, '#ffe88b');
          if (e.hp <= 0) {
            enemies.splice(i, 1);
            world.score += 90;
            hitFx(e.x, e.y, 18, '#ff885e');
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

    ui.score.textContent = Math.floor(world.score).toString();
    ui.fuel.textContent = `${Math.floor(player.fuel)}%`;
    ui.hp.textContent = player.hp.toString();
  }

  function wx(x, s, l) { return l + x * s; }
  function wy(y, s) { return vh - (y - world.scroll) * s; }
  function sy(y, s) { return world.scroll + (vh - y) / s; }

  function drawBg(s, l) {
    const g = ctx.createLinearGradient(0, 0, 0, vh);
    g.addColorStop(0, '#062037');
    g.addColorStop(0.45, '#0b3654');
    g.addColorStop(1, '#0f4f72');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vw, vh);

    ctx.save();
    ctx.beginPath();
    for (let py = -30; py <= vh + 40; py += 14) {
      const r = riverAt(sy(py, s));
      const x = wx(r.center, s, l);
      const hw = (r.width * s) * 0.5;
      if (py === -30) ctx.moveTo(x - hw, py); else ctx.lineTo(x - hw, py);
    }
    for (let py = vh + 40; py >= -30; py -= 14) {
      const r = riverAt(sy(py, s));
      const x = wx(r.center, s, l);
      const hw = (r.width * s) * 0.5;
      ctx.lineTo(x + hw, py);
    }
    ctx.closePath();

    const w = ctx.createLinearGradient(0, 0, 0, vh);
    w.addColorStop(0, '#0fb9f8');
    w.addColorStop(0.35, '#0689ce');
    w.addColorStop(1, '#035a9b');
    ctx.fillStyle = w;
    ctx.fill();
    ctx.restore();
  }

  function draw() {
    const s = scale();
    const l = (vw - world.width * s) * 0.5;
    drawBg(s, l);

    pickups.forEach((p) => {
      const x = wx(p.x, s, l);
      const y = wy(p.y, s);
      const r = (10 + Math.sin(p.pulse) * 2.4) * s;
      ctx.fillStyle = 'rgba(160,255,220,0.28)';
      ctx.beginPath(); ctx.arc(x, y, r * 1.7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#a9ffe0';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    });

    enemies.forEach((e) => {
      const x = wx(e.x, s, l);
      const y = wy(e.y, s);
      if (e.type === 'heli') {
        ctx.fillStyle = '#f5d86e'; ctx.fillRect(x - 16 * s, y - 6 * s, 32 * s, 12 * s);
        ctx.strokeStyle = '#d8eefb'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 20 * s, y - 17 * s); ctx.lineTo(x + 20 * s, y - 17 * s); ctx.stroke();
      } else {
        ctx.fillStyle = '#6e7d8f';
        ctx.beginPath(); ctx.moveTo(x, y - 12 * s); ctx.lineTo(x + 11 * s, y + 12 * s); ctx.lineTo(x - 11 * s, y + 12 * s); ctx.closePath(); ctx.fill();
      }
    });

    ctx.fillStyle = '#ffe4ad';
    bullets.forEach((b) => { const x = wx(b.x, s, l); const y = wy(b.y, s); ctx.beginPath(); ctx.arc(x, y, 2.8 * s, 0, Math.PI * 2); ctx.fill(); });

    particles.forEach((p) => {
      const x = wx(p.x, s, l);
      const y = wy(p.y, s);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, p.life * 1.2);
      ctx.beginPath(); ctx.arc(x, y, p.size * s * Math.max(0.4, p.life), 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    });

    const px = wx(player.x, s, l);
    const py = vh - player.y * s;
    if (!(player.inv > 0 && Math.floor(player.inv * 14) % 2 === 0)) {
      ctx.fillStyle = '#eef7ff';
      ctx.beginPath();
      ctx.moveTo(px, py - 20 * s);
      ctx.lineTo(px + 16 * s, py + 16 * s);
      ctx.lineTo(px, py + 8 * s);
      ctx.lineTo(px - 16 * s, py + 16 * s);
      ctx.closePath();
      ctx.fill();
    }
  }

  function loop(ts) {
    const dt = Math.min(0.035, (ts - last) / 1000 || 0.016);
    last = ts;
    if (world.running) update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  function setStick(clientX, clientY) {
    const r = stickZone.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const max = r.width * 0.32;
    const len = Math.hypot(dx, dy);
    if (len > max) { dx = (dx / len) * max; dy = (dy / len) * max; }
    touch.x = dx / max;
    touch.y = dy / max;
    stick.style.left = `${32 + dx}px`;
    stick.style.top = `${32 + dy}px`;
  }

  function clearStick() {
    touch.x = 0;
    touch.y = 0;
    stick.style.left = '32px';
    stick.style.top = '32px';
  }

  stickZone.addEventListener('pointerdown', (e) => {
    touch.pid = e.pointerId;
    stickZone.setPointerCapture(e.pointerId);
    setStick(e.clientX, e.clientY);
  });
  stickZone.addEventListener('pointermove', (e) => { if (e.pointerId === touch.pid) setStick(e.clientX, e.clientY); });
  stickZone.addEventListener('pointerup', (e) => { if (e.pointerId === touch.pid) { touch.pid = null; clearStick(); } });
  stickZone.addEventListener('pointercancel', () => { touch.pid = null; clearStick(); });

  fireBtn.addEventListener('pointerdown', () => { touch.fire = true; });
  fireBtn.addEventListener('pointerup', () => { touch.fire = false; });
  fireBtn.addEventListener('pointercancel', () => { touch.fire = false; });

  window.addEventListener('keydown', (e) => {
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
    ui.overlay.classList.add('hidden');
    ui.overlay.querySelector('h1').textContent = 'River Strike';
    ui.overlay.querySelector('p').textContent = 'Веди истребитель по реке, уничтожай цели и собирай топливо.';
    reset();
    world.running = true;
  });

  window.addEventListener('resize', resize);
  resize();
  reset();
  requestAnimationFrame(loop);
})();
