// ── DOM refs ──────────────────────────────────────────────────────────────────
const loginScreen   = document.getElementById('login-screen');
const radarContainer= document.getElementById('radar-container');
const sessionInput  = document.getElementById('session-code');
const connectBtn    = document.getElementById('connect-btn');
const displayCode   = document.getElementById('display-code');
const canvas        = document.getElementById('radar-canvas');
const ctx           = canvas.getContext('2d');
const zoomValDisplay= document.getElementById('zoom-val');
const errorMsg      = document.getElementById('error-msg');
const optionsBtn    = document.getElementById('options-btn');
const optionsPanel  = document.getElementById('options-panel');

// ── State ──────────────────────────────────────────────────────────────────────
let pubnub = null;
let radarData = { players: [], local: { pos:[0,0,0], rot:0, range:500, name:'You' } };
let zoom = 1.0;
let lastPacketTime = 0;
let firstPacketReceived = false;

// ── Options ────────────────────────────────────────────────────────────────────
const opts = {
    showNames:    true,
    showHealth:   true,
    showDistance: true,
    showTeam:     true,
    showDead:     false,
    dotSize:      5,
};

function getOpt(id) {
    const el = document.getElementById(id);
    return el ? (el.type === 'checkbox' ? el.checked : parseFloat(el.value)) : opts[id];
}

// Sync opts from DOM
function syncOpts() {
    opts.showNames    = document.getElementById('opt-names').checked;
    opts.showHealth   = document.getElementById('opt-health').checked;
    opts.showDistance = document.getElementById('opt-distance').checked;
    opts.showTeam     = document.getElementById('opt-team').checked;
    opts.showDead     = document.getElementById('opt-dead').checked;
    opts.dotSize      = parseFloat(document.getElementById('opt-dotsize').value);
}

document.querySelectorAll('#options-panel input').forEach(el => el.addEventListener('change', syncOpts));

// ── Canvas resize ──────────────────────────────────────────────────────────────
function resize() {
    canvas.width  = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
}
window.onresize = resize;
resize();

// ── Error display ──────────────────────────────────────────────────────────────
function showError(msg) {
    if (errorMsg) { errorMsg.textContent = msg; errorMsg.style.display = 'block'; }
}
function clearError() {
    if (errorMsg) errorMsg.style.display = 'none';
}

// ── Connect ────────────────────────────────────────────────────────────────────
function connect() {
    const code = sessionInput.value.trim();
    if (!code) { showError('Please enter a session code.'); return; }

    clearError();
    connectBtn.disabled = true;
    connectBtn.textContent = 'VERIFYING...';
    firstPacketReceived = false;

    if (pubnub) { pubnub.unsubscribeAll(); pubnub = null; }

    const channel = `nemesis_${code}`;

    const timeout = setTimeout(() => {
        if (!firstPacketReceived) {
            if (pubnub) { pubnub.unsubscribeAll(); pubnub = null; }
            connectBtn.disabled = false;
            connectBtn.textContent = 'CONNECT';
            showError('Session not found. Make sure the radar is enabled in-game.');
            if (window.location.search.includes('code='))
                window.history.replaceState({}, document.title, window.location.pathname);
        }
    }, 8000);

    pubnub = new PubNub({
        publishKey:   'demo',
        subscribeKey: 'demo',
        uuid: 'viewer-' + Math.random().toString(36).substr(2,6)
    });

    pubnub.addListener({
        message: (ev) => {
            try {
                const data = ev.message;
                if (!data || (data.players === undefined && data.local === undefined)) return;
                if (!firstPacketReceived) {
                    firstPacketReceived = true;
                    clearTimeout(timeout);
                    clearError();
                    loginScreen.classList.add('hidden');
                    radarContainer.classList.remove('hidden');
                    displayCode.textContent = code;
                    connectBtn.disabled = false;
                    connectBtn.textContent = 'CONNECT';
                    requestAnimationFrame(render);
                }
                radarData = data;
                lastPacketTime = Date.now();
            } catch(e) {}
        }
    });

    pubnub.subscribe({ channels: [channel] });
}

// Auto-connect from URL
const urlParams = new URLSearchParams(window.location.search);
const urlCode   = urlParams.get('code');
if (urlCode) {
    sessionInput.value = urlCode;
    window.addEventListener('load', () => setTimeout(connect, 200));
}

connectBtn.onclick = connect;
sessionInput.onkeydown = (e) => { if (e.key === 'Enter') connect(); };

// ── Options toggle ─────────────────────────────────────────────────────────────
if (optionsBtn && optionsPanel) {
    optionsBtn.onclick = () => {
        const visible = optionsPanel.style.display !== 'none';
        optionsPanel.style.display = visible ? 'none' : 'block';
    };
}

