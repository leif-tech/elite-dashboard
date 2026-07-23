const crypto = require('crypto');

// ============ GPU PROFILES WITH TIER + CORRELATED HARDWARE ============
// tier: 'integrated' | 'mid' | 'high' — constrains CPU/RAM selection
const GPU_PROFILES = [
  {
    tier: 'integrated',
    vendor: 'Google Inc. (Intel)',
    renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    params: { MAX_TEXTURE_SIZE: 16384, MAX_VIEWPORT_DIMS: [16384, 16384], MAX_RENDERBUFFER_SIZE: 16384, MAX_CUBE_MAP_TEXTURE_SIZE: 16384, MAX_VERTEX_ATTRIBS: 16, MAX_VERTEX_UNIFORM_VECTORS: 4096, MAX_FRAGMENT_UNIFORM_VECTORS: 1024, MAX_VARYING_VECTORS: 30, ALIASED_LINE_WIDTH_RANGE: [1, 1], ALIASED_POINT_SIZE_RANGE: [1, 1024] },
    screens: [0, 2, 3, 4], // 1080p, 768p, 864p, 900p — no 1440p/ultrawide for iGPU
  },
  {
    tier: 'integrated',
    vendor: 'Google Inc. (Intel)',
    renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    params: { MAX_TEXTURE_SIZE: 16384, MAX_VIEWPORT_DIMS: [16384, 16384], MAX_RENDERBUFFER_SIZE: 16384, MAX_CUBE_MAP_TEXTURE_SIZE: 16384, MAX_VERTEX_ATTRIBS: 16, MAX_VERTEX_UNIFORM_VECTORS: 4096, MAX_FRAGMENT_UNIFORM_VECTORS: 1024, MAX_VARYING_VECTORS: 30, ALIASED_LINE_WIDTH_RANGE: [1, 1], ALIASED_POINT_SIZE_RANGE: [1, 1024] },
    screens: [0, 2, 3, 4, 5], // up to 1680x1050
  },
  {
    tier: 'integrated',
    vendor: 'Google Inc. (Intel)',
    renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
    params: { MAX_TEXTURE_SIZE: 16384, MAX_VIEWPORT_DIMS: [16384, 16384], MAX_RENDERBUFFER_SIZE: 16384, MAX_CUBE_MAP_TEXTURE_SIZE: 16384, MAX_VERTEX_ATTRIBS: 16, MAX_VERTEX_UNIFORM_VECTORS: 4096, MAX_FRAGMENT_UNIFORM_VECTORS: 1024, MAX_VARYING_VECTORS: 30, ALIASED_LINE_WIDTH_RANGE: [1, 1], ALIASED_POINT_SIZE_RANGE: [1, 1024] },
    screens: [0, 2, 3, 4],
  },
  {
    tier: 'mid',
    vendor: 'Google Inc. (NVIDIA)',
    renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)',
    params: { MAX_TEXTURE_SIZE: 32768, MAX_VIEWPORT_DIMS: [32768, 32768], MAX_RENDERBUFFER_SIZE: 32768, MAX_CUBE_MAP_TEXTURE_SIZE: 32768, MAX_VERTEX_ATTRIBS: 16, MAX_VERTEX_UNIFORM_VECTORS: 4096, MAX_FRAGMENT_UNIFORM_VECTORS: 4096, MAX_VARYING_VECTORS: 31, ALIASED_LINE_WIDTH_RANGE: [1, 1], ALIASED_POINT_SIZE_RANGE: [1, 2048] },
    screens: [0, 1, 5, 6], // 1080p to 1200p, can handle 1440p
  },
  {
    tier: 'mid',
    vendor: 'Google Inc. (AMD)',
    renderer: 'ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    params: { MAX_TEXTURE_SIZE: 16384, MAX_VIEWPORT_DIMS: [16384, 16384], MAX_RENDERBUFFER_SIZE: 16384, MAX_CUBE_MAP_TEXTURE_SIZE: 16384, MAX_VERTEX_ATTRIBS: 16, MAX_VERTEX_UNIFORM_VECTORS: 4096, MAX_FRAGMENT_UNIFORM_VECTORS: 4096, MAX_VARYING_VECTORS: 32, ALIASED_LINE_WIDTH_RANGE: [1, 1], ALIASED_POINT_SIZE_RANGE: [1, 8192] },
    screens: [0, 2, 3, 4, 5],
  },
  {
    tier: 'high',
    vendor: 'Google Inc. (NVIDIA)',
    renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    params: { MAX_TEXTURE_SIZE: 32768, MAX_VIEWPORT_DIMS: [32768, 32768], MAX_RENDERBUFFER_SIZE: 32768, MAX_CUBE_MAP_TEXTURE_SIZE: 32768, MAX_VERTEX_ATTRIBS: 16, MAX_VERTEX_UNIFORM_VECTORS: 4096, MAX_FRAGMENT_UNIFORM_VECTORS: 4096, MAX_VARYING_VECTORS: 31, ALIASED_LINE_WIDTH_RANGE: [1, 1], ALIASED_POINT_SIZE_RANGE: [1, 2048] },
    screens: [0, 1, 5, 6, 7], // all resolutions including ultrawide
  },
  {
    tier: 'high',
    vendor: 'Google Inc. (NVIDIA)',
    renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    params: { MAX_TEXTURE_SIZE: 32768, MAX_VIEWPORT_DIMS: [32768, 32768], MAX_RENDERBUFFER_SIZE: 32768, MAX_CUBE_MAP_TEXTURE_SIZE: 32768, MAX_VERTEX_ATTRIBS: 16, MAX_VERTEX_UNIFORM_VECTORS: 4096, MAX_FRAGMENT_UNIFORM_VECTORS: 4096, MAX_VARYING_VECTORS: 31, ALIASED_LINE_WIDTH_RANGE: [1, 1], ALIASED_POINT_SIZE_RANGE: [1, 2048] },
    screens: [0, 1, 5, 6, 7],
  },
  {
    tier: 'high',
    vendor: 'Google Inc. (AMD)',
    renderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
    params: { MAX_TEXTURE_SIZE: 16384, MAX_VIEWPORT_DIMS: [16384, 16384], MAX_RENDERBUFFER_SIZE: 16384, MAX_CUBE_MAP_TEXTURE_SIZE: 16384, MAX_VERTEX_ATTRIBS: 16, MAX_VERTEX_UNIFORM_VECTORS: 4096, MAX_FRAGMENT_UNIFORM_VECTORS: 4096, MAX_VARYING_VECTORS: 32, ALIASED_LINE_WIDTH_RANGE: [1, 1], ALIASED_POINT_SIZE_RANGE: [1, 8192] },
    screens: [0, 1, 5, 6, 7],
  },
];

