// DOM Elements
const selectWindowBtn = document.getElementById('select-window-btn');
const vnVideo = document.getElementById('vn-video');
const selectionOverlay = document.getElementById('selection-overlay');
const historyContent = document.getElementById('history-content');
const ttsVoiceSelect = document.getElementById('tts-voice-select');
const speakLatestBtn = document.getElementById('speak-latest-btn');
const latestText = document.getElementById('latest-text');
const ocrStatus = document.getElementById('ocr-status');
const refreshOcrBtn = document.getElementById('refresh-ocr-btn');
const clearHistoryBtn = document.getElementById('clear-history-btn');
const engineSelector = document.getElementById('mode-selector');
const panicBtn = document.getElementById('panic-btn');
const langSelector = document.getElementById('model-selector');
const autoToggle = document.getElementById('auto-capture-toggle');
const upscaleSlider = document.getElementById('upscale-slider');
const upscaleVal = document.getElementById('upscale-val');

// Phase 3: Minimal Settings Wrapper
const settings = {
    get: (key, def) => {
        const val = localStorage.getItem('vn-ocr-' + key);
        return val === null ? def : JSON.parse(val);
    },
    set: (key, val) => localStorage.setItem('vn-ocr-' + key, JSON.stringify(val))
};

// Phase 4: Theme Management
const themeToggle = document.getElementById('theme-toggle');
function updateThemeUI(theme) {
    if (!themeToggle) return;
    themeToggle.textContent = theme === 'light' ? '🌙' : '🌞';
    document.body.classList.toggle('light-theme', theme === 'light');
}
if (themeToggle) {
    themeToggle.onclick = () => {
        const current = document.body.classList.contains('light-theme') ? 'light' : 'dark';
        const next = current === 'light' ? 'dark' : 'light';
        settings.set('theme', next);
        updateThemeUI(next);
    };
}

// Phase 5: PWA Install Management
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
});

document.getElementById('install-btn')?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
});



// State
let voices = [];
let currentUtterance = null;
let videoStream = null;
let ocrWorker = null;
let isOcrReady = false;
let isProcessing = false;
let selectionRect = null;
let currentModelAlias = null;
let loadedModels = new Set();

// Smart Scout: 32x32 Comparison Logic
const scoutCanvas = document.createElement('canvas');
scoutCanvas.width = 32; scoutCanvas.height = 32;
const scoutCtx = scoutCanvas.getContext('2d');
let lastScoutData = null;
let autoCaptureTimer = null;
let stabilityTimer = null;

// ==========================================
// 0. Initialization & UI Sync
// ==========================================

function loadVoices() {
    voices = window.speechSynthesis.getVoices();
    const jaVoices = voices.filter(v => v.lang.startsWith('ja'));
    if (ttsVoiceSelect) {
        ttsVoiceSelect.innerHTML = '<option value="">🔇 TTS Off</option>';
        jaVoices.forEach((voice) => {
            const option = document.createElement('option');
            option.value = voice.name;
            option.textContent = voice.name;
            if (voice.name.includes('Haruka') || voice.name.includes('Google 日本語')) option.selected = true;
            ttsVoiceSelect.appendChild(option);
        });
    }
}
window.speechSynthesis.onvoiceschanged = loadVoices;
loadVoices();

if (upscaleSlider) {
    upscaleSlider.oninput = () => upscaleVal.textContent = parseFloat(upscaleSlider.value).toFixed(1);
}

function setOCRStatus(state, text) {
    if (!ocrStatus) return;
    ocrStatus.className = `status-pill ${state}`;
    ocrStatus.textContent = text;
}

async function ensureModelLoaded(requestedAlias) {
    if (ocrWorker && currentModelAlias === requestedAlias) return;
    setOCRStatus('loading', `🟡 Loading ${requestedAlias}...`);
    isOcrReady = false;
    if (ocrWorker) { await ocrWorker.terminate(); ocrWorker = null; }
    try {
        let langPath = 'https://tessdata.projectnaptha.com/4.0.0/';
        let useGzip = true;
        let actualLang = 'jpn';
        if (requestedAlias === 'jpn_best') {
            langPath = 'https://cdn.jsdelivr.net/gh/tesseract-ocr/tessdata_best@main/';
            useGzip = false;
        } else if (requestedAlias === 'jpn_fast') {
            langPath = 'https://cdn.jsdelivr.net/gh/tesseract-ocr/tessdata_fast@main/';
            useGzip = false;
        } else if (requestedAlias === 'jpn_vert') actualLang = 'jpn_vert';

        ocrWorker = await Tesseract.createWorker(actualLang, 1, {
            langPath: langPath,
            gzip: useGzip,
            logger: m => {
                if (m.status === 'loading language traineddata') {
                    const pct = Math.round(m.progress * 100);
                    setOCRStatus('loading', `🟡 Data ${pct}%`);
                }
            }
        });
        currentModelAlias = requestedAlias;
        isOcrReady = true;
        setOCRStatus('ready', '🟢 OCR Ready');
    } catch (e) {
        setOCRStatus('error', '🔴 Load Error');
        if (requestedAlias !== 'jpn') await ensureModelLoaded('jpn');
    }
}

