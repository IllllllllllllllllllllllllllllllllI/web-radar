const loginScreen = document.getElementById('login-screen');
const radarContainer = document.getElementById('radar-container');
const sessionInput = document.getElementById('session-code');
const connectBtn = document.getElementById('connect-btn');
const displayCode = document.getElementById('display-code');
const canvas = document.getElementById('radar-canvas');
const ctx = canvas.getContext('2d');
const zoomValDisplay = document.getElementById('zoom-val');

let eventSource = null;
let radarData = { players: [], local: { pos: [0,0,0], rot: 0 } };
let zoom = 1.0;
let isDragging = false;
let lastMousePos = { x: 0, y: 0 };

// Resize handling
function resize() {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
}
window.onresize = resize;
resize();

function connect() {
    const code = sessionInput.value.trim();
    if (!code) return alert("Please enter a session code.");

    const topic = `nemesis_radar_${code}`;
    const url = `https://ntfy.sh/${topic}/sse`;

    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }

    connectBtn.disabled = true;
    connectBtn.textContent = "VERIFYING...";

    let firstPacketReceived = false;
    const connectionTimeout = setTimeout(() => {
        if (!firstPacketReceived) {
            if (eventSource) {
                eventSource.close();
                eventSource = null;
            }
            connectBtn.disabled = false;
            connectBtn.textContent = "CONNECT";
            alert("This session code is either invalid or the cheat is not currently broadcasting. Please check the 'Radar' settings in your cheat menu.");
            
            // Clear URL param if it was an auto-connect failure
            if (window.location.search.includes('code=')) {
                window.history.replaceState({}, document.title, window.location.pathname);
            }
        }
    }, 5000); // 5s timeout is sufficient for verification

    eventSource = new EventSource(url);
    
    eventSource.onmessage = (e) => {
        try {
            const ntfyData = JSON.parse(e.data);
            
            // Only process actual messages
            if (ntfyData.event !== "message" || !ntfyData.message) return;

            const data = JSON.parse(ntfyData.message);
            if (data.players || data.local) {
                if (!firstPacketReceived) {
                    firstPacketReceived = true;
                    clearTimeout(connectionTimeout);
                    loginScreen.classList.add('hidden');
                    radarContainer.classList.remove('hidden');
                    displayCode.textContent = code;
                    connectBtn.disabled = false;
                    connectBtn.textContent = "CONNECT";
                    requestAnimationFrame(render);
                }
                radarData = data;
                lastPacketTime = Date.now();
            }
        } catch (err) {
            console.error("Parse error:", err);
        }
    };

    eventSource.onopen = () => {
        console.log("SSE Connection opened, waiting for first packet...");
    };

    eventSource.onerror = (e) => {
        console.error("SSE error:", e);
        // Don't alert here as EventSource often recovers, 
        // rely on the 5s timeout for initial verification.
    };
}

// Auto-connect if code is in URL
let lastPacketTime = Date.now();
const urlParams = new URLSearchParams(window.location.search);
const urlCode = urlParams.get('code');
if (urlCode) {
    sessionInput.value = urlCode;
    connect();
}

connectBtn.onclick = connect;

function worldToRadar(worldX, worldZ, localX, localZ, localRot, canvasW, canvasH) {
    const relX = (worldX - localX);
    const relZ = (worldZ - localZ);

    // Rotate based on local player rotation
    const cos = Math.cos(-localRot);
    const sin = Math.sin(-localRot);

    const rotX = relX * cos - relZ * sin;
    const rotZ = relX * sin + relZ * cos;

    const centerX = canvasW / 2;
    const centerY = canvasH / 2;

    const screenX = centerX + (rotX * zoom);
    const screenY = centerY + (rotZ * zoom);

    return { x: screenX, y: screenY };
}

function render() {
    if (radarContainer.classList.contains('hidden')) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    // Draw Grid
    ctx.strokeStyle = '#1a1a20';
    ctx.lineWidth = 1;
    for(let i = -10; i <= 10; i++) {
        const offset = i * 50 * zoom;
        ctx.beginPath();
        ctx.moveTo(0, cy + offset); ctx.lineTo(canvas.width, cy + offset);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx + offset, 0); ctx.lineTo(cx + offset, canvas.height);
        ctx.stroke();
    }

    // Draw Crosshair
    ctx.strokeStyle = '#303036';
    ctx.beginPath();
    ctx.moveTo(cx, 0); ctx.lineTo(cx, canvas.height);
    ctx.moveTo(0, cy); ctx.lineTo(canvas.width, cy);
    ctx.stroke();

    const local = radarData.local;
    const players = radarData.players;

    if (!local || !local.pos) {
        requestAnimationFrame(render);
        return;
    }

    // Draw Players
    players.forEach(p => {
        const rPos = worldToRadar(p.pos[0], p.pos[2], local.pos[0], local.pos[2], local.rot, canvas.width, canvas.height);
        
        // Draw Dot
        ctx.fillStyle = p.isEnemy ? '#ff4444' : '#44ff44';
        ctx.beginPath();
        ctx.arc(rPos.x, rPos.y, 4, 0, Math.PI * 2);
        ctx.fill();

        // Draw Name
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = '10px Inter';
        ctx.textAlign = 'center';
        ctx.fillText(p.name, rPos.x, rPos.y - 8);
    });

    // Draw Local Player (Center Arrow)
    ctx.fillStyle = '#f3a1fa';
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(-6, 6);
    ctx.lineTo(6, 6);
    ctx.fill();
    ctx.restore();

    // Check Heartbeat
    if (Date.now() - lastPacketTime > 5000) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ff4444';
        ctx.font = 'bold 14px Orbitron';
        ctx.textAlign = 'center';
        ctx.fillText("CONNECTION LOST / STREAM PAUSED", cx, cy);
        ctx.font = '11px Inter';
        ctx.fillStyle = '#ccc';
        ctx.fillText("Waiting for data from cheat...", cx, cy + 25);
    }

    requestAnimationFrame(render);
}

// Zoom handling
canvas.onwheel = (e) => {
    e.preventDefault();
    if (e.deltaY < 0) zoom *= 1.1;
    else zoom /= 1.1;
    zoom = Math.max(0.1, Math.min(10, zoom));
    zoomValDisplay.textContent = zoom.toFixed(1);
};
