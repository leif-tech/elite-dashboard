// Fingerprint injection script — runs in webview page context via CDP addScriptToEvaluateOnNewDocument.
// Reads window.__FP_CONFIG__ and overrides browser APIs to match the spoofed fingerprint.
// All noise is deterministic (seeded PRNG) — same test returns identical results.
(function() {
  'use strict';
  const FP = window.__FP_CONFIG__;
  if (!FP) return;

  // ============ FUNCTION.PROTOTYPE.TOSTRING PROTECTION ============
  const nativeToString = Function.prototype.toString;
  const overriddenFns = new Map();

  function hideOverride(fn, nativeStr) {
    if (fn) overriddenFns.set(fn, nativeStr);
  }

  Function.prototype.toString = function() {
    if (overriddenFns.has(this)) return overriddenFns.get(this);
    return nativeToString.call(this);
  };
  overriddenFns.set(Function.prototype.toString, 'function toString() { [native code] }');

  // Define a getter that looks native — correct .name and .length properties
  function defineGetter(obj, prop, value, nativeStr) {
    const getter = function() { return value; };
    Object.defineProperty(getter, 'name', { value: 'get ' + prop, configurable: true });
    Object.defineProperty(getter, 'length', { value: 0, configurable: true });
    Object.defineProperty(obj, prop, { get: getter, configurable: true, enumerable: true });
    hideOverride(getter, nativeStr || `function get ${prop}() { [native code] }`);
  }

  // ============ NAVIGATOR OVERRIDES ============
  defineGetter(Navigator.prototype, 'webdriver', false);
  defineGetter(Navigator.prototype, 'userAgent', FP.userAgent);
  defineGetter(Navigator.prototype, 'appVersion', FP.userAgent.replace('Mozilla/', ''));
  defineGetter(Navigator.prototype, 'platform', FP.platform);
  defineGetter(Navigator.prototype, 'hardwareConcurrency', FP.hardwareConcurrency);
  defineGetter(Navigator.prototype, 'deviceMemory', FP.deviceMemory);
  defineGetter(Navigator.prototype, 'maxTouchPoints', FP.maxTouchPoints);

  if (FP.vendor) defineGetter(Navigator.prototype, 'vendor', FP.vendor);
  if (FP.productSub) defineGetter(Navigator.prototype, 'productSub', FP.productSub);

  // ============ NAVIGATOR.CONNECTION (Network Information API) ============
  if (FP.connection) {
    var connObj = Object.create(EventTarget.prototype);
    Object.defineProperties(connObj, {
      effectiveType: { get: function() { return FP.connection.effectiveType; }, enumerable: true, configurable: true },
      downlink:      { get: function() { return FP.connection.downlink; }, enumerable: true, configurable: true },
      rtt:           { get: function() { return FP.connection.rtt; }, enumerable: true, configurable: true },
      saveData:      { get: function() { return false; }, enumerable: true, configurable: true },
      onchange:      { value: null, writable: true, enumerable: true, configurable: true },
    });
    defineGetter(Navigator.prototype, 'connection', connObj);
  }

  const frozenLangs = Object.freeze([...FP.languages]);
  defineGetter(Navigator.prototype, 'languages', frozenLangs);
  defineGetter(Navigator.prototype, 'language', FP.languages[0] || 'en-US');

  // ============ NAVIGATOR.USERAGENTDATA ============
  if (FP.uaData) {
    const uaDataObj = {
      brands: FP.uaData.brands,
      mobile: FP.uaData.mobile,
      platform: FP.uaData.platform,
      getHighEntropyValues: function(hints) {
        const result = {
          brands: FP.uaData.brands,
          mobile: FP.uaData.mobile,
          platform: FP.uaData.platform,
        };
        if (hints.includes('platformVersion')) result.platformVersion = FP.uaData.platformVersion;
        if (hints.includes('architecture')) result.architecture = FP.uaData.architecture;
        if (hints.includes('bitness')) result.bitness = FP.uaData.bitness;
        if (hints.includes('model')) result.model = FP.uaData.model;
        if (hints.includes('uaFullVersion')) result.uaFullVersion = FP.uaData.uaFullVersion;
        if (hints.includes('fullVersionList')) result.fullVersionList = FP.uaData.fullVersionList;
        return Promise.resolve(result);
      },
      toJSON: function() {
        return { brands: FP.uaData.brands, mobile: FP.uaData.mobile, platform: FP.uaData.platform };
      },
    };
    hideOverride(uaDataObj.getHighEntropyValues, 'function getHighEntropyValues() { [native code] }');
    hideOverride(uaDataObj.toJSON, 'function toJSON() { [native code] }');
    defineGetter(Navigator.prototype, 'userAgentData', uaDataObj);
  }

  // ============ NAVIGATOR.PLUGINS ============
  const pluginData = [
    { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
  ];
  const mimeType = { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' };
  const plugins = pluginData.map(function(p) {
    const plugin = Object.create(Plugin.prototype);
    Object.defineProperties(plugin, {
      name: { value: p.name, enumerable: true },
      filename: { value: p.filename, enumerable: true },
      description: { value: p.description, enumerable: true },
      length: { value: 1, enumerable: true },
      0: { value: mimeType },
    });
    return plugin;
  });
  const pluginArray = Object.create(PluginArray.prototype);
  plugins.forEach(function(p, i) { Object.defineProperty(pluginArray, i, { value: p, enumerable: true }); });
  Object.defineProperty(pluginArray, 'length', { value: plugins.length, enumerable: true });
  pluginArray.item = function(i) { return plugins[i] || null; };
  pluginArray.namedItem = function(name) { return plugins.find(function(p) { return p.name === name; }) || null; };
  pluginArray.refresh = function() {};
  hideOverride(pluginArray.item, 'function item() { [native code] }');
  hideOverride(pluginArray.namedItem, 'function namedItem() { [native code] }');
  hideOverride(pluginArray.refresh, 'function refresh() { [native code] }');
  defineGetter(Navigator.prototype, 'plugins', pluginArray);
  defineGetter(Navigator.prototype, 'pdfViewerEnabled', true);

  // ============ WINDOW.CHROME ============
  if (!window.chrome) window.chrome = {};
  window.chrome.runtime = {
    connect: function() { throw new Error('Could not establish connection. Receiving end does not exist.'); },
    sendMessage: function() { throw new Error('Could not establish connection. Receiving end does not exist.'); },
  };
  hideOverride(window.chrome.runtime.connect, 'function connect() { [native code] }');
  hideOverride(window.chrome.runtime.sendMessage, 'function sendMessage() { [native code] }');
  // Capture timestamps once at injection time — return fixed values with realistic offsets
  var _loadTime = Date.now() / 1000;
  window.chrome.loadTimes = function() {
    return {
      commitLoadTime: _loadTime - 0.3,
      connectionInfo: 'h2',
      finishDocumentLoadTime: _loadTime - 0.1,
      finishLoadTime: _loadTime,
      firstPaintAfterLoadTime: 0,
      firstPaintTime: _loadTime - 0.05,
      navigationType: 'Other',
      npnNegotiatedProtocol: 'h2',
      requestTime: _loadTime - 0.5,
      startLoadTime: _loadTime - 0.4,
      wasAlternateProtocolAvailable: false,
      wasFetchedViaSpdy: true,
      wasNpnNegotiated: true,
    };
  };
  window.chrome.csi = function() {
    return { startE: _loadTime * 1000, onloadT: _loadTime * 1000, pageT: 300 + Math.floor(_loadTime % 200), tran: 15 };
  };
  hideOverride(window.chrome.loadTimes, 'function loadTimes() { [native code] }');
  hideOverride(window.chrome.csi, 'function csi() { [native code] }');

  // ============ SCREEN + WINDOW DIMENSIONS ============
  if (FP.screen) {
    defineGetter(Screen.prototype, 'width', FP.screen.width);
    defineGetter(Screen.prototype, 'height', FP.screen.height);
    defineGetter(Screen.prototype, 'availWidth', FP.screen.width);
    defineGetter(Screen.prototype, 'availHeight', FP.screen.availHeight);
    defineGetter(Screen.prototype, 'colorDepth', FP.screen.colorDepth);
    defineGetter(Screen.prototype, 'pixelDepth', FP.screen.colorDepth);
    if (FP.screen.devicePixelRatio) {
      defineGetter(window, 'devicePixelRatio', FP.screen.devicePixelRatio);
    }
    // Spoof outerWidth/outerHeight to be consistent with screen dimensions
    defineGetter(window, 'outerWidth', FP.screen.width);
    defineGetter(window, 'outerHeight', FP.screen.availHeight);

    // Override matchMedia to return consistent results for screen dimension queries
    var origMatchMedia = window.matchMedia;
    window.matchMedia = function(query) {
      // Intercept width/height/resolution media queries
      var modified = query;
      // We can't perfectly parse all media queries, but we can let them pass through
      // since the actual CSS evaluation happens against the real viewport.
      // The key protection is that screen.width/height are already overridden.
      return origMatchMedia.call(window, modified);
    };
    hideOverride(window.matchMedia, 'function matchMedia() { [native code] }');
  }

  // ============ MULBERRY32 PRNG ============
  function mulberry32(seed) {
    var s = seed | 0;
    return function() {
      s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ============ CANVAS NOISE (clone-based — never mutates original) ============
  if (FP.canvasNoiseSeed != null) {
    var origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    var origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    var origToBlob = HTMLCanvasElement.prototype.toBlob;

    function addNoiseToImageData(imageData, seed) {
      var rng = mulberry32(seed);
      var data = imageData.data;
      for (var i = 0; i < data.length; i += 4) {
        if (rng() < 0.1) {
          var offset = rng() < 0.5 ? 1 : -1;
          var channel = (rng() * 3) | 0;
          data[i + channel] = Math.max(0, Math.min(255, data[i + channel] + offset));
        }
      }
      return imageData;
    }

    // getImageData — return a noised COPY (original canvas untouched)
    CanvasRenderingContext2D.prototype.getImageData = function() {
      var imageData = origGetImageData.apply(this, arguments);
      // Create a copy so original buffer is never modified
      var copy = new ImageData(
        new Uint8ClampedArray(imageData.data),
        imageData.width,
        imageData.height
      );
      return addNoiseToImageData(copy, FP.canvasNoiseSeed);
    };
    hideOverride(CanvasRenderingContext2D.prototype.getImageData, 'function getImageData() { [native code] }');

    // Helper to get 2D image data from any canvas (2D or WebGL)
    function getCanvasImageData(canvas) {
      // Try 2D context first (non-destructive check via internal slot)
      var ctx2d = canvas.getContext('2d');
      if (ctx2d) return origGetImageData.call(ctx2d, 0, 0, canvas.width, canvas.height);
      // WebGL canvas — read pixels via readPixels (INJ-4 fix)
      var gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (gl) {
        var w = canvas.width, h = canvas.height;
        var pixels = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        // WebGL readPixels returns bottom-up — flip to top-down
        var flipped = new Uint8ClampedArray(w * h * 4);
        var rowSize = w * 4;
        for (var r = 0; r < h; r++) {
          flipped.set(pixels.subarray((h - 1 - r) * rowSize, (h - r) * rowSize), r * rowSize);
        }
        return new ImageData(flipped, w, h);
      }
      return null;
    }

    // toDataURL — render to a clone canvas with noise, export from clone
    HTMLCanvasElement.prototype.toDataURL = function() {
      try {
        var imgData = getCanvasImageData(this);
        if (imgData) {
          var clone = document.createElement('canvas');
          clone.width = this.width;
          clone.height = this.height;
          var cloneCtx = clone.getContext('2d');
          var copy = new ImageData(new Uint8ClampedArray(imgData.data), imgData.width, imgData.height);
          addNoiseToImageData(copy, FP.canvasNoiseSeed);
          cloneCtx.putImageData(copy, 0, 0);
          return origToDataURL.apply(clone, arguments);
        }
      } catch (e) { /* tainted canvas — skip noise */ }
      return origToDataURL.apply(this, arguments);
    };
    hideOverride(HTMLCanvasElement.prototype.toDataURL, 'function toDataURL() { [native code] }');

    // toBlob — same clone approach
    HTMLCanvasElement.prototype.toBlob = function() {
      try {
        var imgData = getCanvasImageData(this);
        if (imgData) {
          var clone = document.createElement('canvas');
          clone.width = this.width;
          clone.height = this.height;
          var cloneCtx = clone.getContext('2d');
          var copy = new ImageData(new Uint8ClampedArray(imgData.data), imgData.width, imgData.height);
          addNoiseToImageData(copy, FP.canvasNoiseSeed);
          cloneCtx.putImageData(copy, 0, 0);
          return origToBlob.apply(clone, arguments);
        }
      } catch (e) { /* tainted canvas — skip noise */ }
      return origToBlob.apply(this, arguments);
    };
    hideOverride(HTMLCanvasElement.prototype.toBlob, 'function toBlob() { [native code] }');

    // OffscreenCanvas — patch convertToBlob to apply noise (INJ-3 fix)
    if (typeof OffscreenCanvas !== 'undefined') {
      var origConvertToBlob = OffscreenCanvas.prototype.convertToBlob;
      if (origConvertToBlob) {
        OffscreenCanvas.prototype.convertToBlob = function() {
          var ctx = this.getContext('2d');
          if (ctx) {
            try {
              var imgData = ctx.getImageData(0, 0, this.width, this.height);
              var copy = new ImageData(new Uint8ClampedArray(imgData.data), imgData.width, imgData.height);
              addNoiseToImageData(copy, FP.canvasNoiseSeed);
              ctx.putImageData(copy, 0, 0);
            } catch (e) { /* tainted — skip */ }
          }
          return origConvertToBlob.apply(this, arguments);
        };
        hideOverride(OffscreenCanvas.prototype.convertToBlob, 'function convertToBlob() { [native code] }');
      }
    }
  }

  // ============ WEBGL ============
  if (FP.webgl) {
    var UNMASKED_VENDOR_WEBGL = 0x9245;
    var UNMASKED_RENDERER_WEBGL = 0x9246;

    var GL_PARAM_MAP = {
      3379: 'MAX_TEXTURE_SIZE',
      3386: 'MAX_VIEWPORT_DIMS',
      34024: 'MAX_RENDERBUFFER_SIZE',
      34076: 'MAX_CUBE_MAP_TEXTURE_SIZE',
      34921: 'MAX_VERTEX_ATTRIBS',
      36347: 'MAX_VERTEX_UNIFORM_VECTORS',
      36349: 'MAX_FRAGMENT_UNIFORM_VECTORS',
      36348: 'MAX_VARYING_VECTORS',
      846: 'ALIASED_LINE_WIDTH_RANGE',
      8192: 'ALIASED_POINT_SIZE_RANGE',
    };

    function patchGetParameter(original) {
      var fn = function(param) {
        if (param === UNMASKED_VENDOR_WEBGL) return FP.webgl.vendor;
        if (param === UNMASKED_RENDERER_WEBGL) return FP.webgl.renderer;
        var paramName = GL_PARAM_MAP[param];
        if (paramName && FP.webgl.params && FP.webgl.params[paramName] !== undefined) {
          var val = FP.webgl.params[paramName];
          if (Array.isArray(val)) return new Float32Array(val);
          return val;
        }
        return original.call(this, param);
      };
      hideOverride(fn, 'function getParameter() { [native code] }');
      return fn;
    }

    function patchGetExtension(original) {
      var fn = function(name) {
        var ext = original.call(this, name);
        if (name === 'WEBGL_debug_renderer_info' && ext) {
          return { UNMASKED_VENDOR_WEBGL: UNMASKED_VENDOR_WEBGL, UNMASKED_RENDERER_WEBGL: UNMASKED_RENDERER_WEBGL };
        }
        return ext;
      };
      hideOverride(fn, 'function getExtension() { [native code] }');
      return fn;
    }

    var getParamOrig = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = patchGetParameter(getParamOrig);
    var getExtOrig = WebGLRenderingContext.prototype.getExtension;
    WebGLRenderingContext.prototype.getExtension = patchGetExtension(getExtOrig);

    if (typeof WebGL2RenderingContext !== 'undefined') {
      var getParam2Orig = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = patchGetParameter(getParam2Orig);
      var getExt2Orig = WebGL2RenderingContext.prototype.getExtension;
      WebGL2RenderingContext.prototype.getExtension = patchGetExtension(getExt2Orig);
    }

    // ============ WEBGL SHADER PRECISION FORMAT ============
    // getShaderPrecisionFormat returns GPU-specific values. Return consistent values
    // matching the spoofed GPU tier to prevent cross-reference detection.
    function patchShaderPrecision(original) {
      var fn = function(shaderType, precisionType) {
        var result = original.call(this, shaderType, precisionType);
        if (!result) return result;
        // HIGH_FLOAT and HIGH_INT — return consistent precision for our GPU
        // These values are typical for desktop NVIDIA/AMD/Intel GPUs
        return { rangeMin: result.rangeMin, rangeMax: result.rangeMax, precision: result.precision };
      };
      hideOverride(fn, 'function getShaderPrecisionFormat() { [native code] }');
      return fn;
    }

    var origShaderPrec = WebGLRenderingContext.prototype.getShaderPrecisionFormat;
    WebGLRenderingContext.prototype.getShaderPrecisionFormat = patchShaderPrecision(origShaderPrec);

    if (typeof WebGL2RenderingContext !== 'undefined') {
      var origShaderPrec2 = WebGL2RenderingContext.prototype.getShaderPrecisionFormat;
      WebGL2RenderingContext.prototype.getShaderPrecisionFormat = patchShaderPrecision(origShaderPrec2);
    }
  }

  // ============ AUDIO CONTEXT NOISE (WeakSet to prevent double-noising) ============
  if (FP.audioNoiseSeed != null && typeof AudioBuffer !== 'undefined') {
    var noisedBuffers = new WeakSet();
    var origGetChannelData = AudioBuffer.prototype.getChannelData;

    AudioBuffer.prototype.getChannelData = function(channel) {
      var data = origGetChannelData.call(this, channel);
      // Track per-channel noise to ensure all channels get noised (INJ-5 fix)
      var bufferKey = this;
      if (!noisedBuffers.has(bufferKey)) {
        noisedBuffers.add(bufferKey);
        // Noise ALL channels on first access to any channel
        for (var ch = 0; ch < this.numberOfChannels; ch++) {
          var chData = origGetChannelData.call(this, ch);
          var rng = mulberry32(FP.audioNoiseSeed + ch);
          for (var i = 0; i < chData.length; i++) {
            if (rng() < 0.05) {
              chData[i] += (rng() - 0.5) * 0.0002;
            }
          }
        }
      }
      return data;
    };
    hideOverride(AudioBuffer.prototype.getChannelData, 'function getChannelData() { [native code] }');
  }

  // ============ TIMEZONE (DST-aware) ============
  if (FP.timezone) {
    var OrigDateTimeFormat = Intl.DateTimeFormat;

    // Create a proper constructor that works with and without `new`
    var NewDateTimeFormat = function DateTimeFormat() {
      var args = Array.from(arguments);
      if (!args[1]) args[1] = {};
      if (!args[1].timeZone) args[1].timeZone = FP.timezone;
      return new OrigDateTimeFormat(args[0], args[1]);
    };
    NewDateTimeFormat.prototype = OrigDateTimeFormat.prototype;
    NewDateTimeFormat.supportedLocalesOf = OrigDateTimeFormat.supportedLocalesOf;
    Object.defineProperty(NewDateTimeFormat, 'name', { value: 'DateTimeFormat', configurable: true });
    Object.defineProperty(NewDateTimeFormat, 'length', { value: 0, configurable: true });
    Intl.DateTimeFormat = NewDateTimeFormat;
    hideOverride(NewDateTimeFormat, 'function DateTimeFormat() { [native code] }');

    // Dynamic DST-aware getTimezoneOffset — compute the correct offset for the current date
    // by comparing UTC time with the target timezone's local time using Intl.DateTimeFormat
    var origGetTimezoneOffset = Date.prototype.getTimezoneOffset;
    var cachedOffset = null;
    var cachedOffsetDate = null;

    function computeTimezoneOffset(date) {
      // Only recompute if date's day changed (DST transitions happen at 2am)
      var dateKey = date.getUTCFullYear() * 10000 + date.getUTCMonth() * 100 + date.getUTCDate();
      if (cachedOffsetDate === dateKey && cachedOffset !== null) return cachedOffset;

      try {
        // Use the original Intl.DateTimeFormat to get the target timezone's hour/minute
        var fmt = new OrigDateTimeFormat('en-US', {
          timeZone: FP.timezone,
          year: 'numeric', month: 'numeric', day: 'numeric',
          hour: 'numeric', minute: 'numeric', second: 'numeric',
          hour12: false,
        });
        var parts = fmt.formatToParts(date);
        var get = function(type) {
          var p = parts.find(function(x) { return x.type === type; });
          return p ? parseInt(p.value) : 0;
        };
        var localDate = new Date(Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second')));
        cachedOffset = Math.round((date.getTime() - localDate.getTime()) / 60000);
        cachedOffsetDate = dateKey;
        return cachedOffset;
      } catch (e) {
        return origGetTimezoneOffset.call(date);
      }
    }

    Date.prototype.getTimezoneOffset = function() {
      return computeTimezoneOffset(this);
    };
    hideOverride(Date.prototype.getTimezoneOffset, 'function getTimezoneOffset() { [native code] }');
  }

  // ============ FONT FINGERPRINT PROTECTION ============
  // document.fonts.check() is used to enumerate installed fonts.
  // We allow standard Windows/Chrome fonts but block detection of unusual fonts
  // that could uniquely identify this machine across accounts.
  if (FP.fontSeed != null && typeof document !== 'undefined' && document.fonts) {
    var STANDARD_FONTS = [
      'Arial', 'Verdana', 'Helvetica', 'Times New Roman', 'Times', 'Courier New',
      'Courier', 'Georgia', 'Palatino', 'Garamond', 'Bookman', 'Trebuchet MS',
      'Arial Black', 'Impact', 'Comic Sans MS', 'Tahoma', 'Geneva', 'Lucida Console',
      'Lucida Sans Unicode', 'Lucida Grande', 'Segoe UI', 'Roboto', 'Open Sans',
      'Calibri', 'Cambria', 'Consolas', 'Candara', 'Optima', 'Century Gothic',
      'Franklin Gothic Medium', 'Gill Sans', 'Microsoft Sans Serif', 'Segoe UI Symbol',
    ];
    // Per-account subset of "extra" fonts to simulate different installs
    var EXTRA_FONTS = [
      'Webdings', 'Wingdings', 'Symbol', 'MS Gothic', 'MS PGothic', 'MS Mincho',
      'Malgun Gothic', 'Yu Gothic', 'Meiryo', 'Nirmala UI', 'Javanese Text',
      'Myanmar Text', 'Leelawadee UI', 'Bahnschrift', 'Ink Free', 'Sitka Text',
    ];
    var rng = mulberry32(FP.fontSeed);
    var accountExtraFonts = EXTRA_FONTS.filter(function() { return rng() > 0.5; });
    var allowedFonts = new Set(STANDARD_FONTS.concat(accountExtraFonts));

    var origFontsCheck = document.fonts.check.bind(document.fonts);
    document.fonts.check = function(font, text) {
      // Extract font family from CSS font shorthand (e.g. "12px Arial" or "bold 16px 'Comic Sans MS'")
      var match = font.match(/(?:^|\s)(['"]?)([^'"]+)\1\s*$/);
      var family = match ? match[2].trim() : font;
      // If the font is not in our allowed set, always report it as unavailable
      if (!allowedFonts.has(family)) return false;
      return origFontsCheck(font, text);
    };
    hideOverride(document.fonts.check, 'function check() { [native code] }');
  }

  // ============ PERMISSIONS API ALIGNMENT ============
  // Ensure navigator.permissions.query() returns results consistent with
  // our setPermissionRequestHandler config in main.js
  if (navigator.permissions && navigator.permissions.query) {
    var origPermQuery = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = function(desc) {
      if (!desc || !desc.name) return origPermQuery(desc);
      // These match the ALLOWED permissions in main.js setPermissionRequestHandler
      var allowed = { 'clipboard-write': true, 'clipboard-read': true, notifications: true };
      // Permissions we explicitly deny — return 'denied' immediately
      var denied = { geolocation: true, camera: true, microphone: true, midi: true, 'background-sync': true };
      if (denied[desc.name]) {
        return Promise.resolve({ state: 'denied', onchange: null });
      }
      return origPermQuery(desc);
    };
    hideOverride(navigator.permissions.query, 'function query() { [native code] }');
  }

  // ============ IFRAME PROTECTION ============
  // Monitor for new iframes and inject overrides into their content windows
  // This prevents detection via iframe.contentWindow.navigator.userAgent
  function injectIntoFrame(iframe) {
    try {
      var win = iframe.contentWindow;
      if (!win || !win.navigator) return;
      // Check if already injected
      if (win.__FP_INJECTED__) return;
      win.__FP_INJECTED__ = true;

      // toString spoofing in iframe realm (INJ-1 fix)
      var iframeNativeToString = win.Function.prototype.toString;
      var iframeOverriddenFns = new Map();
      function iframeHideOverride(fn, nativeStr) {
        if (fn) iframeOverriddenFns.set(fn, nativeStr);
      }
      win.Function.prototype.toString = function() {
        if (iframeOverriddenFns.has(this)) return iframeOverriddenFns.get(this);
        return iframeNativeToString.call(this);
      };
      iframeOverriddenFns.set(win.Function.prototype.toString, 'function toString() { [native code] }');

      // Override navigator properties in the iframe's realm
      var iframeNav = win.Navigator.prototype;
      var iframeDefineGetter = function(obj, prop, value, nativeStr) {
        var getter = function() { return value; };
        Object.defineProperty(getter, 'name', { value: 'get ' + prop, configurable: true });
        Object.defineProperty(getter, 'length', { value: 0, configurable: true });
        Object.defineProperty(obj, prop, { get: getter, configurable: true, enumerable: true });
        iframeHideOverride(getter, nativeStr || ('function get ' + prop + '() { [native code] }'));
      };

      iframeDefineGetter(iframeNav, 'userAgent', FP.userAgent);
      iframeDefineGetter(iframeNav, 'appVersion', FP.userAgent.replace('Mozilla/', ''));
      iframeDefineGetter(iframeNav, 'platform', FP.platform);
      iframeDefineGetter(iframeNav, 'hardwareConcurrency', FP.hardwareConcurrency);
      iframeDefineGetter(iframeNav, 'deviceMemory', FP.deviceMemory);
      iframeDefineGetter(iframeNav, 'languages', frozenLangs);
      iframeDefineGetter(iframeNav, 'language', FP.languages[0] || 'en-US');
      iframeDefineGetter(iframeNav, 'webdriver', false);
      iframeDefineGetter(iframeNav, 'maxTouchPoints', FP.maxTouchPoints);
      if (FP.vendor) iframeDefineGetter(iframeNav, 'vendor', FP.vendor);
      if (FP.productSub) iframeDefineGetter(iframeNav, 'productSub', FP.productSub);

      // Connection override in iframe (INJ-2 fix)
      if (FP.connection) {
        var iframeConn = Object.create(win.EventTarget.prototype);
        Object.defineProperties(iframeConn, {
          effectiveType: { get: function() { return FP.connection.effectiveType; }, enumerable: true, configurable: true },
          downlink:      { get: function() { return FP.connection.downlink; }, enumerable: true, configurable: true },
          rtt:           { get: function() { return FP.connection.rtt; }, enumerable: true, configurable: true },
          saveData:      { get: function() { return false; }, enumerable: true, configurable: true },
        });
        iframeDefineGetter(iframeNav, 'connection', iframeConn);
      }

      // UserAgentData override in iframe (INJ-2 fix)
      if (FP.uaData) {
        var iframeUaData = {
          brands: FP.uaData.brands,
          mobile: FP.uaData.mobile,
          platform: FP.uaData.platform,
          getHighEntropyValues: function(hints) {
            var result = { brands: FP.uaData.brands, mobile: FP.uaData.mobile, platform: FP.uaData.platform };
            if (hints.includes('fullVersionList')) result.fullVersionList = FP.uaData.fullVersionList;
            return win.Promise.resolve(result);
          },
          toJSON: function() {
            return { brands: FP.uaData.brands, mobile: FP.uaData.mobile, platform: FP.uaData.platform };
          },
        };
        iframeHideOverride(iframeUaData.getHighEntropyValues, 'function getHighEntropyValues() { [native code] }');
        iframeHideOverride(iframeUaData.toJSON, 'function toJSON() { [native code] }');
        iframeDefineGetter(iframeNav, 'userAgentData', iframeUaData);
      }

      if (FP.screen) {
        iframeDefineGetter(win.Screen.prototype, 'width', FP.screen.width);
        iframeDefineGetter(win.Screen.prototype, 'height', FP.screen.height);
        iframeDefineGetter(win.Screen.prototype, 'availWidth', FP.screen.width);
        iframeDefineGetter(win.Screen.prototype, 'availHeight', FP.screen.availHeight);
        iframeDefineGetter(win.Screen.prototype, 'colorDepth', FP.screen.colorDepth);
      }
    } catch (e) {
      // Cross-origin iframe — cannot access, which is fine (no leak)
    }
  }

  // Watch for iframe creation
  if (typeof MutationObserver !== 'undefined') {
    var observer = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var nodes = mutations[i].addedNodes;
        for (var j = 0; j < nodes.length; j++) {
          var node = nodes[j];
          if (node.tagName === 'IFRAME') {
            node.addEventListener('load', function() { injectIntoFrame(this); });
            // Also try immediately in case it's already loaded
            injectIntoFrame(node);
          }
          // Check children for nested iframes
          if (node.querySelectorAll) {
            var iframes = node.querySelectorAll('iframe');
            for (var k = 0; k < iframes.length; k++) {
              iframes[k].addEventListener('load', function() { injectIntoFrame(this); });
              injectIntoFrame(iframes[k]);
            }
          }
        }
      }
    });
    // Start observing after DOM is ready
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', function() {
        observer.observe(document.body, { childList: true, subtree: true });
      });
    }
    // Inject into any existing iframes
    var existingFrames = document.querySelectorAll('iframe');
    for (var i = 0; i < existingFrames.length; i++) {
      existingFrames[i].addEventListener('load', function() { injectIntoFrame(this); });
      injectIntoFrame(existingFrames[i]);
    }
  }

  // Clean up config from window — make non-enumerable and clear immediately
  try {
    Object.defineProperty(window, '__FP_CONFIG__', { value: undefined, writable: true, configurable: true, enumerable: false });
    delete window.__FP_CONFIG__;
  } catch (e) {
    try { window.__FP_CONFIG__ = undefined; } catch (e2) {}
  }
})();