async function initOCR() {
    const model = langSelector ? langSelector.value : 'jpn_best';
    await ensureModelLoaded(model);
}
initOCR();

if (langSelector) {
    langSelector.addEventListener('change', () => ensureModelLoaded(langSelector.value));
}

if (panicBtn) {
    panicBtn.onclick = () => {
        engineSelector.value = 'last_resort';
        panicBtn.classList.add('active');
        setTimeout(() => panicBtn.classList.remove('active'), 1000);
        if (selectionRect) captureFrame(selectionRect);
    };
}

// ==========================================
// 1. Audio & TTS
// ==========================================

function speak(text) {
    if (!ttsVoiceSelect || !ttsVoiceSelect.value || !text) return;
    if (currentUtterance) window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const selectedVoice = voices.find(v => v.name === ttsVoiceSelect.value);
    if (selectedVoice) utterance.voice = selectedVoice;
    utterance.lang = 'ja-JP';
    currentUtterance = utterance;
    window.speechSynthesis.speak(utterance);
}

if (speakLatestBtn) speakLatestBtn.onclick = () => { if (latestText) speak(latestText.textContent); };

if (historyContent) {
    historyContent.addEventListener('click', e => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const item = btn.closest('.history-item');
        const textSpan = item ? item.querySelector('span') : null;
        if (!textSpan) return;
        const action = btn.getAttribute('data-action');
        if (action === 'speak') speak(textSpan.textContent);
        if (action === 'copy') {
            navigator.clipboard.writeText(textSpan.textContent);
            btn.innerHTML = '✅';
            setTimeout(() => btn.innerHTML = '📋', 1000);
        }
    });
}

// ==========================================
// 2. Window Capture
// ==========================================

async function startCapture() {
    try {
        videoStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: "never" }, audio: false });
        vnVideo.srcObject = videoStream;
        videoStream.getVideoTracks()[0].onended = stopCapture;
        selectWindowBtn.classList.add('stop');
        selectWindowBtn.textContent = 'Stop Capture';
        document.getElementById('placeholder').style.display = 'none';
        const hint = document.getElementById('selection-hint');
        if (hint) hint.classList.add('visible');
    } catch (err) { }
}

function stopCapture() {
    if (videoStream) videoStream.getTracks().forEach(t => t.stop());
    videoStream = null; vnVideo.srcObject = null;
    document.getElementById('placeholder').style.display = 'flex';
    const hint = document.getElementById('selection-hint');
    if (hint) hint.classList.remove('visible');
    selectWindowBtn.classList.remove('stop');
    selectWindowBtn.textContent = 'Select Window Source';
}

if (selectWindowBtn) selectWindowBtn.onclick = () => videoStream ? stopCapture() : startCapture();

// ==========================================
// 3. Selection Overlay Logic
// ==========================================