// ── Coordinate transform ───────────────────────────────────────────────────────
function worldToScreen(wx, wz, lx, lz, rot, range) {
    const relX =  wx - lx;
    const relZ =  wz - lz;

    // Rotate by camera yaw so "forward" is always up on screen
    const cos = Math.cos(-rot);
    const sin = Math.sin(-rot);
    const rx = relX * cos - relZ * sin;
    const rz = relX * sin + relZ * cos;

    const halfW = canvas.width  / 2;
    const halfH = canvas.height / 2;
    const scale = (Math.min(halfW, halfH) / range) * zoom;

    return { x: halfW + rx * scale, y: halfH + rz * scale };
}

// ── Render ─────────────────────────────────────────────────────────────────────
function render() {
    if (radarContainer.classList.contains('hidden')) return;

    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2;

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = '#1a1a20'; ctx.lineWidth = 1;
    const gridSpacing = 50 * zoom;
    const gridOffX = cx % gridSpacing, gridOffY = cy % gridSpacing;
    for (let x = gridOffX; x < W; x += gridSpacing) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = gridOffY; y < H; y += gridSpacing) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Crosshair
    ctx.strokeStyle = '#2a2a36'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.stroke();

    const local   = radarData.local   || { pos:[0,0,0], rot:0, range:500, name:'You' };
    const players = radarData.players || [];
    const range   = local.range || 500;

    // Range ring
    const halfMin = Math.min(cx, cy);
    const ringR   = halfMin * zoom;
    ctx.strokeStyle = '#25252b'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, ringR, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, ringR*0.5, 0, Math.PI*2); ctx.stroke();

    // ── Players ──
    players.forEach(p => {
        if (!p.pos) return;
        if (!opts.showDead && p.health !== undefined && p.health <= 0) return;

        const rPos = worldToScreen(p.pos[0], p.pos[2], local.pos[0], local.pos[2], local.rot || 0, range);

        // Skip if way off-screen
        if (rPos.x < -50 || rPos.x > W+50 || rPos.y < -50 || rPos.y > H+50) return;

        const isEnemy= p.isEnemy;
        const isTeam = !isEnemy;
        const dotClr = isEnemy ? '#ff4444' : '#44ff88';

        // Dot glow
        ctx.shadowBlur  = 8;
        ctx.shadowColor = dotClr;
        ctx.fillStyle   = dotClr;
        ctx.beginPath();
        ctx.arc(rPos.x, rPos.y, opts.dotSize, 0, Math.PI*2);
        ctx.fill();
        ctx.shadowBlur = 0;

        const txtY = rPos.y - opts.dotSize - 3;
        let labelOffset = 0;

        // Name
        if (opts.showNames) {
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.font = 'bold 10px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(p.name || '?', rPos.x, txtY - labelOffset);
            labelOffset += 12;
        }

        // Distance
        if (opts.showDistance && local.pos) {
            const dx = p.pos[0] - local.pos[0];
            const dz = p.pos[2] - local.pos[2];
            const dist = Math.round(Math.sqrt(dx*dx + dz*dz));
            ctx.fillStyle = 'rgba(180,180,200,0.7)';
            ctx.font = '9px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`${dist}m`, rPos.x, txtY - labelOffset);
            labelOffset += 11;
        }

        // Health bar
        if (opts.showHealth && p.health !== undefined && p.maxHealth) {
            const hPct = Math.max(0, Math.min(1, p.health / p.maxHealth));
            const bw = 28, bh = 3;
            const bx = rPos.x - bw/2, by = rPos.y + opts.dotSize + 4;
            ctx.fillStyle = '#1a1a20';
            ctx.fillRect(bx, by, bw, bh);
            ctx.fillStyle = hPct > 0.5 ? '#44ff88' : hPct > 0.25 ? '#ffaa00' : '#ff4444';
            ctx.fillRect(bx, by, bw * hPct, bh);
        }
    });

    // ── Local Player (always center, arrow points forward) ──
    ctx.save();
    ctx.translate(cx, cy);
    ctx.shadowBlur  = 12;
    ctx.shadowColor = '#f3a1fa';
    ctx.fillStyle   = '#f3a1fa';
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(-6, 6);
    ctx.lineTo(0, 2);
    ctx.lineTo(6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();

    // Local name
    if (opts.showNames && local.name) {
        ctx.fillStyle = '#f3a1fa';
        ctx.font = 'bold 10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(local.name, cx, cy - 16);
    }

    // ── Connection lost ──
    if (lastPacketTime > 0 && Date.now() - lastPacketTime > 5000) {
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle   = '#ff4444';
        ctx.font        = 'bold 15px Orbitron, sans-serif';
        ctx.textAlign   = 'center';
        ctx.fillText('CONNECTION LOST', cx, cy - 12);
        ctx.font        = '11px Inter, sans-serif';
        ctx.fillStyle   = '#aaa';
        ctx.fillText('Waiting for data from cheat...', cx, cy + 14);
    }

    requestAnimationFrame(render);
}

// ── Zoom ───────────────────────────────────────────────────────────────────────
canvas.onwheel = (e) => {
    e.preventDefault();
    zoom *= e.deltaY < 0 ? 1.1 : 0.9;
    zoom = Math.max(0.1, Math.min(20, zoom));
    if (zoomValDisplay) zoomValDisplay.textContent = zoom.toFixed(1);
};
