'use strict';

// Dedicated static worker. Photos enter only through postMessage and leave the
// same way. The only fetch sites below accept immutable manifest entries.
// Use worker.terminate() to cancel work, including an in-flight GPU inference.
importScripts('./assets/manifest.js', './assets/ort.webgpu.min.js');

const ASSETS = self.LUMEN_SR_ASSETS;
const TILE = ASSETS.tileSize;
const SCALE = ASSETS.scale;
const BASE = new URL('./', self.location.href);
const ALLOWED = new Set([
  ASSETS.model.path,
  ASSETS.runtimeMjs.path,
  ...ASSETS.wasm.parts.map(part => part.path),
]);
let session = null;
let backend = null;
let busy = false;
let sequence = 0;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function assetUrl(path) {
  if (!ALLOWED.has(path)) throw new Error('Unrecognized runtime asset');
  const url = new URL(path, BASE);
  if (url.origin !== self.location.origin || url.search || url.hash) {
    throw new Error('Runtime assets must use fixed, same-origin URLs');
  }
  return url.href;
}

async function sha256(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, n => n.toString(16).padStart(2, '0')).join('');
}

async function readAsset(entry) {
  const response = await fetch(assetUrl(entry.path), {
    method: 'GET', credentials: 'omit', mode: 'same-origin',
    cache: 'force-cache', redirect: 'error', referrerPolicy: 'no-referrer',
  });
  if (!response.ok) throw new Error(`Runtime asset unavailable (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== entry.bytes || await sha256(bytes) !== entry.sha256) {
    throw new Error(`Runtime asset failed integrity verification: ${entry.path}`);
  }
  return bytes;
}

async function readWasm() {
  const bytes = new Uint8Array(ASSETS.wasm.bytes);
  let offset = 0;
  // Sequential fetching caps temporary CPU memory; total body size is fixed.
  for (let i = 0; i < ASSETS.wasm.parts.length; i++) {
    const part = await readAsset(ASSETS.wasm.parts[i]);
    bytes.set(part, offset);
    offset += part.byteLength;
    postMessage({type: 'loading', asset: 'runtime', done: i + 1, total: ASSETS.wasm.parts.length});
  }
  if (offset !== bytes.byteLength || await sha256(bytes) !== ASSETS.wasm.sha256) {
    throw new Error('Assembled runtime failed integrity verification');
  }
  return bytes;
}

async function init(message) {
  if (session) throw new Error('Worker is already initialized; use a new worker to change backend');
  if (message.tileSize !== TILE) throw new Error(`This model requires tileSize ${TILE}`);
  if (message.provider !== 'webgpu' && message.provider !== 'wasm') {
    throw new Error('Explicit webgpu or wasm provider is required');
  }
  backend = message.provider;
  if (!crypto.subtle) throw new Error('A secure context (HTTPS or localhost) is required');
  if (backend === 'webgpu' && !navigator.gpu) {
    throw new Error('WebGPU is unavailable in this browser or context');
  }
  const start = performance.now();
  const wasmBytes = await readWasm();
  const modelBytes = await readAsset(ASSETS.model);
  const downloadMs = performance.now() - start;

  ort.env.logLevel = 'warning';
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmBinary = wasmBytes;
  // 1.31.1's webgpu bundle requires asyncify (the all bundle uses jsep).
  ort.env.wasm.wasmPaths = {mjs: assetUrl(ASSETS.runtimeMjs.path)};
  const options = {executionProviders: [backend], graphOptimizationLevel: 'all'};
  if (backend === 'webgpu') {
    // Failure must be visible. Do not execute an unreported CPU replacement.
    options.extra = {session: {disable_cpu_ep_fallback: '1'}};
  }
  const createStart = performance.now();
  session = await ort.InferenceSession.create(modelBytes, options);
  postMessage({
    type: 'ready', backend, tileSize: TILE, scale: SCALE,
    loadMs: performance.now() - start, downloadMs,
    sessionMs: performance.now() - createStart,
    modelSha256: ASSETS.model.sha256,
    checkpointSha256: ASSETS.checkpointSha256,
    wasmSha256: ASSETS.wasm.sha256,
    ortVersion: ASSETS.ortVersion,
    modelBytes: ASSETS.model.bytes, wasmBytes: ASSETS.wasm.bytes,
  });
}

async function infer(message) {
  if (!session) throw new Error('Worker has not been initialized');
  if (message.w !== TILE || message.h !== TILE || !(message.rgba instanceof ArrayBuffer)
      || message.rgba.byteLength !== TILE*TILE*4) {
    throw new Error(`Input must be an exact ${TILE} × ${TILE} RGBA ArrayBuffer`);
  }
  if (typeof message.id !== 'string' && typeof message.id !== 'number') {
    throw new Error('A tile id is required');
  }
  const start = performance.now();
  const pixels = new Uint8Array(message.rgba);
  const plane = TILE*TILE;
  const data = new Float32Array(plane*3);
  for (let i = 0; i < plane; i++) {
    // Transparent photo data has no unique RGB interpretation. Callers must
    // composite first rather than silently manufacture an alpha edge.
    if (pixels[i*4+3] !== 255) throw new Error('Composite transparent input before super resolution');
    data[i] = pixels[i*4]/255;
    data[plane+i] = pixels[i*4+1]/255;
    data[plane*2+i] = pixels[i*4+2]/255;
  }
  const preprocessMs = performance.now() - start;
  const input = new ort.Tensor('float32', data, [1,3,TILE,TILE]);
  let output;
  try {
    const inferStart = performance.now();
    const results = await session.run({input});
    output = results.output;
    if (!output || output.dims.join(',') !== `1,3,${TILE*SCALE},${TILE*SCALE}`) {
      throw new Error('Unexpected model output dimensions');
    }
    const values = output.data;
    const inferenceMs = performance.now() - inferStart;
    const encodeStart = performance.now();
    const outPlane = plane*SCALE*SCALE;
    const rgba = new Uint8ClampedArray(outPlane*4);
    for (let i = 0; i < outPlane; i++) {
      const r=values[i], g=values[outPlane+i], b=values[outPlane*2+i];
      if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
        throw new Error('Model returned non-finite pixels; no output was accepted');
      }
      rgba[i*4] = Math.round(r*255);
      rgba[i*4+1] = Math.round(g*255);
      rgba[i*4+2] = Math.round(b*255);
      rgba[i*4+3] = 255;
    }
    sequence++;
    postMessage({
      type: 'result', id: message.id, rgba: rgba.buffer,
      w: TILE*SCALE, h: TILE*SCALE, ms: performance.now()-start,
      inferenceMs, preprocessMs, encodeMs: performance.now()-encodeStart,
      backend, sequence, firstInference: sequence === 1,
      modelSha256: ASSETS.model.sha256,
    }, [rgba.buffer]);
  } finally {
    input.dispose();
    if (output) output.dispose();
  }
}

onmessage = async ({data: message}) => {
  if (busy) {
    postMessage({type: 'error', stage: 'protocol', id: message?.id, backend,
      message: 'Only one operation may run at a time'});
    return;
  }
  busy = true;
  try {
    if (message?.type === 'init') await init(message);
    else if (message?.type === 'infer') await infer(message);
    else throw new Error('Unknown worker message');
  } catch (error) {
    postMessage({type: 'error', stage: message?.type ?? 'protocol', id: message?.id,
      backend, message: errorMessage(error), modelSha256: ASSETS.model.sha256});
  } finally {
    busy = false;
  }
};