if (selectionOverlay) {
    const ctx = selectionOverlay.getContext('2d');
    let isSelecting = false, startX = 0, startY = 0, currentX = 0, currentY = 0;
    const resizeCanvas = () => {
        selectionOverlay.width = selectionOverlay.clientWidth;
        selectionOverlay.height = selectionOverlay.clientHeight;
        if (selectionRect) drawSelectionRect();
    };
    new ResizeObserver(resizeCanvas).observe(selectionOverlay);
    const getMousePos = (e) => {
        const rect = selectionOverlay.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    selectionOverlay.onmousedown = e => {
        if (e.button !== 0) return;
        isSelecting = true; const pos = getMousePos(e);
        startX = currentX = pos.x; startY = currentY = pos.y;
        selectionRect = null; drawSelectionRect();
        const hint = document.getElementById('selection-hint');
        if (hint) hint.classList.remove('visible');
    };
    window.onmousemove = e => { if (isSelecting) { const pos = getMousePos(e); currentX = pos.x; currentY = pos.y; drawSelectionRect(); } };
    window.onmouseup = e => {
        if (!isSelecting) return;
        isSelecting = false; const pos = getMousePos(e);
        currentX = pos.x; currentY = pos.y;
        const w = selectionOverlay.width, h = selectionOverlay.height;
        const finalRect = {
            x: Math.min(startX, currentX) / w,
            y: Math.min(startY, currentY) / h,
            width: Math.abs(currentX - startX) / w,
            height: Math.abs(currentY - startY) / h
        };
        const hint = document.getElementById('selection-hint');
        if (finalRect.width > 0.005) {
            selectionRect = finalRect;
            refreshOcrBtn.disabled = false;
            captureFrame(selectionRect);
            if (hint) hint.classList.remove('visible');
        } else {
            selectionRect = null;
            if (hint) hint.classList.add('visible');
        }
        drawSelectionRect();
    };
    function drawSelectionRect() {
        const canvasW = selectionOverlay.width, canvasH = selectionOverlay.height;
        ctx.clearRect(0, 0, canvasW, canvasH);
        if (!isSelecting && !selectionRect) return;
        const x = isSelecting ? Math.min(startX, currentX) : selectionRect.x * canvasW;
        const y = isSelecting ? Math.min(startY, currentY) : selectionRect.y * canvasH;
        const w = isSelecting ? Math.abs(currentX - startX) : selectionRect.width * canvasW;
        const h = isSelecting ? Math.abs(currentY - startY) : selectionRect.height * canvasH;
        if (isSelecting) { ctx.fillStyle = 'rgba(16, 185, 129, 0.15)'; ctx.fillRect(x, y, w, h); }
        ctx.strokeStyle = '#10b981'; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h);
        ctx.fillStyle = '#10b981'; const s = 10;
        ctx.fillRect(x, y, s, 3); ctx.fillRect(x, y, 3, s);
        ctx.fillRect(x + w - s, y, s, 3); ctx.fillRect(x + w - 3, y, 3, s);
        ctx.fillRect(x, y + h - 3, s, 3); ctx.fillRect(x, y + h - s, 3, s);
        ctx.fillRect(x + w - s, y + h - 3, s, 3); ctx.fillRect(x + w - 3, y + h - s, 3, s);
    }
}

// ==========================================
// 4. Auto-Capture
// ==========================================

function checkAutoCapture() {
    if (!autoToggle || !autoToggle.checked || !videoStream || !selectionRect || isProcessing) return;
    const vWidth = vnVideo.videoWidth, vHeight = vnVideo.videoHeight;
    const cWidth = selectionOverlay.width, cHeight = selectionOverlay.height;
    const vAspect = vWidth / vHeight, cAspect = cWidth / cHeight;
    let actualWidth, actualHeight, offsetX = 0, offsetY = 0;
    if (vAspect > cAspect) { actualWidth = cWidth; actualHeight = cWidth / vAspect; offsetY = (cHeight - actualHeight) / 2; }
    else { actualHeight = cHeight; actualWidth = cHeight * vAspect; offsetX = (cWidth - actualWidth) / 2; }

    // Denormalize selection for current canvas state
    const rectX = selectionRect.x * cWidth, rectY = selectionRect.y * cHeight;
    const rectW = selectionRect.width * cWidth, rectH = selectionRect.height * cHeight;

    const finalX = ((rectX - offsetX) / actualWidth) * vWidth;
    const finalY = ((rectY - offsetY) / actualHeight) * vHeight;
    const finalW = (rectW / actualWidth) * vWidth;
    const finalH = (rectH / actualHeight) * vHeight;
    scoutCtx.drawImage(vnVideo, finalX, finalY, finalW, finalH, 0, 0, 32, 32);
    const pix = scoutCtx.getImageData(0, 0, 32, 32).data;
    const currentData = new Uint32Array(pix.buffer);
    if (lastScoutData) {
        let diffPixels = 0;
        for (let i = 0; i < currentData.length; i++) { if (currentData[i] !== lastScoutData[i]) diffPixels++; }
        if (diffPixels > 10) {
            clearTimeout(stabilityTimer);
            autoToggle.parentElement.classList.add('active');
            stabilityTimer = setTimeout(() => { autoToggle.parentElement.classList.remove('active'); captureFrame(selectionRect); }, 800);
        }
    }
    lastScoutData = new Uint32Array(currentData);
}

