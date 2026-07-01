(function (global) {
  "use strict";

  /** Must match the first line of scripts/atlas_xor_key.hex (32-byte key as 64 hex chars). */
  var ATLAS_IMAGE_XOR_KEY_HEX =
    "6b1e9f3a8c2d4057e8a1f4c9d2b6e305a7f8c1d4e9b2a60853f7e1c9d4a2b6e8";

  function atlasHexToBytes(hex) {
    var len = hex.length / 2;
    var out = new Uint8Array(len);
    for (var i = 0; i < len; i++) {
      out[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return out;
  }

  var atlasXorKeyBytes = atlasHexToBytes(ATLAS_IMAGE_XOR_KEY_HEX);

  function atlasUrlIsObfuscated(url) {
    var s = String(url).toLowerCase();
    return s.endsWith(".atlasbin");
  }

  function atlasXorDecodeBuffer(buffer) {
    var inp = new Uint8Array(buffer);
    var out = new Uint8Array(inp.length);
    var kl = atlasXorKeyBytes.length;
    for (var i = 0; i < inp.length; i++) {
      out[i] = inp[i] ^ atlasXorKeyBytes[i % kl];
    }
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
  }

  function revokeAtlasBlobUrl(img) {
    var prev = img.getAttribute("data-atlas-blob-url");
    if (prev) {
      try {
        URL.revokeObjectURL(prev);
      } catch (err) {}
      img.removeAttribute("data-atlas-blob-url");
    }
  }

  function parseCsv(text) {
    var lines = text.trim().split(/\r?\n/);
    var rows = [];
    for (var i = 0; i < lines.length; i++) {
      var parts = lines[i].split(",");
      if (parts.length < 6) continue;
      rows.push({
        index: i + 1,
        type: parts[0].trim(),
        depth: parseFloat(parts[1]),
        x0: parseFloat(parts[2]),
        y0: parseFloat(parts[3]),
        pxx: parseFloat(parts[4]),
        pxy: parseFloat(parts[5]),
      });
    }
    return rows;
  }

  function closestByType(rows, type, value) {
    var best = null;
    var bestDist = Infinity;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row.type !== type) continue;
      var d = Math.abs(row.depth - value);
      if (d < bestDist) {
        bestDist = d;
        best = row;
      }
    }
    return best;
  }

  function parseCoord(name, params) {
    var v = params.get(name);
    if (v === null || v === "") return 0;
    var n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }

  function layoutDot(img, dot, leftPx, topPx) {
    function apply() {
      var nw = img.naturalWidth;
      var nh = img.naturalHeight;
      if (!nw || !nh) return;
      dot.style.left = (leftPx / nw) * 100 + "%";
      dot.style.top = (topPx / nh) * 100 + "%";
    }

    if (img.complete && img.naturalWidth) apply();
    else img.addEventListener("load", apply, { once: true });
  }

  var LS_MARKER_MODE = "labs.brainAtlas.markerMode";
  var LS_ENTRY_ANGLE = "labs.brainAtlas.entryAngle";
  var LS_ENTRY_DIRECTION = "labs.brainAtlas.entryDirection";
  var lastAtlasPayload = null;
  var markerModeState = "crosshair";
  var entryAngleDeg = 0;
  var entryDirection = "ml";
  var replaceAtlasUrlDebounceId = null;

  function hasElectrodeLineFeature() {
    return !!(lastConfig && lastConfig.electrodeLine) || !!document.querySelector(".atlas-panel-angle");
  }

  function isElectrodeLineActive() {
    return hasElectrodeLineFeature() && markerModeState === "line";
  }

  function degToRad(deg) {
    return (deg * Math.PI) / 180;
  }

  function computeElectrodeEntryMl(ml, dv, angleDeg) {
    var d = Math.abs(dv);
    return ml - d * Math.tan(degToRad(angleDeg));
  }

  function computeElectrodeEntryAp(ap, dv, angleDeg) {
    var d = Math.abs(dv);
    return ap - d * Math.tan(degToRad(angleDeg));
  }

  function entryAngleForDirection(angleDeg, direction) {
    return direction === "ml" ? -angleDeg : angleDeg;
  }

  function formatCoordReadout(n) {
    if (!Number.isFinite(n)) return "—";
    var s = n.toFixed(3).replace(/\.?0+$/, "");
    return s === "-0" ? "0" : s;
  }

  function readMarkerStateFromUrl(params) {
    if (!hasElectrodeLineFeature()) return null;
    var q = params || new URLSearchParams(window.location.search);
    var out = {};
    if (q.has("mode")) {
      var mode = q.get("mode");
      if (mode === "line" || mode === "crosshair") out.mode = mode;
    }
    if (q.has("dir")) {
      var dir = q.get("dir");
      if (dir === "ml" || dir === "ap") out.dir = dir;
    }
    if (q.has("angle")) {
      var angle = parseInt(q.get("angle"), 10);
      if (Number.isFinite(angle)) out.angle = Math.round(clampNum(angle, -45, 45));
    }
    return Object.keys(out).length ? out : null;
  }

  function persistMarkerState() {
    try {
      localStorage.setItem(LS_MARKER_MODE, markerModeState);
      localStorage.setItem(LS_ENTRY_DIRECTION, entryDirection);
      writeStoredNum(LS_ENTRY_ANGLE, entryAngleDeg);
    } catch (e) {}
  }

  function appendMarkerParamsToQuery(q) {
    if (!hasElectrodeLineFeature()) return;
    if (markerModeState === "line") q.set("mode", "line");
    else q.delete("mode");
    if (entryDirection === "ap") q.set("dir", "ap");
    else q.delete("dir");
    if (entryAngleDeg !== 0) q.set("angle", String(entryAngleDeg));
    else q.delete("angle");
  }

  function buildAtlasQueryParams() {
    var mlEl = document.getElementById("input-ml");
    var apEl = document.getElementById("input-ap");
    var dvEl = document.getElementById("input-dv");
    if (!mlEl || !apEl || !dvEl) return null;
    var q = new URLSearchParams(window.location.search);
    q.set("ml", String(mlEl.value).trim() || "0");
    q.set("ap", String(apEl.value).trim() || "0");
    q.set("dv", String(dvEl.value).trim() || "0");
    q.delete("size");
    appendMarkerParamsToQuery(q);
    return q;
  }

  function buildAtlasShareUrl() {
    var q = buildAtlasQueryParams();
    if (!q) return window.location.href;
    var path = window.location.pathname;
    var qs = q.toString();
    return window.location.origin + path + (qs ? "?" + qs : "");
  }

  function flushReplaceAtlasUrl() {
    if (replaceAtlasUrlDebounceId) {
      clearTimeout(replaceAtlasUrlDebounceId);
      replaceAtlasUrlDebounceId = null;
    }
    replaceAtlasUrl();
  }

  function replaceAtlasUrl() {
    var q = buildAtlasQueryParams();
    if (!q) return;
    if (!window.history || !window.history.replaceState) return;
    var path = window.location.pathname;
    var qs = q.toString();
    window.history.replaceState(null, "", path + (qs ? "?" + qs : ""));
    for (var i = 0; i < coordsChangeListeners.length; i++) {
      try {
        coordsChangeListeners[i]();
      } catch (err) {}
    }
  }

  function scheduleReplaceAtlasUrl() {
    if (replaceAtlasUrlDebounceId) clearTimeout(replaceAtlasUrlDebounceId);
    replaceAtlasUrlDebounceId = setTimeout(function () {
      replaceAtlasUrlDebounceId = null;
      replaceAtlasUrl();
    }, 400);
  }

  function syncMarkerToolbarVisibility() {
    if (!hasElectrodeLineFeature()) return;
    var lineOnly = document.querySelector(".atlas-marker-tools__line-only");
    var isLine = markerModeState === "line";
    if (lineOnly) lineOnly.hidden = !isLine;
  }

  function syncMarkerUi() {
    syncMarkerToolbarVisibility();
    if (lastAtlasPayload && lastConfig) {
      relayoutMarkers();
      return;
    }
    applyMarkerModeBodyClass();
    syncPanelAngleVisibility();
    syncAngleSliderValues();
    refreshLineReadoutFromPayload();
  }

  function applyMarkerModeBodyClass() {
    var body = document.body;
    if (!body) return;
    if (isElectrodeLineActive()) {
      body.classList.add("lab-brain-atlas--marker-line");
    } else {
      body.classList.remove("lab-brain-atlas--marker-line");
    }
  }

  function updateLineReadout(angleDeg, entryValue) {
    var angleInt = Math.round(angleDeg);
    var entryLabel = entryDirection === "ap" ? "Entry AP at DV=0" : "Entry ML at DV=0";
    var readoutText =
      angleInt + "° · " + entryLabel + ": " + formatCoordReadout(entryValue) + " mm";

    var angleEl = document.getElementById("atlas-entry-angle-value-" + entryDirection);
    var readoutEl = document.getElementById("atlas-line-readout-" + entryDirection);
    if (angleEl) angleEl.textContent = angleInt + "°";
    if (readoutEl) readoutEl.textContent = readoutText;
  }

  function syncAngleSliderValues() {
    var mlIn = document.getElementById("atlas-entry-angle-ml");
    var apIn = document.getElementById("atlas-entry-angle-ap");
    if (mlIn) mlIn.value = String(entryAngleDeg);
    if (apIn) apIn.value = String(entryAngleDeg);
  }

  function syncPanelAngleVisibility() {
    var blocks = document.querySelectorAll(".atlas-panel-angle");
    var showLine = isElectrodeLineActive();
    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i];
      var dir = block.getAttribute("data-entry-direction");
      block.hidden = !(showLine && dir === entryDirection);
    }
  }

  function extendLineToTop(xEntry, yEntry, xTarget, yTarget) {
    var x1 = xEntry;
    var y1 = yEntry;
    var dx = xTarget - xEntry;
    var dy = yTarget - yEntry;
    if (Math.abs(dy) > 1e-6) {
      var tSkull = -yEntry / dy;
      if (tSkull < 0) {
        x1 = xEntry + tSkull * dx;
        y1 = 0;
      }
    }
    return { x1: x1, y1: y1, x2: xTarget, y2: yTarget };
  }

  function electrodeLineEndpoints(plane, cal, ml, ap, dv, angleDeg, direction) {
    var d = Math.abs(dv);
    var effAngle = entryAngleForDirection(angleDeg, direction);
    var mlEntry = computeElectrodeEntryMl(ml, dv, effAngle);
    var apEntry = computeElectrodeEntryAp(ap, dv, effAngle);

    if (direction === "ml") {
      if (plane === "coronal") {
        var xEntryMl = cal.x0 + mlEntry * cal.pxx;
        var yEntryMl = cal.y0;
        var xTargetMl = cal.x0 + ml * cal.pxx;
        var yTargetMl = cal.y0 + d * cal.pxy;
        return extendLineToTop(xEntryMl, yEntryMl, xTargetMl, yTargetMl);
      }

      if (plane === "sagittal") {
        var xSagMl = cal.x0 - ap * cal.pxx;
        var yEntrySagMl = cal.y0;
        var yTargetSagMl = cal.y0 + d * cal.pxy;
        return extendLineToTop(xSagMl, yEntrySagMl, xSagMl, yTargetSagMl);
      }

      if (plane === "horizontal") {
        var xHorMl = cal.x0 - ap * cal.pxx;
        var yEntryHorMl = cal.y0 - mlEntry * cal.pxy;
        var yTargetHorMl = cal.y0 - ml * cal.pxy;
        return { x1: xHorMl, y1: yEntryHorMl, x2: xHorMl, y2: yTargetHorMl };
      }
    } else {
      if (plane === "coronal") {
        var xCorAp = cal.x0 + ml * cal.pxx;
        var yEntryCorAp = cal.y0;
        var yTargetCorAp = cal.y0 + d * cal.pxy;
        return extendLineToTop(xCorAp, yEntryCorAp, xCorAp, yTargetCorAp);
      }

      if (plane === "sagittal") {
        var xEntrySagAp = cal.x0 - apEntry * cal.pxx;
        var yEntrySagAp = cal.y0;
        var xTargetSagAp = cal.x0 - ap * cal.pxx;
        var yTargetSagAp = cal.y0 + d * cal.pxy;
        return extendLineToTop(xEntrySagAp, yEntrySagAp, xTargetSagAp, yTargetSagAp);
      }

      if (plane === "horizontal") {
        var xEntryHorAp = cal.x0 - apEntry * cal.pxx;
        var xTargetHorAp = cal.x0 - ap * cal.pxx;
        var yHorAp = cal.y0 - ml * cal.pxy;
        return { x1: xEntryHorAp, y1: yHorAp, x2: xTargetHorAp, y2: yHorAp };
      }
    }

    return null;
  }

  function layoutElectrodeLine(img, svg, lineEl, data, angleDeg) {
    function apply() {
      var nw = img.naturalWidth;
      var nh = img.naturalHeight;
      if (!nw || !nh || !lineEl || !data.plane || !data.cal) return;

      svg.setAttribute("viewBox", "0 0 " + nw + " " + nh);
      svg.setAttribute("width", "100%");
      svg.setAttribute("height", "100%");

      var ends = electrodeLineEndpoints(
        data.plane,
        data.cal,
        data.targetMl,
        data.targetAp,
        data.targetDv,
        angleDeg,
        entryDirection
      );
      if (!ends) return;

      lineEl.setAttribute("x1", String(ends.x1));
      lineEl.setAttribute("y1", String(ends.y1));
      lineEl.setAttribute("x2", String(ends.x2));
      lineEl.setAttribute("y2", String(ends.y2));
    }

    if (img.complete && img.naturalWidth) apply();
    else img.addEventListener("load", apply, { once: true });
  }

  function layoutPanelMarkers(prefix, data) {
    var img = document.getElementById(prefix + "-img");
    var dot = document.getElementById(prefix + "-dot");
    if (!img || !dot) return;

    var leftPx = data.left;
    var topPx = data.top;

    if (isElectrodeLineActive() && data.plane && data.cal) {
      var svg = document.getElementById(prefix + "-electrode-svg");
      var lineEl = document.getElementById(prefix + "-electrode-line");
      if (svg && lineEl) {
        layoutDot(img, dot, leftPx, topPx);
        layoutElectrodeLine(img, svg, lineEl, data, entryAngleDeg);
        return;
      }
    }

    layoutDot(img, dot, leftPx, topPx);
  }

  function refreshLineReadoutFromPayload() {
    if (!isElectrodeLineActive() || !lastAtlasPayload) return;
    var cor = lastAtlasPayload.atlas.coronal;
    if (!cor || cor.targetMl === undefined || cor.targetAp === undefined) return;
    var entryValue;
    var effAngle = entryAngleForDirection(entryAngleDeg, entryDirection);
    if (entryDirection === "ap") {
      entryValue = computeElectrodeEntryAp(cor.targetAp, cor.targetDv, effAngle);
    } else {
      entryValue = computeElectrodeEntryMl(cor.targetMl, cor.targetDv, effAngle);
    }
    updateLineReadout(entryAngleDeg, entryValue);
  }

  function relayoutMarkers() {
    if (!lastAtlasPayload || !lastConfig) return;
    applyMarkerModeBodyClass();
    syncPanelAngleVisibility();
    var atlas = lastAtlasPayload.atlas;
    for (var i = 0; i < lastConfig.panels.length; i++) {
      var key = lastConfig.panels[i];
      if (atlas[key]) layoutPanelMarkers(key, atlas[key]);
    }
    if (isElectrodeLineActive()) refreshLineReadoutFromPayload();
  }

  function finishPanelImageLoad(prefix, data) {
    layoutPanelMarkers(prefix, data);
  }

  function applyPanel(prefix, data) {
    var img = document.getElementById(prefix + "-img");
    var dot = document.getElementById(prefix + "-dot");
    if (!img || !dot) return Promise.resolve();

    if (!atlasUrlIsObfuscated(data.imageUrl)) {
      revokeAtlasBlobUrl(img);
      img.src = data.imageUrl;
      img.alt = prefix + " section";
      finishPanelImageLoad(prefix, data);
      return Promise.resolve();
    }

    revokeAtlasBlobUrl(img);

    return fetch(data.imageUrl, { credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) throw new Error("Failed to load image: " + data.imageUrl);
        return r.arrayBuffer();
      })
      .then(function (buf) {
        var decoded = atlasXorDecodeBuffer(buf);
        var blob = new Blob([decoded]);
        var objUrl = URL.createObjectURL(blob);
        img.setAttribute("data-atlas-blob-url", objUrl);
        img.onload = function () {
          img.onload = null;
        };
        img.onerror = function () {
          img.onerror = null;
          try {
            URL.revokeObjectURL(objUrl);
          } catch (e2) {}
          img.removeAttribute("data-atlas-blob-url");
        };
        img.src = objUrl;
        img.alt = prefix + " section";
        finishPanelImageLoad(prefix, data);
      })
      .catch(function (err) {
        console.error(err);
        img.alt = "Section image failed to load";
        img.removeAttribute("src");
      });
  }

  var FLOAT_RE = /^[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?$/;

  function isValidFloatString(s) {
    s = String(s).trim();
    if (s === "") return false;
    if (!FLOAT_RE.test(s)) return false;
    var n = parseFloat(s);
    return Number.isFinite(n);
  }

  function initFormValidation() {
    var form = document.getElementById("atlas-coord-form");
    if (!form) return;

    var inputs = [
      document.getElementById("input-ml"),
      document.getElementById("input-ap"),
      document.getElementById("input-dv"),
    ];
    var errEl = document.getElementById("atlas-form-error");

    function clearFieldErrors() {
      for (var i = 0; i < inputs.length; i++) {
        var inp = inputs[i];
        if (!inp) continue;
        inp.removeAttribute("aria-invalid");
        inp.removeAttribute("aria-describedby");
      }
      if (errEl) {
        errEl.textContent = "";
        errEl.hidden = true;
      }
    }

    form.addEventListener("submit", function (e) {
      clearFieldErrors();
      var firstBad = null;
      for (var j = 0; j < inputs.length; j++) {
        var input = inputs[j];
        if (!input) continue;
        if (!isValidFloatString(input.value)) {
          input.setAttribute("aria-invalid", "true");
          input.setAttribute("aria-describedby", "atlas-form-error");
          if (!firstBad) firstBad = input;
        }
      }
      if (firstBad) {
        e.preventDefault();
        if (errEl) {
          errEl.textContent =
            "Enter a valid number for ML, AP, and DV (decimals allowed, e.g. 0.43 or .43).";
          errEl.hidden = false;
        }
        firstBad.focus();
        return;
      }
      if (lastRows && lastConfig) {
        e.preventDefault();
        replaceAtlasUrl();
        redrawAtlasFromInputs();
      }
    });

    for (var k = 0; k < inputs.length; k++) {
      (function (inp) {
        if (!inp) return;
        inp.addEventListener("input", function () {
          if (inp.getAttribute("aria-invalid") === "true") clearFieldErrors();
        });
      })(inputs[k]);
    }
  }

  function syncInputsFromParams(params) {
    var ap = parseCoord("ap", params);
    var ml = parseCoord("ml", params);
    var dv = parseCoord("dv", params);
    var apInput = document.getElementById("input-ap");
    var mlInput = document.getElementById("input-ml");
    var dvInput = document.getElementById("input-dv");
    if (mlInput) mlInput.value = params.has("ml") ? params.get("ml") : String(ml);
    if (apInput) apInput.value = params.has("ap") ? params.get("ap") : String(ap);
    if (dvInput) dvInput.value = params.has("dv") ? params.get("dv") : String(dv);
  }

  function applyQueryTitle(params) {
    var titleEl = document.getElementById("atlas-query-title");
    if (!titleEl) return;
    var titleParam = params.get("title");
    if (titleParam) {
      titleEl.textContent = titleParam;
      titleEl.hidden = false;
    } else {
      titleEl.textContent = "";
      titleEl.hidden = true;
    }
  }

  var lastRows = null;
  var lastConfig = null;
  var coordsChangeListeners = [];
  var sliceNavClickBound = false;

  function readInputsAsNumbers() {
    var mlEl = document.getElementById("input-ml");
    var apEl = document.getElementById("input-ap");
    var dvEl = document.getElementById("input-dv");
    if (!mlEl || !apEl || !dvEl) return null;
    var ml = parseFloat(mlEl.value);
    var ap = parseFloat(apEl.value);
    var dv = parseFloat(dvEl.value);
    if (!Number.isFinite(ml)) ml = 0;
    if (!Number.isFinite(ap)) ap = 0;
    if (!Number.isFinite(dv)) dv = 0;
    return { ml: ml, ap: ap, dv: dv };
  }

  function formatCoordForInput(n) {
    if (!Number.isFinite(n)) return "0";
    var t = Number(n);
    if (Math.abs(t) >= 1e4 || (Math.abs(t) < 1e-4 && t !== 0)) return String(t);
    var s = t.toFixed(4).replace(/\.?0+$/, "");
    return s === "-0" ? "0" : s;
  }

  function renderAtlasView(rows, config, ap, ml, dv) {
    var atlas = config.getAtlas(ap, ml, dv, rows);
    lastAtlasPayload = { ap: ap, ml: ml, dv: dv, atlas: atlas };
    var tasks = [];
    for (var i = 0; i < config.panels.length; i++) {
      var panelKey = config.panels[i];
      tasks.push(
        applyPanel(panelKey, atlas[panelKey]).catch(function (e) {
          console.error(e);
        })
      );
    }
    return Promise.all(tasks);
  }

  function redrawAtlasFromInputs() {
    if (!lastRows || !lastConfig) return;
    var nums = readInputsAsNumbers();
    if (!nums) return;
    updateSliceNavButtonStates();
    renderAtlasView(lastRows, lastConfig, nums.ap, nums.ml, nums.dv).catch(function (e) {
      console.error(e);
    });
  }

  function replaceUrlFromInputs() {
    replaceAtlasUrl();
  }

  function uniqueSortedDepths(rows, planeType) {
    var seen = {};
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.type !== planeType) continue;
      var d = r.depth;
      if (!Number.isFinite(d)) continue;
      var key = String(d);
      if (seen[key]) continue;
      seen[key] = true;
      out.push(d);
    }
    out.sort(function (a, b) {
      return a - b;
    });
    return out;
  }

  function closestDepthIndex(depths, value) {
    if (!depths.length) return -1;
    var best = 0;
    var bestDist = Infinity;
    for (var i = 0; i < depths.length; i++) {
      var di = Math.abs(depths[i] - value);
      if (di < bestDist) {
        bestDist = di;
        best = i;
      }
    }
    return best;
  }

  function horizontalLookupFromDv(dvNum) {
    return -Math.abs(dvNum);
  }

  function applySliceDepthToInputs(plane, depth) {
    var mlEl = document.getElementById("input-ml");
    var apEl = document.getElementById("input-ap");
    var dvEl = document.getElementById("input-dv");
    if (!mlEl || !apEl || !dvEl) return;
    if (plane === "coronal") {
      apEl.value = formatCoordForInput(depth);
    } else if (plane === "sagittal") {
      mlEl.value = formatCoordForInput(depth);
    } else if (plane === "horizontal") {
      dvEl.value = formatCoordForInput(-depth);
    }
  }

  function updateSliceNavButtonStates() {
    if (!lastRows) return;
    var nums = readInputsAsNumbers();
    if (!nums) return;
    var navs = document.querySelectorAll(".atlas-slice-nav");
    for (var n = 0; n < navs.length; n++) {
      var nav = navs[n];
      var plane = nav.getAttribute("data-plane");
      if (!plane) continue;
      var depths = uniqueSortedDepths(lastRows, plane);
      var prevB = nav.querySelector('[data-dir="prev"]');
      var nextB = nav.querySelector('[data-dir="next"]');
      if (!depths.length) {
        if (prevB) prevB.disabled = true;
        if (nextB) nextB.disabled = true;
        continue;
      }
      var lookupVal;
      if (plane === "coronal") lookupVal = nums.ap;
      else if (plane === "sagittal") lookupVal = nums.ml;
      else lookupVal = horizontalLookupFromDv(nums.dv);

      var idx = closestDepthIndex(depths, lookupVal);
      var atMin = idx <= 0;
      var atMax = idx >= depths.length - 1;
      /* Coronal: stepping direction matches atlas plate order (prev/next flipped vs sorted depth). */
      if (plane === "coronal") {
        if (prevB) prevB.disabled = atMax;
        if (nextB) nextB.disabled = atMin;
      } else {
        if (prevB) prevB.disabled = atMin;
        if (nextB) nextB.disabled = atMax;
      }
    }
  }

  function initSliceNavigation() {
    if (sliceNavClickBound) return;
    var inner = document.querySelector(".atlas-inner");
    if (!inner || !lastRows || !lastConfig) return;
    if (!document.querySelector(".atlas-slice-nav")) return;
    sliceNavClickBound = true;

    inner.addEventListener("click", function (e) {
      var btn = e.target.closest(".atlas-slice-nav__btn");
      if (!btn || btn.disabled) return;
      var wrap = btn.closest(".atlas-slice-nav");
      if (!wrap) return;
      var plane = wrap.getAttribute("data-plane");
      var dir = btn.getAttribute("data-dir");
      if (!plane || !dir) return;

      var depths = uniqueSortedDepths(lastRows, plane);
      if (!depths.length) return;

      var nums = readInputsAsNumbers();
      if (!nums) return;

      var lookupVal;
      if (plane === "coronal") lookupVal = nums.ap;
      else if (plane === "sagittal") lookupVal = nums.ml;
      else lookupVal = horizontalLookupFromDv(nums.dv);

      var idx = closestDepthIndex(depths, lookupVal);
      var step = dir === "prev" ? -1 : 1;
      if (plane === "coronal") step = -step;
      idx += step;

      if (idx < 0 || idx >= depths.length) return;

      applySliceDepthToInputs(plane, depths[idx]);
      redrawAtlasFromInputs();
      replaceUrlFromInputs();
    });
  }

  /**
   * @param {object} config
   * @param {string} config.csvUrl
   * @param {function(number, number, number, Array): object} config.getAtlas
   * @param {string[]} config.panels
   * @param {boolean} [config.queryTitle]
   */
  function boot(config) {
    initFormValidation();

    fetch(config.csvUrl, { credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) throw new Error("Failed to load atlas data.");
        return r.text();
      })
      .then(function (text) {
        lastRows = parseCsv(text);
        lastConfig = config;

        var params = new URLSearchParams(window.location.search);
        syncInputsFromParams(params);
        if (config.queryTitle !== false) applyQueryTitle(params);

        var nums = readInputsAsNumbers();
        var chain = Promise.resolve();
        if (nums) {
          chain = renderAtlasView(lastRows, lastConfig, nums.ap, nums.ml, nums.dv);
        }
        return chain;
      })
      .then(function () {
        syncMarkerUi();
        if (markerModeState === "line" || entryDirection === "ap" || entryAngleDeg !== 0) {
          replaceAtlasUrl();
        }
        initSliceNavigation();
        updateSliceNavButtonStates();
      })
      .catch(function (e) {
        console.error(e);
        var el = document.getElementById("atlas-error");
        if (el) {
          el.hidden = false;
          el.textContent = "Could not load atlas data. Please refresh the page.";
        }
      });
  }

  var citeStatusTimeoutId = null;
  var shareStatusTimeoutId = null;

  function copyTextToClipboard(text, onSuccess, onError) {
    function fallbackCopy() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try {
        if (document.execCommand("copy")) {
          if (onSuccess) onSuccess();
        } else if (onError) {
          onError();
        }
      } catch (err) {
        if (onError) onError();
      }
      document.body.removeChild(ta);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () {
          if (onSuccess) onSuccess();
        },
        function () {
          fallbackCopy();
        }
      );
    } else {
      fallbackCopy();
    }
  }

  function initShareLink() {
    var btn = document.getElementById("atlas-share-btn");
    var statusEl = document.getElementById("atlas-share-status");
    if (!btn) return;

    function showStatus(msg, isError) {
      if (!statusEl) return;
      statusEl.textContent = msg;
      statusEl.hidden = false;
      if (isError) statusEl.classList.add("atlas-share__status--error");
      else statusEl.classList.remove("atlas-share__status--error");
      if (shareStatusTimeoutId !== null) {
        window.clearTimeout(shareStatusTimeoutId);
        shareStatusTimeoutId = null;
      }
      if (!isError && msg) {
        shareStatusTimeoutId = window.setTimeout(function () {
          shareStatusTimeoutId = null;
          statusEl.hidden = true;
          statusEl.textContent = "";
        }, 3000);
      }
    }

    btn.addEventListener("click", function () {
      flushReplaceAtlasUrl();
      var url = buildAtlasShareUrl();
      copyTextToClipboard(
        url,
        function () {
          showStatus("Link copied");
        },
        function () {
          showStatus("Could not copy link", true);
        }
      );
    });
  }

  function initBrainAtlasFooter() {
    var btn = document.getElementById("atlas-cite-btn");
    var dataEl = document.getElementById("atlas-cite-json");
    var statusEl = document.getElementById("atlas-cite-status");
    if (!btn || !dataEl) return;

    var data;
    try {
      data = JSON.parse(dataEl.textContent.trim());
    } catch (e) {
      return;
    }

    function formatDate() {
      return new Date().toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    }

    function buildCiteText() {
      var url = typeof window !== "undefined" ? window.location.href : "";
      return (
        data.book +
        "\n\n" +
        data.toolTitle +
        " (interactive atlas). Matt Gaidica. " +
        url +
        ". Accessed " +
        formatDate() +
        "."
      );
    }

    function showStatus(msg, isError) {
      if (!statusEl) return;
      statusEl.textContent = msg;
      statusEl.hidden = false;
      if (isError) statusEl.classList.add("atlas-cite-status--error");
      else statusEl.classList.remove("atlas-cite-status--error");
      if (citeStatusTimeoutId !== null) {
        window.clearTimeout(citeStatusTimeoutId);
        citeStatusTimeoutId = null;
      }
      if (!isError && msg) {
        citeStatusTimeoutId = window.setTimeout(function () {
          citeStatusTimeoutId = null;
          statusEl.hidden = true;
          statusEl.textContent = "";
        }, 3500);
      }
    }

    btn.addEventListener("click", function () {
      var text = buildCiteText();
      copyTextToClipboard(
        text,
        function () {
          showStatus("Copied to clipboard.");
        },
        function () {
          showStatus("Could not copy automatically. Copy the atlas source text above.", true);
        }
      );
    });
  }

  function readStoredNum(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw === null || raw === "") return fallback;
      var n = parseFloat(raw);
      return Number.isFinite(n) ? n : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeStoredNum(key, n) {
    try {
      localStorage.setItem(key, String(n));
    } catch (e) {}
  }

  function clampNum(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  function initMarkerModeControls() {
    var modeRadios = document.querySelectorAll('input[name="atlas-marker-mode"]');
    if (!modeRadios.length) return;

    var angleInputs = document.querySelectorAll(".atlas-panel-angle__range");
    var directionRadios = document.querySelectorAll('input[name="atlas-entry-direction"]');

    markerModeState = "crosshair";
    entryDirection = "ml";
    entryAngleDeg = 0;

    var urlMarkerState = readMarkerStateFromUrl();
    if (urlMarkerState && urlMarkerState.mode) markerModeState = urlMarkerState.mode;
    else {
      try {
        var storedMode = localStorage.getItem(LS_MARKER_MODE);
        if (storedMode === "line" || storedMode === "crosshair") markerModeState = storedMode;
      } catch (e) {}
    }

    if (urlMarkerState && urlMarkerState.dir) entryDirection = urlMarkerState.dir;
    else {
      try {
        var storedDir = localStorage.getItem(LS_ENTRY_DIRECTION);
        if (storedDir === "ml" || storedDir === "ap") entryDirection = storedDir;
      } catch (e) {}
    }

    if (urlMarkerState && urlMarkerState.angle !== undefined) entryAngleDeg = urlMarkerState.angle;
    else entryAngleDeg = Math.round(clampNum(readStoredNum(LS_ENTRY_ANGLE, 0), -45, 45));

    persistMarkerState();

    for (var i = 0; i < modeRadios.length; i++) {
      var r = modeRadios[i];
      r.checked = r.value === markerModeState;
    }
    for (var d = 0; d < directionRadios.length; d++) {
      directionRadios[d].checked = directionRadios[d].value === entryDirection;
    }
    syncAngleSliderValues();
    refreshLineReadoutFromPayload();

    function syncModeUi() {
      syncMarkerUi();
    }

    for (var j = 0; j < modeRadios.length; j++) {
      modeRadios[j].addEventListener("change", function () {
        if (!this.checked) return;
        markerModeState = this.value === "line" ? "line" : "crosshair";
        persistMarkerState();
        replaceAtlasUrl();
        syncModeUi();
      });
    }

    for (var a = 0; a < angleInputs.length; a++) {
      angleInputs[a].addEventListener("input", function () {
        var val = parseFloat(this.value);
        if (!Number.isFinite(val)) return;
        entryAngleDeg = Math.round(clampNum(val, -45, 45));
        syncAngleSliderValues();
        persistMarkerState();
        scheduleReplaceAtlasUrl();
        relayoutMarkers();
      });
    }

    for (var k = 0; k < directionRadios.length; k++) {
      directionRadios[k].addEventListener("change", function () {
        if (!this.checked) return;
        entryDirection = this.value === "ap" ? "ap" : "ml";
        persistMarkerState();
        replaceAtlasUrl();
        syncPanelAngleVisibility();
        refreshLineReadoutFromPayload();
        relayoutMarkers();
      });
    }

    syncModeUi();
  }

  global.BrainAtlasCommon = {
    boot: boot,
    parseCsv: parseCsv,
    closestByType: closestByType,
    redrawAtlasFromInputs: redrawAtlasFromInputs,
    onAtlasCoordsChanged: function (fn) {
      if (typeof fn === "function") coordsChangeListeners.push(fn);
    },
  };

  function initBrainAtlasUi() {
    initMarkerModeControls();
    initShareLink();
    initBrainAtlasFooter();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initBrainAtlasUi);
  } else {
    initBrainAtlasUi();
  }
})(typeof window !== "undefined" ? window : this);
