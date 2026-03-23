const loginScreen = document.getElementById('login-screen');
const radarContainer = document.getElementById('radar-container');
const sessionInput = document.getElementById('session-code');
const connectBtn = document.getElementById('connect-btn');
const displayCode = document.getElementById('display-code');
const canvas = document.getElementById('radar-canvas');
const ctx = canvas.getContext('2d');
const zoomValDisplay = document.getElementById('zoom-val');
const errorMsg = document.getElementById('error-msg');

let pubnub = null;
let radarData = { players: [], local: { pos: [0,0,0], rot: 0 } };
let zoom = 1.0;
let lastPacketTime = 0;
let firstPacketReceived = false;

function resize() {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
}
window.onresize = resize;
resize();

function showError(msg) {
    if (errorMsg) { errorMsg.textContent = msg; errorMsg.style.display = 'block'; }
}
function clearError() {
    if (errorMsg) errorMsg.style.display = 'none';
}

function connect() {
    const code = sessionInput.value.trim();
    if (!code) { showError("Please enter a session code."); return; }

    clearError();
    connectBtn.disabled = true;
    connectBtn.textContent = "VERIFYING...";
    firstPacketReceived = false;

    // Disconnect any existing connection
    if (pubnub) {
        pubnub.unsubscribeAll();
        pubnub = null;
    }

    const channel = `nemesis_${code}`;

    const connectionTimeout = setTimeout(() => {
        if (!firstPacketReceived) {
            if (pubnub) { pubnub.unsubscribeAll(); pubnub = null; }
            connectBtn.disabled = false;
            connectBtn.textContent = "CONNECT";
            showError("Session not found. Make sure the radar is enabled in-game and you copied the exact code.");
            if (window.location.search.includes('code=')) {
                window.history.replaceState({}, document.title, window.location.pathname);
            }
        }
    }, 8000);

    // Initialize PubNub with demo keys (no signup required for testing)
    pubnub = new PubNub({
        publishKey: 'demo',
        subscribeKey: 'demo',
        uuid: 'radar-viewer-' + Math.random().toString(36).substr(2, 6)
    });

    pubnub.addListener({
        message: (event) => {
            try {
                const data = event.message;
                if (!data || (data.players === undefined && data.local === undefined)) return;

                if (!firstPacketReceived) {
                    firstPacketReceived = true;
                    clearTimeout(connectionTimeout);
                    clearError();
                    loginScreen.classList.add('hidden');
                    radarContainer.classList.remove('hidden');
                    displayCode.textContent = code;
                    connectBtn.disabled = false;
                    connectBtn.textContent = "CONNECT";
                    requestAnimationFrame(render);
                }

                radarData = data;
                lastPacketTime = Date.now();
            } catch (err) {
                console.error("Parse error:", err);
            }
        },
        status: (event) => {
            console.log("PubNub status:", event.category);
        }
    });

    pubnub.subscribe({ channels: [channel] });
}

// Auto-connect from URL
const urlParams = new URLSearchParams(window.location.search);
const urlCode = urlParams.get('code');
if (urlCode) {
    sessionInput.value = urlCode;
    // Wait for PubNub SDK to load then connect
    window.addEventListener('load', () => { setTimeout(connect, 300); });
} else {
    window.addEventListener('load', () => {});
}

connectBtn.onclick = connect;
sessionInput.onkeydown = (e) => { if (e.key === 'Enter') connect(); };

function worldToRadar(worldX, worldZ, localX, localZ, localRot, canvasW, canvasH) {
    const relX = worldX - localX;
    const relZ = worldZ - localZ;
    const cos = Math.cos(-localRot);
    const sin = Math.sin(-localRot);
    return {
        x: canvasW / 2 + (relX * cos - relZ * sin) * zoom,
        y: canvasH / 2 + (relX * sin + relZ * cos) * zoom
    };
}

function render() {
    if (radarContainer.classList.contains('hidden')) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    // Grid
    ctx.strokeStyle = '#1a1a20'; ctx.lineWidth = 1;
    for (let i = -10; i <= 10; i++) {
        const offset = i * 50 * zoom;
        ctx.beginPath(); ctx.moveTo(0, cy + offset); ctx.lineTo(canvas.width, cy + offset); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + offset, 0); ctx.lineTo(cx + offset, canvas.height); ctx.stroke();
    }

    // Crosshair
    ctx.strokeStyle = '#303036';
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, canvas.height);
    ctx.moveTo(0, cy); ctx.lineTo(canvas.width, cy); ctx.stroke();

    const local = radarData.local;
    const players = radarData.players || [];
    if (!local || !local.pos) { requestAnimationFrame(render); return; }

    // Players
    players.forEach(p => {
        if (!p.pos) return;
        const rPos = worldToRadar(p.pos[0], p.pos[2], local.pos[0], local.pos[2], local.rot || 0, canvas.width, canvas.height);

        ctx.fillStyle = p.isEnemy ? '#ff4444' : '#44ff44';
        ctx.beginPath(); ctx.arc(rPos.x, rPos.y, 5, 0, Math.PI * 2); ctx.fill();

        // Health bar
        if (p.health !== undefined && p.maxHealth) {
            const hPct = Math.max(0, Math.min(1, p.health / p.maxHealth));
            const bw = 24, bh = 3;
            ctx.fillStyle = '#333';
            ctx.fillRect(rPos.x - bw/2, rPos.y - 14, bw, bh);
            ctx.fillStyle = hPct > 0.5 ? '#44ff44' : hPct > 0.25 ? '#ffaa00' : '#ff4444';
            ctx.fillRect(rPos.x - bw/2, rPos.y - 14, bw * hPct, bh);
        }

        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(p.name || '?', rPos.x, rPos.y - 18);
    });

    // Local player arrow
    ctx.save(); ctx.translate(cx, cy); ctx.fillStyle = '#f3a1fa';
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(-6, 7); ctx.lineTo(0, 3); ctx.lineTo(6, 7);
    ctx.closePath(); ctx.fill(); ctx.restore();

    // Connection lost
    if (lastPacketTime > 0 && Date.now() - lastPacketTime > 5000) {
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ff4444'; ctx.font = 'bold 14px Orbitron, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText("CONNECTION LOST", cx, cy - 10);
        ctx.font = '11px Inter, sans-serif'; ctx.fillStyle = '#ccc';
        ctx.fillText("Waiting for data from cheat...", cx, cy + 12);
    }

    requestAnimationFrame(render);
}

canvas.onwheel = (e) => {
    e.preventDefault();
    zoom *= e.deltaY < 0 ? 1.1 : 0.9;
    zoom = Math.max(0.1, Math.min(20, zoom));
    zoomValDisplay.textContent = zoom.toFixed(1);
};