if (autoToggle) {
    autoToggle.onchange = () => {
        const label = autoToggle.nextElementSibling;
        settings.set('auto-capture', autoToggle.checked);
        if (autoToggle.checked) {
            if (label) label.textContent = "auto re-capture ON";
            autoCaptureTimer = setInterval(checkAutoCapture, 500);
        } else {
            if (label) label.textContent = "auto re-capture OFF";
            clearInterval(autoCaptureTimer);
            autoToggle.parentElement.classList.remove('active');
        }
    };
}

// ==========================================
// 5. OCR Processing Core
// ==========================================

// PATCH 1 Helper
function imageDataToCanvas(id) {
    const c = document.createElement('canvas');
    c.width = id.width;
    c.height = id.height;
    c.getContext('2d').putImageData(id, 0, 0);
    return c;
}

// Helper: scale canvas down to fit bounding box (never upscales)
function scaleCanvasToThumb(c, maxW, maxH) {
    const r = document.createElement('canvas');
    const ratio = Math.min(maxW / c.width, maxH / c.height, 1);
    r.width = c.width * ratio;
    r.height = c.height * ratio;
    r.getContext('2d').drawImage(c, 0, 0, r.width, r.height);
    return r;
}

async function captureFrame(rect) {
    if (!vnVideo || !vnVideo.videoWidth || !rect || isProcessing) return;
    isProcessing = true;

    const vWidth = vnVideo.videoWidth, vHeight = vnVideo.videoHeight;
    const cWidth = selectionOverlay.width, cHeight = selectionOverlay.height;
    const vAspect = vWidth / vHeight, cAspect = cWidth / cHeight;
    let actualWidth, actualHeight, offsetX = 0, offsetY = 0;
    if (vAspect > cAspect) { actualWidth = cWidth; actualHeight = cWidth / vAspect; offsetY = (cHeight - actualHeight) / 2; }
    else { actualHeight = cHeight; actualWidth = cHeight * vAspect; offsetX = (cWidth - actualWidth) / 2; }

    // Denormalize selection for current canvas state
    const rectX = rect.x * cWidth, rectY = rect.y * cHeight;
    const rectW = rect.width * cWidth, rectH = rect.height * cHeight;

    const finalX = ((rectX - offsetX) / actualWidth) * vWidth;
    const finalY = ((rectY - offsetY) / actualHeight) * vHeight;
    const finalW = (rectW / actualWidth) * vWidth;
    const finalH = (rectH / actualHeight) * vHeight; // PATCH 4 (Fix Crop Ratio Bug)
    const cx_ = Math.max(0, Math.floor(finalX)), cy_ = Math.max(0, Math.floor(finalY));
    const cw_ = Math.max(1, Math.min(vWidth - cx_, Math.floor(finalW))), ch_ = Math.max(1, Math.min(vHeight - cy_, Math.floor(finalH)));

    const crop = document.createElement('canvas');
    crop.width = cw_; crop.height = ch_;
    crop.getContext('2d').drawImage(vnVideo, cx_, cy_, cw_, ch_, 0, 0, cw_, ch_);

    const debugThumb = document.getElementById('debug-crop-img');
    const mode = engineSelector.value;
    const model = langSelector.value;

    try {
        await ensureModelLoaded(model);
        if (mode === 'last_resort') {
            const cropCanvas = imageDataToCanvas(crop.getContext('2d').getImageData(0, 0, crop.width, crop.height)); // PATCH 1
            const result = await runLastResortOCR(cropCanvas);
            if (debugThumb && result.canvas) {
                // PATCH 2: wide/short single-line captures shown native; larger crops scaled down
                if (result.canvas.height < 120) {
                    debugThumb.src = result.canvas.toDataURL();
                } else {
                    debugThumb.src = scaleCanvasToThumb(result.canvas, 700, 300).toDataURL();
                }
                debugThumb.style.display = 'block';
            }
            addOCRResultToUI(result.text);
        } else if (mode === 'multi') {
            const result = await runMultiPassOCR(crop);
            if (debugThumb && result.canvas) {
                // PATCH 2: wide/short single-line captures shown native; larger crops scaled down
                if (result.canvas.height < 120) {
                    debugThumb.src = result.canvas.toDataURL();
                } else {
                    debugThumb.src = scaleCanvasToThumb(result.canvas, 700, 300).toDataURL();
                }
                debugThumb.style.display = 'block';
            }
            addOCRResultToUI(result.text);
        } else {
            const processed = applyPreprocessing(crop, mode);
            if (debugThumb) {
                // PATCH 2: wide/short single-line captures shown native; larger crops scaled down
                if (processed.height < 120) {
                    debugThumb.src = processed.toDataURL();
                } else {
                    debugThumb.src = scaleCanvasToThumb(processed, 700, 300).toDataURL();
                }
                debugThumb.style.display = 'block';
            }
            setOCRStatus('processing', '🟡 Reading...');
            const result = await runTesseract(processed);
            addOCRResultToUI(result.text);
        }
    } catch (err) { setOCRStatus('error', '🔴 OCR Error'); }
    finally { isProcessing = false; if (isOcrReady) setOCRStatus('ready', '🟢 OCR Ready'); }
}

