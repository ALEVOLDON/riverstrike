(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');
  const startBtn = document.getElementById('start');

  let vw = 0;
  let vh = 0;
  let dpr = 1;
  let running = false;
  let t = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    vw = window.innerWidth;
    vh = window.innerHeight;
    canvas.width = Math.floor(vw * dpr);
    canvas.height = Math.floor(vh * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function render() {
    const g = ctx.createLinearGradient(0, 0, 0, vh);
    g.addColorStop(0, '#062037');
    g.addColorStop(1, '#0f4f72');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vw, vh);

    const riverW = vw * 0.45;
    const center = vw * 0.5 + Math.sin(t * 0.7) * 30;
    ctx.fillStyle = '#0a9edf';
    ctx.fillRect(center - riverW / 2, 0, riverW, vh);

    ctx.fillStyle = '#dff8ff';
    ctx.beginPath();
    ctx.moveTo(center, vh * 0.2);
    ctx.lineTo(center + 20, vh * 0.28);
    ctx.lineTo(center, vh * 0.25);
    ctx.lineTo(center - 20, vh * 0.28);
    ctx.closePath();
    ctx.fill();
  }

  function loop(ts) {
    if (running) t = ts / 1000;
    render();
    requestAnimationFrame(loop);
  }

  startBtn.addEventListener('click', () => {
    running = true;
    overlay.classList.add('hidden');
  });

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(loop);
})();
