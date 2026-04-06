// VN OCR Public — MangaOCR Web Worker
// Uses Transformers.js WASM — runs entirely in the browser, no backend needed

// Import transformers.js using importScripts (compatible with all browsers)
importScripts('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js');

const { pipeline, env } = self.Transformers;

// Force remote models (no local path)
env.allowLocalModels = false;
// Allow remote WASM loading
env.backends.onnx.wasm.numThreads = 1;

let ocrPipeline = null;

async function loadModel() {
    try {
        self.postMessage({ type: 'progress', percent: 0, status: 'Starting download...' });

        ocrPipeline = await pipeline('image-to-text', 'Xenova/manga-ocr-base', {
            progress_callback: (data) => {
                // Log everything so we can debug
                console.log('[Worker] progress:', JSON.stringify(data));

                if (data.status === 'progress') {
                    const pct = typeof data.progress === 'number' ? Math.round(data.progress) : 0;
                    self.postMessage({ type: 'progress', percent: pct, status: data.file || 'Downloading...' });
                } else if (data.status === 'initiate') {
                    self.postMessage({ type: 'progress', percent: 0, status: `Starting: ${data.file || ''}` });
                } else if (data.status === 'done') {
                    self.postMessage({ type: 'progress', percent: 100, status: `Done: ${data.file || ''}` });
                } else if (data.status === 'ready') {
                    self.postMessage({ type: 'progress', percent: 100, status: 'Model ready!' });
                }
            }
        });

        self.postMessage({ type: 'ready' });
    } catch (err) {
        self.postMessage({ type: 'error', message: 'Failed to load model: ' + err.message });
    }
}

self.addEventListener('message', async (event) => {
    const { type, imageData } = event.data;

    if (type === 'load') {
        await loadModel();
        return;
    }

    if (type === 'ocr') {
        if (!ocrPipeline) {
            self.postMessage({ type: 'error', message: 'Model not loaded yet!' });
            return;
        }
        try {
            // imageData is a dataURL string — directly usable by transformers.js
            const result = await ocrPipeline(imageData);
            const text = result?.[0]?.generated_text ?? '';
            self.postMessage({ type: 'result', text });
        } catch (err) {
            self.postMessage({ type: 'error', message: 'OCR failed: ' + err.message });
        }
    }
});