// Hardware ranges per GPU tier — correlated so combos are plausible
const HW_BY_TIER = {
  integrated: { cores: [4, 6, 8], memory: [4, 8] },
  mid:        { cores: [4, 6, 8, 12], memory: [8, 16] },
  high:       { cores: [8, 12, 16], memory: [8, 16, 32] },
};

const SCREEN_PROFILES = [
  /* 0 */ { width: 1920, height: 1080, availHeight: 1040, colorDepth: 24, devicePixelRatio: 1 },
  /* 1 */ { width: 2560, height: 1440, availHeight: 1400, colorDepth: 24, devicePixelRatio: 1 },
  /* 2 */ { width: 1366, height: 768, availHeight: 728, colorDepth: 24, devicePixelRatio: 1 },
  /* 3 */ { width: 1536, height: 864, availHeight: 824, colorDepth: 24, devicePixelRatio: 1.25 },
  /* 4 */ { width: 1440, height: 900, availHeight: 860, colorDepth: 24, devicePixelRatio: 1 },
  /* 5 */ { width: 1680, height: 1050, availHeight: 1010, colorDepth: 24, devicePixelRatio: 1 },
  /* 6 */ { width: 1920, height: 1200, availHeight: 1160, colorDepth: 24, devicePixelRatio: 1 },
  /* 7 */ { width: 2560, height: 1080, availHeight: 1040, colorDepth: 24, devicePixelRatio: 1 },
];

// Chrome versions with CORRECT per-version GREASE brand strings.
// Computed from Chromium source: chars = [" ","(",":","−",".","/",,";","=","?","_"]
// Brand = "Not" + chars[major%11] + "A" + chars[(major+1)%11] + "Brand"
// Version = ["8","99","24"][major%3]
// Using wrong GREASE for a given major version is a trivial detection signal.
// Updated July 2026 — versions 148-151 (current stable window).
const CHROME_VERSIONS = [
  { major: 148, full: '148.0.7778.217', grease: 'Not/A)Brand', greaseVer: '99' },
  { major: 149, full: '149.0.7815.120', grease: 'Not)A;Brand', greaseVer: '24' },
  { major: 150, full: '150.0.7871.182', grease: 'Not;A=Brand', greaseVer: '8' },
  { major: 151, full: '151.0.7922.48',  grease: 'Not=A?Brand', greaseVer: '99' },
];

