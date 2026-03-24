const loginScreen    = document.getElementById('login-screen');
const radarContainer = document.getElementById('radar-container');
const sessionInput   = document.getElementById('session-code');
const connectBtn     = document.getElementById('connect-btn');
const displayCode    = document.getElementById('display-code');
const canvas         = document.getElementById('radar-canvas');
const ctx            = canvas.getContext('2d');
const zoomValDisplay = document.getElementById('zoom-val');
const errorMsg       = document.getElementById('error-msg');
const optionsBtn     = document.getElementById('options-btn');
const optionsPanel   = document.getElementById('options-panel');

let pubnub = null;
let zoom   = 1.0;
let lastPacketTime   = 0;
let firstPacketReceived = false;

let snapshot = { players: [], local: { pos:[0,0,0], rot:[1,0,0,1], name:'', range:500 } };

let mapParts     = [];      
let pendingParts = [];     
let lastMapId    = "";

const theme = {
    accent:  [243, 161, 251], 
    opacity: 0.9
};

const playerStates = {};

const localState = { x: 0, z: 0, rot: [1, 0, 0, 1], range: 500 };

// Options
const opts = {
    showNames:    false,
    showHealth:   false,
    showDistance: false,
    showTeam:     false,
    showDead:     false,
    showMap:      false,
    followPlayer: false,
    rotateCamera: false,
    shape:       'circle',  
    dotSize:      4.5,
};

function syncOpts() {
    opts.showNames    = document.getElementById('opt-names').checked;
    opts.showHealth   = document.getElementById('opt-health').checked;
    opts.showDistance = document.getElementById('opt-distance').checked;
    opts.showTeam     = document.getElementById('opt-team').checked;
    opts.showDead     = document.getElementById('opt-dead').checked;
    opts.showMap      = document.getElementById('opt-map').checked;
    opts.followPlayer = document.getElementById('opt-follow').checked;
    opts.rotateCamera = document.getElementById('opt-rotate-cam').checked;
    opts.shape        = document.getElementById('opt-shape').value;
    opts.dotSize      = parseFloat(document.getElementById('opt-dotsize').value) || 4.5;
    document.getElementById('opt-dotsize-val').textContent = opts.dotSize.toFixed(1);
}
document.querySelectorAll('#options-panel input, #options-panel select').forEach(el =>
    el.addEventListener('change', syncOpts));

function resize() {
    canvas.width  = canvas.clientWidth;
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
    if (!code) { showError('Please enter a session code.'); return; }
    clearError();
    connectBtn.disabled = true;
    connectBtn.textContent = 'VERIFYING...';
    firstPacketReceived = false;

    if (pubnub) { pubnub.unsubscribeAll(); pubnub = null; }

    const channel = `nemesis_${code}`;
    const mapChannel = `nemesis_map_${code}`;
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

    pubnub = new PubNub({ publishKey: 'demo', subscribeKey: 'demo',
        uuid: 'viewer-' + Math.random().toString(36).substr(2,6) });

    pubnub.addListener({ message: (ev) => {
        try {
            const data = ev.message;
            if (!data) return;

            if (data.players !== undefined || data.local !== undefined) {
                if (!firstPacketReceived) {
                    console.log("first valid packet received, starting ui", data);
                    firstPacketReceived = true;
                    clearTimeout(timeout);
                    clearError();
                    loginScreen.classList.add('hidden');
                    radarContainer.classList.remove('hidden');
                    resize();  
                    displayCode.textContent = code;
                    connectBtn.disabled = false;
                    connectBtn.textContent = 'CONNECT';
                    requestAnimationFrame(render);
                }

                snapshot = data;
                lastPacketTime = Date.now();

                if (data.local) {
                    localState.targetX = data.local.pos[0];
                    localState.targetZ = data.local.pos[2];
                    localState.targetRot = data.local.rot;
                    localState.range = data.local.range || 500;
                    localState.name = data.local.name;
                    
                    if (data.local.theme) {
                        theme.accent[0] = Math.round(data.local.theme.accent[0] * 255);
                        theme.accent[1] = Math.round(data.local.theme.accent[1] * 255);
                        theme.accent[2] = Math.round(data.local.theme.accent[2] * 255);
                        theme.opacity   = data.local.theme.opacity;
                    }

                    if (localState.x === 0 && localState.z === 0) {
                        localState.x = localState.targetX;
                        localState.z = localState.targetZ;
                        localState.rot = localState.targetRot;
                    }
                }

                const players = data.players || [];
                for (const p of players) {
                    if (!p.name) continue;
                    if (!playerStates[p.name]) {
                        playerStates[p.name] = { x: p.pos[0], z: p.pos[2], fx: p.facing?.[0]||0, fz: p.facing?.[1]||-1,
                            health: p.health, maxHealth: p.maxHealth, isEnemy: p.isEnemy, dead: false };
                    } else {
                        const st = playerStates[p.name];
                        st.targetX = p.pos[0]; st.targetZ = p.pos[2];
                        st.targetFx = p.facing?.[0]||st.fx; st.targetFz = p.facing?.[1]||st.fz;
                        st.health = p.health; st.maxHealth = p.maxHealth;
                        st.isEnemy = p.isEnemy; st.name = p.name;
                        st.dead = (p.health !== undefined && p.health <= 0);
                    }
                }
                const names = new Set(players.map(p => p.name));
                for (const k of Object.keys(playerStates)) if (!names.has(k)) delete playerStates[k];
            }

            if (data.map) {
                if (data.mapId !== lastMapId) {
                    pendingParts = [];
                    lastMapId = data.mapId;
                }
                
                pendingParts = pendingParts.concat(data.map);
                
                if (data.chunk === data.total - 1) {
                    mapParts = pendingParts;
                    console.log(`map updated: ${mapParts.length} parts (ID: ${lastMapId})`);
                }
            }
        } catch(e) { console.error(e); }
    }});
    pubnub.subscribe({ channels: [channel, mapChannel] });
}

