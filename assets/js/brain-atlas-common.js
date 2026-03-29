(function (global) {
  "use strict";

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

  function applyPanel(prefix, data) {
    var img = document.getElementById(prefix + "-img");
    var dot = document.getElementById(prefix + "-dot");
    if (!img || !dot) return;

    img.src = data.imageUrl;
    img.alt = prefix + " section";
    layoutDot(img, dot, data.left, data.top);
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
    for (var i = 0; i < config.panels.length; i++) {
      var key = config.panels[i];
      applyPanel(key, atlas[key]);
    }
  }

  function redrawAtlasFromInputs() {
    if (!lastRows || !lastConfig) return;
    var nums = readInputsAsNumbers();
    if (!nums) return;
    renderAtlasView(lastRows, lastConfig, nums.ap, nums.ml, nums.dv);
    updateSliceNavButtonStates();
  }

  function replaceUrlFromInputs() {
    var mlEl = document.getElementById("input-ml");
    var apEl = document.getElementById("input-ap");
    var dvEl = document.getElementById("input-dv");
    if (!mlEl || !apEl || !dvEl) return;
    if (!window.history || !window.history.replaceState) return;
    var q = new URLSearchParams(window.location.search);
    q.set("ml", String(mlEl.value).trim() || "0");
    q.set("ap", String(apEl.value).trim() || "0");
    q.set("dv", String(dvEl.value).trim() || "0");
    var path = window.location.pathname;
    var qs = q.toString();
    window.history.replaceState(null, "", path + (qs ? "?" + qs : ""));
    for (var i = 0; i < coordsChangeListeners.length; i++) {
      try {
        coordsChangeListeners[i]();
      } catch (err) {}
    }
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
        if (nums) {
          renderAtlasView(lastRows, lastConfig, nums.ap, nums.ml, nums.dv);
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

    function fallbackCopy(text) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try {
        if (document.execCommand("copy")) {
          showStatus("Copied to clipboard.");
        } else {
          showStatus(
            "Could not copy automatically. Copy the atlas source text above.",
            true
          );
        }
      } catch (err) {
        showStatus(
          "Could not copy automatically. Copy the atlas source text above.",
          true
        );
      }
      document.body.removeChild(ta);
    }

    btn.addEventListener("click", function () {
      var text = buildCiteText();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () {
            showStatus("Copied to clipboard.");
          },
          function () {
            fallbackCopy(text);
          }
        );
      } else {
        fallbackCopy(text);
      }
    });
  }

  var LS_CROSSHAIR_OPACITY = "labs.brainAtlas.crosshairOpacity";
  var LS_CROSSHAIR_SCALE = "labs.brainAtlas.crosshairScale";

  function initCrosshairControls() {
    var body = document.body;
    if (!body || !body.classList.contains("lab-brain-atlas")) return;

    var opIn = document.getElementById("atlas-crosshair-opacity");
    var scIn = document.getElementById("atlas-crosshair-scale");
    if (!opIn || !scIn) return;

    var OP_MIN = 0;
    var OP_MAX = 1;
    var OP_DEFAULT = 1;
    var SC_MIN = 0.65;
    var SC_MAX = 1.45;
    var SC_DEFAULT = 1;

    function readNum(key, fallback) {
      try {
        var raw = localStorage.getItem(key);
        if (raw === null || raw === "") return fallback;
        var n = parseFloat(raw);
        return Number.isFinite(n) ? n : fallback;
      } catch (e) {
        return fallback;
      }
    }

    function writeNum(key, n) {
      try {
        localStorage.setItem(key, String(n));
      } catch (e) {}
    }

    function clamp(n, lo, hi) {
      return Math.min(hi, Math.max(lo, n));
    }

    function applyVars(opacity, scale) {
      body.style.setProperty("--atlas-marker-opacity", String(opacity));
      body.style.setProperty("--atlas-marker-scale", String(scale));
    }

    var opacity = clamp(readNum(LS_CROSSHAIR_OPACITY, OP_DEFAULT), OP_MIN, OP_MAX);
    var scale = clamp(readNum(LS_CROSSHAIR_SCALE, SC_DEFAULT), SC_MIN, SC_MAX);

    opIn.value = String(opacity);
    scIn.value = String(scale);
    applyVars(opacity, scale);

    opIn.addEventListener("input", function () {
      var o = parseFloat(opIn.value);
      if (!Number.isFinite(o)) return;
      o = clamp(o, OP_MIN, OP_MAX);
      var s = parseFloat(scIn.value);
      if (!Number.isFinite(s)) s = SC_DEFAULT;
      applyVars(o, clamp(s, SC_MIN, SC_MAX));
      writeNum(LS_CROSSHAIR_OPACITY, o);
    });

    scIn.addEventListener("input", function () {
      var s = parseFloat(scIn.value);
      if (!Number.isFinite(s)) return;
      s = clamp(s, SC_MIN, SC_MAX);
      var o = parseFloat(opIn.value);
      if (!Number.isFinite(o)) o = OP_DEFAULT;
      applyVars(clamp(o, OP_MIN, OP_MAX), s);
      writeNum(LS_CROSSHAIR_SCALE, s);
    });
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
    initCrosshairControls();
    initBrainAtlasFooter();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initBrainAtlasUi);
  } else {
    initBrainAtlasUi();
  }
})(typeof window !== "undefined" ? window : this);