const LANGUAGE_SETS = [
  ['en-US', 'en'],
  ['en-US'],
  ['en-US', 'en', 'es'],
  ['en-US', 'en-GB', 'en'],
];

const TIMEZONE_SETS = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
];

// Network connection profiles — plausible combos for residential users
const CONNECTION_PROFILES = [
  { effectiveType: '4g', downlink: 10,   rtt: 50 },
  { effectiveType: '4g', downlink: 5.6,  rtt: 100 },
  { effectiveType: '4g', downlink: 8.3,  rtt: 75 },
  { effectiveType: '4g', downlink: 2.8,  rtt: 150 },
  { effectiveType: '4g', downlink: 15,   rtt: 50 },
];

// ============ DETERMINISTIC SEED ============
function seedFromAccountId(accountId) {
  const hash = crypto.createHash('sha256').update(`fp-seed-v3-${accountId}`).digest();
  const seeds = [];
  // 8 seeds from first hash (32 bytes / 4 bytes each)
  for (let i = 0; i < 8; i++) {
    seeds.push(hash.readUInt32BE(i * 4));
  }
  // 4 more seeds from a second hash to avoid correlation
  const hash2 = crypto.createHash('sha256').update(`fp-seed-v3-ext-${accountId}`).digest();
  for (let i = 0; i < 4; i++) {
    seeds.push(hash2.readUInt32BE(i * 4));
  }
  return seeds;
}

function pickFromTable(table, seed) {
  return table[seed % table.length];
}

// ============ GENERATION ============
function generateFingerprint(accountId) {
  const seeds = seedFromAccountId(accountId);

  const chromeVer = pickFromTable(CHROME_VERSIONS, seeds[0]);
  const gpu = pickFromTable(GPU_PROFILES, seeds[1]);

  // Screen is correlated with GPU — pick from GPU's allowed screens
  const screenIdx = gpu.screens[seeds[2] % gpu.screens.length];
  const screenProfile = SCREEN_PROFILES[screenIdx];

  // Hardware is correlated with GPU tier
  const hwOptions = HW_BY_TIER[gpu.tier];
  const hwConcurrency = pickFromTable(hwOptions.cores, seeds[3]);
  const devMemory = pickFromTable(hwOptions.memory, seeds[4]);

  const langs = pickFromTable(LANGUAGE_SETS, seeds[5]);
  const timezone = pickFromTable(TIMEZONE_SETS, seeds[8]); // separate seed to avoid correlation
  const connection = pickFromTable(CONNECTION_PROFILES, seeds[9]); // separate seed from canvas

  // Build User-Agent
  const userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer.full} Safari/537.36`;

  // Build Client Hints with correct per-version GREASE brand
  const brands = [
    { brand: chromeVer.grease, version: chromeVer.greaseVer },
    { brand: 'Chromium', version: String(chromeVer.major) },
    { brand: 'Google Chrome', version: String(chromeVer.major) },
  ];
  const clientHints = {
    'sec-ch-ua': `"${chromeVer.grease}";v="${chromeVer.greaseVer}", "Chromium";v="${chromeVer.major}", "Google Chrome";v="${chromeVer.major}"`,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
  };

  // NavigatorUAData for getHighEntropyValues
  const uaData = {
    brands,
    mobile: false,
    platform: 'Windows',
    platformVersion: '15.0.0',
    architecture: 'x86',
    bitness: '64',
    model: '',
    uaFullVersion: chromeVer.full,
    fullVersionList: [
      { brand: chromeVer.grease, version: chromeVer.greaseVer + '.0.0.0' },
      { brand: 'Chromium', version: chromeVer.full },
      { brand: 'Google Chrome', version: chromeVer.full },
    ],
  };

  // Canvas & Audio noise seeds (deterministic from account, each using separate seed)
  const canvasNoiseSeed = seeds[6];
  const audioNoiseSeed = seeds[7];

  // Font seed — separate from audio to avoid correlation
  const fontSeed = seeds[10] & 0xFFFF;

  return {
    version: 3,
    userAgent,
    clientHints,
    uaData,
    platform: 'Win32',
    vendor: 'Google Inc.',
    productSub: '20030107',
    hardwareConcurrency: hwConcurrency,
    deviceMemory: devMemory,
    languages: langs,
    maxTouchPoints: 0,
    screen: screenProfile,
    webgl: { vendor: gpu.vendor, renderer: gpu.renderer, params: gpu.params },
    canvasNoiseSeed,
    audioNoiseSeed,
    timezone,
    connection,
    fontSeed,
  };
}

module.exports = { generateFingerprint };