// Auto-connect from URL
const urlParams = new URLSearchParams(window.location.search);
const urlCode   = urlParams.get('code');
if (urlCode) { sessionInput.value = urlCode; window.addEventListener('load', () => setTimeout(connect, 200)); }

connectBtn.onclick = connect;
sessionInput.onkeydown = (e) => { if (e.key === 'Enter') connect(); };

// Options panel toggle
if (optionsBtn && optionsPanel) {
    optionsBtn.onclick = () => {
        optionsPanel.style.display = (optionsPanel.style.display === 'none') ? 'block' : 'none';
    };
}

function worldToRadar(dx, dz, rot) {
    const r00 = rot[0], r02 = rot[1], r20 = rot[2], r22 = rot[3];
    let fX = -r02, fZ = -r22;
    const fLen = Math.sqrt(fX*fX + fZ*fZ);
    if (fLen < 0.001) return { rx: dx, rz: dz };
    fX /= fLen; fZ /= fLen;
    let rX = r00, rZ = r20;
    const rLen = Math.sqrt(rX*rX + rZ*rZ);
    if (rLen > 0.001) { rX /= rLen; rZ /= rLen; }
    else { rX = -fZ; rZ = fX; }
    return {
        rx:  dx * rX + dz * rZ,
        rz: -(dx * fX + dz * fZ)
    };
}

let lastFrameTime = performance.now();