function applyPreprocessing(canvas, mode) {
    if (mode === 'raw') return canvas;
    canvas = lr_upscale(canvas, 2);
    // Standard modes no longer upscale internally (PATCH 2)
    const res = document.createElement('canvas'); res.width = canvas.width; res.height = canvas.height;
    const ctx = res.getContext('2d'); ctx.drawImage(canvas, 0, 0);
    const id = ctx.getImageData(0, 0, res.width, res.height); const d = id.data;
    if (mode === 'binarize') {
        for (let i = 0; i < d.length; i += 4) {
            const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            const contrasted = 128 + (v - 128) * 1.35;
            const out = contrasted < 0 ? 0 : (contrasted > 255 ? 255 : contrasted);
            d[i] = d[i + 1] = d[i + 2] = out;
        }
    } else if (mode === 'adaptive') {
        const w = res.width, h = res.height;
        const integral = new Float64Array(w * h);
        const luma = new Float64Array(w * h);
        for (let y = 0; y < h; y++) {
            let rowSum = 0;
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                luma[y * w + x] = v;
                rowSum += v;
                integral[y * w + x] = (y === 0 ? 0 : integral[(y - 1) * w + x]) + rowSum;
            }
        }
        const s = Math.floor(w / 8);
        const s2 = Math.floor(s / 2);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const x1 = Math.max(0, x - s2), x2 = Math.min(w - 1, x + s2);
                const y1 = Math.max(0, y - s2), y2 = Math.min(h - 1, y + s2);
                const count = (x2 - x1 + 1) * (y2 - y1 + 1);
                let sum = integral[y2 * w + x2];
                if (x1 > 0) sum -= integral[y2 * w + x1 - 1];
                if (y1 > 0) sum -= integral[(y1 - 1) * w + x2];
                if (x1 > 0 && y1 > 0) sum += integral[(y1 - 1) * w + x1 - 1];
                const i = (y * w + x) * 4;
                d[i] = d[i + 1] = d[i + 2] = (luma[y * w + x] * count < sum * 0.85) ? 0 : 255;
            }
        }
    } else if (mode === 'grayscale') {
        for (let i = 0; i < d.length; i += 4) {
            const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            const contrasted = 128 + (v - 128) * 1.15;
            const out = contrasted < 0 ? 0 : (contrasted > 255 ? 255 : contrasted);
            d[i] = d[i + 1] = d[i + 2] = out;
        }
    }
    ctx.putImageData(id, 0, 0);
    return res;
}

// Enhancements
function lr_upscale(canvas, f) {
    const res = document.createElement('canvas'); res.width = canvas.width * f; res.height = canvas.height * f;
    const ctx = res.getContext('2d');
    ctx.imageSmoothingEnabled = false; // PATCH 2 (Fix lr_upscale)
    ctx.drawImage(canvas, 0, 0, res.width, res.height); return res;
}

function lr_addPadding(canvas, pad) {
    const res = document.createElement('canvas');
    res.width = canvas.width;
    res.height = canvas.height + pad * 2;
    const ctx = res.getContext('2d');
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, res.width, res.height);
    ctx.drawImage(canvas, 0, pad);
    return res;
}

function lr_binarize(canvas) {
    const ctx = canvas.getContext('2d'); const w = canvas.width, h = canvas.height; const id = ctx.getImageData(0, 0, w, h); const d = id.data;
    for (let i = 0; i < d.length; i += 4) { const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; const b = v < 128 ? 0 : 255; d[i] = d[i + 1] = d[i + 2] = b; }
    const res = document.createElement('canvas'); res.width = w; res.height = h; res.getContext('2d').putImageData(id, 0, 0); return res;
}

function lr_isolateTextbox(canvas) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    if (h < 100) return canvas;
    const id = ctx.getImageData(0, 0, w, h);
    const d = id.data;
    const projection = new Float32Array(h);
    for (let y = 1; y < h - 1; y++) {
        let sum = 0;
        for (let x = 1; x < w - 1; x++) {
            const idx = (y * w + x) * 4;
            sum += Math.abs(d[idx] - d[idx + 4]) + Math.abs(d[idx] - d[idx + w * 4]);
        }
        projection[y] = sum / w;
    }
    let bestBand = { start: 0, end: h, avg: 0 };
    const bandH = Math.floor(h * 0.25);
    for (let y = 0; y < h - bandH; y++) {
        let sum = 0; for (let i = 0; i < bandH; i++) sum += projection[y + i];
        const avg = sum / bandH;
        if (avg > bestBand.avg) bestBand = { start: y, end: y + bandH, avg: avg };
    }
    if (bestBand.avg < 10) return canvas;
    const padTop = 20;
    const padBottom = 80;
    const start = Math.max(0, bestBand.start - padTop);
    const end = Math.min(h, bestBand.end + padBottom);
    const res = document.createElement('canvas'); res.width = w; res.height = end - start;
    res.getContext('2d').drawImage(canvas, 0, start, w, end - start, 0, 0, w, end - start);
    return res;
}

function lr_reconstructStrokes(canvas) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const id = ctx.getImageData(0, 0, w, h);
    const d = id.data;
    const edges = new Float32Array(w * h);
    const kx = [-1, 0, 1, -2, 0, 2, -1, 0, 1], ky = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            let gx = 0, gy = 0;
            for (let i = -1; i <= 1; i++) {
                for (let j = -1; j <= 1; j++) {
                    const v = (d[((y + i) * w + (x + j)) * 4] + d[((y + i) * w + (x + j)) * 4 + 1] + d[((y + i) * w + (x + j)) * 4 + 2]) / 3;
                    gx += v * kx[(i + 1) * 3 + (j + 1)]; gy += v * ky[(i + 1) * 3 + (j + 1)];
                }
            }
            edges[y * w + x] = Math.sqrt(gx * gx + gy * gy);
        }
    }
    const dilated = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            let m = 0;
            for (let iy = -1; iy <= 1; iy++) {
                for (let ix = -1; ix <= 1; ix++) {
                    const v = edges[(y + iy) * w + (x + ix)];
                    if (v > m) m = v;
                }
            }
            dilated[y * w + x] = m;
        }
    }
    const out = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
        const g = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3;
        const v = Math.min(255, (g * 0.6) + (dilated[i] * 0.4));
        out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = v;
        out.data[i * 4 + 3] = 255;
    }
    const res = document.createElement('canvas'); res.width = w; res.height = h;
    res.getContext('2d').putImageData(out, 0, 0);
    return res;
}

function lr_sharpen(canvas) {
    const ctx = canvas.getContext('2d'); const w = canvas.width, h = canvas.height; const id = ctx.getImageData(0, 0, w, h); const d = id.data;
    const output = ctx.createImageData(w, h); const od = output.data; const weights = [0, -1, 0, -1, 5, -1, 0, -1, 0];
    for (let y = 1; y < h - 1; y++) { for (let x = 1; x < w - 1; x++) { for (let c = 0; c < 3; c++) { let sum = 0; for (let ky = -1; ky <= 1; ky++) { for (let kx = -1; kx <= 1; kx++) { sum += d[((y + ky) * w + (x + kx)) * 4 + c] * weights[(ky + 1) * 3 + (kx + 1)]; } } od[(y * w + x) * 4 + c] = Math.min(255, Math.max(0, sum)); } od[(y * w + x) * 4 + 3] = 255; } }
    const res = document.createElement('canvas'); res.width = w; res.height = h; res.getContext('2d').putImageData(output, 0, 0); return res;
}