function render() {
    if (radarContainer.classList.contains('hidden')) return;
    if (canvas.width === 0 || canvas.height === 0) { resize(); requestAnimationFrame(render); return; }

    const now = performance.now();
    const dt  = Math.min((now - lastFrameTime) / 1000, 0.1);
    lastFrameTime = now;
    const lerpSpeed = 12.0;
    const lerpK = Math.min(1.0, lerpSpeed * dt);

    if (localState.targetX !== undefined) {
        localState.x += (localState.targetX - localState.x) * lerpK;
        localState.z += (localState.targetZ - localState.z) * lerpK;
        if (localState.targetRot) {
            for (let i = 0; i < 4; i++) {
                localState.rot[i] += (localState.targetRot[i] - localState.rot[i]) * lerpK;
            }
        }
    }

    const W  = canvas.width, H = canvas.height;
    const cx = W / 2,        cy = H / 2;
    const range  = localState.range;
    
    const rot = opts.rotateCamera ? localState.rot : [1, 0, 0, 1]; 
    const lx  = opts.followPlayer ? localState.x   : 0;
    const lz  = opts.followPlayer ? localState.z   : 0;

    const isCirc = opts.shape === 'circle';
    const radius = Math.min(W, H) * 0.5 - 2;
    const scale  = (radius / range) * zoom;

    ctx.clearRect(0, 0, W, H);
    ctx.save();

    if (isCirc) {
        ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI*2); ctx.clip();
    } else {
        ctx.beginPath(); ctx.rect(cx - radius, cy - radius, radius * 2, radius * 2); ctx.clip();
    }

    const opacity = theme.opacity;
    const accent  = `rgba(${theme.accent[0]}, ${theme.accent[1]}, ${theme.accent[2]}, ${opacity})`;

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, `rgba(12,12,16,${opacity * 0.95})`);
    grad.addColorStop(1, `rgba(5,5,7,${opacity * 0.98})`);
    ctx.fillStyle = grad;

    if (isCirc) { ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI*2); ctx.fill(); }
    else { ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2); }

    ctx.strokeStyle = `rgba(70,70,80,${0.31 * opacity})`;
    ctx.lineWidth = 1;
    if (isCirc) {
        for (let i = 0; i <= 4; i++) {
            const off = (radius * 2 / 4) * i - radius;
            const ab = Math.sqrt(Math.max(0, radius*radius - off*off));
            ctx.beginPath(); ctx.moveTo(cx + off, cy - ab); ctx.lineTo(cx + off, cy + ab); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(cx - ab, cy + off); ctx.lineTo(cx + ab, cy + off); ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(cx, cy, radius * 0.5, 0, Math.PI*2); ctx.stroke();
    } else {
        for (let i = 0; i <= 4; i++) {
            const off = (radius * 2 / 4) * i - radius;
            ctx.beginPath(); ctx.moveTo(cx + off, cy - radius); ctx.lineTo(cx + off, cy + radius); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(cx - radius, cy + off); ctx.lineTo(cx + radius, cy + off); ctx.stroke();
        }
        ctx.strokeRect(cx - radius*0.5, cy - radius*0.5, radius, radius);
    }

    if (opts.showMap && mapParts.length > 0) {
        ctx.fillStyle   = `rgba(40,40,45,${0.47 * opacity})`;
        ctx.strokeStyle = `rgba(70,70,80,${0.31 * opacity})`;
        ctx.lineWidth   = 1.0;

        for (const part of mapParts) {
            const [pcx, pcz, psx, psz, pr00, pr02, pr20, pr22] = part;
            const hx = psx * 0.5, hz = psz * 0.5;

            const corners = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]];
            const pts = [];
            for (const [lx_, lz_] of corners) {
                const wx = pcx + lx_ * pr00 + lz_ * pr02;
                const wz = pcz + lx_ * pr20 + lz_ * pr22;
                const dx = wx - lx, dz = wz - lz;
                const {rx, rz} = worldToRadar(dx, dz, rot);
                pts.push([cx + rx * scale, cy + rz * scale]);
            }

            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < 4; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }
    }

    ctx.strokeStyle = `rgba(70,70,80,${0.8 * opacity})`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius); ctx.stroke();

    for (const [name, st] of Object.entries(playerStates)) {
        if (st.targetX !== undefined) {
            st.x  += (st.targetX - st.x)  * lerpK;
            st.z  += (st.targetZ - st.z)  * lerpK;
            st.fx += (st.targetFx - st.fx) * lerpK;
            st.fz += (st.targetFz - st.fz) * lerpK;
        }

        if (!opts.showDead && st.dead) continue;
        if (!opts.showTeam && !st.isEnemy) continue;

        const dx = st.x - lx, dz = st.z - lz;
        const {rx, rz} = worldToRadar(dx, dz, rot);
        let relX = rx / range, relY = rz / range;

        if (isCirc) {
            const d = Math.sqrt(relX*relX + relY*relY);
            if (d > 0.96) { relX = (relX/d)*0.98; relY = (relY/d)*0.98; }
        } else {
            relX = Math.max(-0.98, Math.min(0.98, relX));
            relY = Math.max(-0.98, Math.min(0.98, relY));
        }

        const px = cx + rx * scale;
        const py = cy + rz * scale;

        const {rx: rfx, rz: rfz} = worldToRadar(st.fx, st.fz, rot);
        const fLen = Math.sqrt(rfx*rfx + rfz*rfz);
        const dotColor = st.isEnemy ? `rgba(255,60,60,${opacity})` : `rgba(173,216,230,${opacity})`;
        const outColor = `rgba(0,0,0,${0.8 * opacity})`;

        ctx.shadowBlur = 8;
        ctx.shadowColor = st.isEnemy ? 'rgba(255,60,60,0.5)' : 'rgba(173,216,230,0.5)';

        if (fLen > 0.001) {
            const nfx = rfx/fLen, nfz = rfz/fLen;
            const s = opts.dotSize;
            const p1 = [px + nfx*s*1.5,       py + nfz*s*1.5];
            const p2 = [px + (-nfx - nfz)*s,  py + (-nfz + nfx)*s];
            const p3 = [px + (-nfx + nfz)*s,  py + (-nfz - nfx)*s];

            ctx.beginPath(); ctx.moveTo(p1[0],p1[1]); ctx.lineTo(p2[0],p2[1]); ctx.lineTo(p3[0],p3[1]); ctx.closePath();
            ctx.fillStyle = dotColor; ctx.fill();
            ctx.strokeStyle = outColor; ctx.lineWidth = 1; ctx.stroke();
        } else {
            ctx.beginPath(); ctx.arc(px, py, opts.dotSize, 0, Math.PI*2);
            ctx.fillStyle = dotColor; ctx.fill();
            ctx.strokeStyle = outColor; ctx.lineWidth = 1; ctx.stroke();
        }
        ctx.shadowBlur = 0; 


        let label = '';
        if (opts.showNames)    label += name;
        if (opts.showHealth && st.maxHealth) label += (label?' ':'') + '[' + Math.round(st.health) + ']';
        if (opts.showDistance) {
            const dm = Math.round(Math.sqrt(dx*dx + dz*dz));
            label += (label?' ':'') + dm + 'm';
        }
        if (label) {
            ctx.font = '10px Inter, sans-serif';
            ctx.textAlign = 'center';
            const lY = py - opts.dotSize - 4;
            ctx.fillStyle = 'rgba(0,0,0,0.8)';
            ctx.fillText(label, px+1, lY+1);
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.fillText(label, px, lY);
        }
    }

    if (opts.followPlayer || (Math.abs(localState.x-lx) < range*zoom && Math.abs(localState.z-lz) < range*zoom)) {
        const d_lx = localState.x - lx, d_lz = localState.z - lz;
        const {rx: lrx, rz: lrz} = worldToRadar(d_lx, d_lz, rot);
        const lpx = cx + lrx * scale;
        const lpy = cy + lrz * scale;

        ctx.save();
        ctx.translate(lpx, lpy);
        
        if (!opts.rotateCamera) {
            const {rx: rfx, rz: rfz} = worldToRadar(-localState.rot[1], -localState.rot[3], [1,0,0,1]);
            const fAngle = Math.atan2(rfz, rfx) + Math.PI/2;
            ctx.rotate(fAngle);
        }

        const lps = 5.0;
        ctx.beginPath();
        ctx.moveTo(0, -lps*1.8); ctx.lineTo(-lps*1.2, lps); ctx.lineTo(lps*1.2, lps);
        ctx.closePath();
        
        ctx.shadowBlur = 10;
        ctx.shadowColor = `rgba(255,255,255,0.4)`;
        ctx.fillStyle = `rgba(255,255,255,${opacity})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(0,0,0,${0.8 * opacity})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.restore();

        if (opts.showNames && localState.name) {
            ctx.font = 'bold 10px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(0,0,0,0.8)';
            ctx.fillText(localState.name, lpx+1, lpy - lps*1.5 - 5);
            ctx.fillStyle = 'rgba(240,240,240,0.9)';
            ctx.fillText(localState.name, lpx, lpy - lps*1.5 - 6);
        }
    }

    ctx.restore(); 
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    if (isCirc) { ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI*2); ctx.stroke(); }
    else { ctx.strokeRect(cx - radius, cy - radius, radius*2, radius*2); }

    if (lastPacketTime > 0 && Date.now() - lastPacketTime > 5000) {
        ctx.fillStyle = 'rgba(0,0,0,0.85)';
        ctx.fillRect(0, 0, W, H);
        
        ctx.shadowBlur = 15;
        ctx.shadowColor = '#ff4444';
        ctx.fillStyle = '#ff4444'; 
        ctx.font = 'bold 16px Orbitron, sans-serif'; 
        ctx.textAlign = 'center';
        ctx.fillText('CONNECTION LOST', cx, cy - 10);
        
        ctx.shadowBlur = 0;
        ctx.font = '12px Inter, sans-serif'; ctx.fillStyle = '#aaa';
        ctx.fillText('Waiting for data from cheat...', cx, cy + 18);
    }

    requestAnimationFrame(render);
}

canvas.onwheel = (e) => {
    e.preventDefault();
    zoom *= e.deltaY < 0 ? 1.1 : 0.9;
    zoom = Math.max(0.2, Math.min(10, zoom));
    if (zoomValDisplay) zoomValDisplay.textContent = zoom.toFixed(1);
};