// Pipelines
async function runLastResortOCR(cropCanvas) {
    setOCRStatus('processing', '⚡ Isolating Textbox...');
    const textbox = lr_isolateTextbox(cropCanvas);
    const padded = lr_addPadding(textbox, 1);
    setOCRStatus('processing', '⚡ Reconstructing Strokes...');
    const base = lr_reconstructStrokes(lr_upscale(padded, 2));

    const passes = [];
    const run = async (c, lbl) => { setOCRStatus('processing', lbl); const r = await runTesseract(c); r.canvas = c; passes.push(r); };

    await run(base, '⚡ Last Resort (1/7)...');
    await run(lr_upscale(base, 2), '⚡ Last Resort (2/7)...');
    await run(applyPreprocessing(base, 'grayscale'), '⚡ Last Resort (3/7)...');
    await run(applyPreprocessing(lr_upscale(lr_isolateTextbox(cropCanvas), 2), 'adaptive'), '⚡ Last Resort (4/7)...');
    await run(applyPreprocessing(base, 'adaptive'), '⚡ Last Resort (5/7)...');
    await run(applyPreprocessing(base, 'binarize'), '⚡ Last Resort (6/7)...');
    await run(applyPreprocessing(lr_upscale(base, 2), 'adaptive'), '⚡ Last Resort (7/7)...');

    const result = fuseOCRResults(passes);
    result.canvas = base;
    return result;
}

async function runMultiPassOCR(crop) {
    const passes = [];
    const run = async (c, lbl) => { setOCRStatus('processing', lbl); const r = await runTesseract(c); r.canvas = c; passes.push(r); };
    await run(crop, '🔥 Multi-Pass (1/5)...');
    await run(lr_upscale(crop, 2), '🔥 Multi-Pass (2/5)...');
    await run(applyPreprocessing(lr_upscale(crop, 2), 'grayscale'), '🔥 Multi-Pass (3/5)...');
    await run(applyPreprocessing(lr_upscale(crop, 2), 'binarize'), '🔥 Multi-Pass (4/5)...');
    await run(applyPreprocessing(lr_upscale(crop, 2), 'adaptive'), '🔥 Multi-Pass (5/5)...');
    const result = fuseOCRResults(passes);
    return result;
}

function fuseOCRResults(results) {
    const jaRegex = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/g;
    const scored = results.map(r => {
        const text = (r.text || "").replace(/\s+/g, '').trim();
        if (!text) return { text: "", score: -1, canvas: r.canvas };
        const jaMatches = text.match(jaRegex) || [];
        const jaDensity = jaMatches.length / text.length;
        const score = (r.confidence || 0) * (jaDensity + 0.1) * (jaDensity > 0.3 ? 2 : 0.5);
        return { text, score, canvas: r.canvas };
    }).filter(r => r.score > 0);
    if (scored.length === 0) return { text: "", canvas: results[0].canvas };
    scored.sort((a, b) => b.score - a.score);
    return scored[0];
}

async function runTesseract(canvas) {
    if (!isOcrReady || !ocrWorker) return { text: "", confidence: 0 };
    try { const { data: { text, confidence } } = await ocrWorker.recognize(canvas); return { text: text || "", confidence: confidence || 0 }; }
    catch (e) { return { text: "", confidence: 0 }; }
}

function addOCRResultToUI(text) {
    const clean = text.replace(/\s+/g, '').trim(); if (!clean) return;
    if (latestText) latestText.textContent = clean;

    const item = document.createElement('p');
    item.className = 'history-item';
    item.setAttribute('lang', 'ja');

    const span = document.createElement('span');
    span.textContent = clean;
    item.appendChild(span);

    const btnRow = document.createElement('div');
    btnRow.className = 'item-btns';

    const speakBtn = document.createElement('button');
    speakBtn.setAttribute('data-action', 'speak');
    speakBtn.textContent = '🔊';
    speakBtn.ariaLabel = "Speak line";

    const copyBtn = document.createElement('button');
    copyBtn.setAttribute('data-action', 'copy');
    copyBtn.textContent = '📋';
    copyBtn.ariaLabel = "Copy line";

    btnRow.append(speakBtn, copyBtn);
    item.appendChild(btnRow);

    if (historyContent) {
        historyContent.prepend(item);
        while (historyContent.children.length > 100) historyContent.removeChild(historyContent.lastChild);

        const items = Array.from(historyContent.querySelectorAll('span')).map(s => s.textContent);
        localStorage.setItem('vn-ocr-public-history-v2', JSON.stringify(items));
    }
    navigator.clipboard.writeText(clean).catch(() => { });
}

if (clearHistoryBtn) {
    clearHistoryBtn.onclick = () => {
        if (historyContent) historyContent.innerHTML = '';
        if (latestText) latestText.textContent = 'Waiting for capture...';
        localStorage.removeItem('vn-ocr-public-history-v2');
        localStorage.removeItem('vn-ocr-public-history');
    };
}

refreshOcrBtn.onclick = () => { if (selectionRect) captureFrame(selectionRect); };

function initHelpModal() {
    const helpBtn = document.getElementById('help-btn'), helpModal = document.getElementById('help-modal'), helpClose = document.getElementById('help-close');
    if (!helpBtn || !helpModal) return;
    helpBtn.onclick = (e) => { e.stopPropagation(); helpModal.classList.add('active'); };
    if (helpClose) helpClose.onclick = () => helpModal.classList.remove('active');
    window.onclick = (e) => { if (e.target === helpModal) helpModal.classList.remove('active'); };
    window.onkeydown = (e) => { if (e.key === 'Escape') helpModal.classList.remove('active'); };
}
document.addEventListener('DOMContentLoaded', () => {
    initHelpModal();

    const autoState = settings.get('auto-capture', true);
    if (autoToggle) {
        autoToggle.checked = autoState;
        autoToggle.onchange();
    }

    const storedTheme = settings.get('theme', null);
    const systemTheme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    updateThemeUI(storedTheme || systemTheme);

    if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) {
        const installBtn = document.getElementById('install-btn');
        if (installBtn) installBtn.style.display = 'none';
    }

    if (refreshOcrBtn) refreshOcrBtn.ariaLabel = "Manual Re-Capture";
    if (autoToggle?.parentElement) autoToggle.parentElement.ariaLabel = "Toggle Automation";

    if (historyContent) {
        const savedV2 = localStorage.getItem('vn-ocr-public-history-v2');
        if (savedV2) {
            const lines = JSON.parse(savedV2);
            lines.reverse().forEach(line => addOCRResultToUI(line));
        } else {
            const legacy = localStorage.getItem('vn-ocr-public-history');
            if (legacy) {
                historyContent.innerHTML = legacy;
                const items = Array.from(historyContent.querySelectorAll('span')).map(s => s.textContent);
                localStorage.setItem('vn-ocr-public-history-v2', JSON.stringify(items));
                localStorage.removeItem('vn-ocr-public-history');
            }
        }

        if (historyContent.firstChild && latestText) {
            const entry = historyContent.firstElementChild;
            const span = entry?.querySelector('span');
            if (span) latestText.textContent = span.textContent;
        }
    }
});

/* ========================================== */
/* PHASE 6 — HAMBURGER MENU MIRROR (APPEND)   */
/* ========================================== */

(function () {
    const menuBtn = document.getElementById('menu-btn');
    const sideMenu = document.getElementById('side-menu');
    const menuBackdrop = document.getElementById('menu-backdrop');
    const menuTheme = document.getElementById('menu-theme');
    const menuAuto = document.getElementById('menu-auto');
    const menuInstall = document.getElementById('menu-install');
    const menuHistory = document.getElementById('menu-history');
    const menuGuide = document.getElementById('menu-guide');

    const openMenu = () => {
        if (sideMenu) sideMenu.classList.add('open');
        if (menuBackdrop) menuBackdrop.classList.add('open');
    };

    const closeMenu = () => {
        if (sideMenu) sideMenu.classList.remove('open');
        if (menuBackdrop) menuBackdrop.classList.remove('open');
    };

    if (menuBtn) menuBtn.onclick = openMenu;
    if (menuBackdrop) menuBackdrop.onclick = (e) => { e.stopPropagation(); closeMenu(); };

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeMenu();
    });

    // Mirror actions: trigger existing controls via .click()
    if (menuTheme) menuTheme.onclick = () => {
        const tt = document.getElementById('theme-toggle');
        if (tt) tt.click();
        closeMenu();
    };
    if (menuAuto) menuAuto.onclick = () => {
        const at = document.getElementById('auto-capture-toggle');
        if (at) at.click();
        closeMenu();
    };
    if (menuInstall) menuInstall.onclick = () => {
        const it = document.getElementById('install-btn');
        if (it) it.click();
        closeMenu();
    };
    if (menuGuide) menuGuide.onclick = () => {
        const hb = document.getElementById('help-btn');
        if (hb) hb.click();
        closeMenu();
    };
    if (menuHistory) menuHistory.onclick = () => {
        const root = document.querySelector('.dashboard-root');
        if (root) root.classList.toggle('history-hidden');
        closeMenu();
    };
})();
