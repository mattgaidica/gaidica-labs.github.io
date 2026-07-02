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

  var LS_MARKER_MODE = "labs.brainAtlas.markerMode";
  var LS_ENTRY_ANGLE = "labs.brainAtlas.entryAngle";
  var LS_ENTRY_DIRECTION = "labs.brainAtlas.entryDirection";
  var lastAtlasPayload = null;
  var markerModeState = "crosshair";
  var entryAngleDeg = 0;
  var entryDirection = "ml";
  var replaceAtlasUrlDebounceId = null;
  var LS_MULTI_TEXT = "labs.brainAtlas.multiText";

  function multiTextSessionKey() {
    return LS_MULTI_TEXT + ":" + window.location.pathname;
  }

  function coronalMlSign() {
    return lastConfig && lastConfig.coronalMlSign === -1 ? -1 : 1;
  }

  function panelOrder() {
    return lastConfig && lastConfig.panels && lastConfig.panels.length
      ? lastConfig.panels
      : PLANE_ORDER;
  }
  var MAX_TARGETS = 16;
  var PARULA_16 = [
    "#352a87", "#f5c832", "#2f9590", "#d74d2c", "#5fc25a", "#7f1a7a",
    "#2f6b8e", "#f0a038", "#93d742", "#c42a2a", "#3bab79", "#ede52f",
    "#a8225f", "#468e96", "#e57832", "#4a0d6b",
  ];
  var PLANE_ORDER = ["coronal", "sagittal", "horizontal"];
  var standardRedrawDebounceId = null;
  var multiRedrawDebounceId = null;
  var MULTI_DEMO_ANGLE_SPECS = [
    { dir: "ml", angle: 15 },
    { dir: "ap", angle: -10 },
    { dir: "ml", angle: 25 },
    { dir: "ap", angle: 20 },
    { dir: "ml", angle: -15 },
  ];
  var MULTI_DEMO_MIXED_SPECS = [
    null,
    { dir: "ap", angle: 15 },
    null,
    { dir: "ml", angle: -12 },
    null,
    { dir: "ap", angle: 10 },
  ];

  function readRegionPresetsFromSelect() {
    var sel = document.getElementById("atlas-region-select");
    if (!sel) return [];
    var out = [];
    for (var i = 0; i < sel.options.length; i++) {
      var opt = sel.options[i];
      if (!opt.value) continue;
      var ml = parseFloat(opt.getAttribute("data-ml"));
      var ap = parseFloat(opt.getAttribute("data-ap"));
      var dv = parseFloat(opt.getAttribute("data-dv"));
      if (!Number.isFinite(ml) || !Number.isFinite(ap) || !Number.isFinite(dv)) continue;
      out.push({ ml: ml, ap: ap, dv: dv });
    }
    return out;
  }

  function buildMultiDemoText(kind) {
    var regions = readRegionPresetsFromSelect();
    if (!regions.length) return "";
    var limits = { point: 5, angle: 5, mixed: 6 };
    var limit = Math.min(limits[kind] || 5, regions.length);
    var lines = [];
    for (var i = 0; i < limit; i++) {
      var region = regions[i];
      var target = {
        ml: region.ml,
        ap: region.ap,
        dv: region.dv,
        mode: "crosshair",
        dir: "ml",
        angle: 0,
      };
      if (kind === "angle") {
        var angleSpec = MULTI_DEMO_ANGLE_SPECS[i % MULTI_DEMO_ANGLE_SPECS.length];
        target.mode = "line";
        target.dir = angleSpec.dir;
        target.angle = angleSpec.angle;
      } else if (kind === "mixed") {
        var mixedSpec = MULTI_DEMO_MIXED_SPECS[i % MULTI_DEMO_MIXED_SPECS.length];
        if (mixedSpec) {
          target.mode = "line";
          target.dir = mixedSpec.dir;
          target.angle = mixedSpec.angle;
        }
      }
      lines.push(serializeTarget(target));
    }
    return lines.join("\n");
  }

  function isMultiInputMode() {
    if (new URLSearchParams(window.location.search).get("view") !== "multi") return false;
    return !!document.getElementById("atlas-coord-multi");
  }

  function readMultiTextFromSession() {
    try {
      return sessionStorage.getItem(multiTextSessionKey()) || "";
    } catch (e) {
      return "";
    }
  }

  function writeMultiTextToSession(text) {
    try {
      sessionStorage.setItem(multiTextSessionKey(), text);
    } catch (e) {}
  }

  function parseModeValue(val) {
    var v = String(val).trim().toLowerCase();
    if (v === "cross" || v === "crosshair") return "crosshair";
    if (v === "line") return "line";
    return null;
  }

  function parseDirValue(val) {
    var v = String(val).trim().toUpperCase();
    if (v === "ML") return "ml";
    if (v === "AP") return "ap";
    return null;
  }

  function parseTargetLine(line, lineNum) {
    var parts = line.split(",");
    var fields = {};
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i].trim();
      if (!part) continue;
      var eq = part.indexOf("=");
      if (eq < 0) {
        return { error: "Line " + lineNum + ": expected key=value pairs." };
      }
      var key = part.slice(0, eq).trim().toLowerCase();
      var val = part.slice(eq + 1).trim();
      if (!val) return { error: "Line " + lineNum + ": missing value for " + key + "." };
      fields[key] = val;
    }

    if (fields.ml === undefined || fields.ap === undefined || fields.dv === undefined) {
      return { error: "Line " + lineNum + ": ML, AP, and DV are required." };
    }
    if (!isValidFloatString(fields.ml)) {
      return { error: "Line " + lineNum + ": invalid ML value." };
    }
    if (!isValidFloatString(fields.ap)) {
      return { error: "Line " + lineNum + ": invalid AP value." };
    }
    if (!isValidFloatString(fields.dv)) {
      return { error: "Line " + lineNum + ": invalid DV value." };
    }

    var mode = "crosshair";
    if (fields.mode !== undefined) {
      var parsedMode = parseModeValue(fields.mode);
      if (!parsedMode) {
        return { error: "Line " + lineNum + ': invalid Mode "' + fields.mode + '".' };
      }
      mode = parsedMode;
    }

    var dir = "ml";
    if (fields.dir !== undefined) {
      var parsedDir = parseDirValue(fields.dir);
      if (!parsedDir) {
        return { error: "Line " + lineNum + ': invalid Dir "' + fields.dir + '".' };
      }
      dir = parsedDir;
    }

    var angle = 0;
    if (fields.angle !== undefined) {
      var parsedAngle = parseInt(fields.angle, 10);
      if (!Number.isFinite(parsedAngle)) {
        return { error: "Line " + lineNum + ": invalid Angle value." };
      }
      angle = Math.round(clampNum(parsedAngle, -45, 45));
    }

    if (mode === "crosshair" && (fields.dir !== undefined || fields.angle !== undefined)) {
      if (fields.angle !== undefined && angle !== 0) {
        return { error: "Line " + lineNum + ": Angle applies only in Line mode." };
      }
    }

    if (mode === "line" && !hasElectrodeLineFeature()) {
      return { error: "Line " + lineNum + ": Line mode is not available on this atlas." };
    }

    return {
      target: {
        ml: parseFloat(fields.ml),
        ap: parseFloat(fields.ap),
        dv: parseFloat(fields.dv),
        mode: mode,
        dir: dir,
        angle: angle,
      },
    };
  }

  function parseTargetText(text) {
    var lines = String(text).split(/\r?\n/);
    var targets = [];
    var errors = [];
    var lineNum = 0;
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i].trim();
      if (!raw || raw.charAt(0) === "#") continue;
      lineNum += 1;
      var result = parseTargetLine(raw, lineNum);
      if (result.error) errors.push(result.error);
      else targets.push(result.target);
    }
    return { targets: targets, errors: errors };
  }

  function serializeTarget(t) {
    var parts = [
      "ML=" + formatCoordForInput(t.ml),
      "AP=" + formatCoordForInput(t.ap),
      "DV=" + formatCoordForInput(t.dv),
    ];
    if (t.mode === "line") {
      parts.push("Mode=Line");
      if (t.dir === "ap") parts.push("Dir=AP");
      if (t.angle !== 0) parts.push("Angle=" + String(t.angle));
    }
    return parts.join(", ");
  }

  function serializeTargetText(targets) {
    var out = [];
    for (var i = 0; i < targets.length; i++) {
      out.push(serializeTarget(targets[i]));
    }
    return out.join("\n");
  }

  function serializeCurrentSettings() {
    var nums = readInputsAsNumbers();
    if (!nums) return "";
    var t = {
      ml: nums.ml,
      ap: nums.ap,
      dv: nums.dv,
      mode: "crosshair",
      dir: "ml",
      angle: 0,
    };
    if (isElectrodeLineActive()) {
      t.mode = "line";
      t.dir = entryDirection;
      t.angle = entryAngleDeg;
    }
    return serializeTarget(t);
  }

  function buildMultiModeUrl() {
    return window.location.origin + window.location.pathname + "?view=multi";
  }

  function standardMarkerColor() {
    try {
      var body = document.body;
      if (!body) return "#ef4444";
      var raw = getComputedStyle(body).getPropertyValue("--atlas-marker-line").trim();
      return raw || "#ef4444";
    } catch (e) {
      return "#ef4444";
    }
  }

  function targetColor(index) {
    if (!isMultiInputMode()) return standardMarkerColor();
    var i = Math.max(0, Math.min(index, PARULA_16.length - 1));
    return PARULA_16[i];
  }

  function extractRawTargetLines(text) {
    var lines = String(text).split(/\r?\n/);
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i].trim();
      if (!raw || raw.charAt(0) === "#") continue;
      out.push(raw);
    }
    return out;
  }

  function hideTargetLegend() {
    var el = document.getElementById("atlas-target-legend");
    if (!el) return;
    el.innerHTML = "";
    el.hidden = true;
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function updatePrintSettings() {
    var el = document.getElementById("atlas-print-settings");
    if (!el) return;

    if (isMultiInputMode()) {
      var ta = document.getElementById("atlas-multi-input");
      if (!ta || !String(ta.value).trim()) {
        el.innerHTML = "";
        return;
      }
      var parsed = parseTargetText(ta.value);
      var rawLines = extractRawTargetLines(ta.value);
      var count = parsed.targets.length;
      var title = count === 1 ? "1 target" : count + " targets";
      if (parsed.errors.length) title = "Multiple targets";

      var rows = [
        '<p class="atlas-print-settings__mode">Multiple mode · ' + escapeHtml(title) + "</p>",
        '<div class="atlas-print-settings__targets">',
      ];
      for (var i = 0; i < parsed.targets.length; i++) {
        var lineText = rawLines[i] || serializeTarget(parsed.targets[i]);
        rows.push(
          '<p class="atlas-print-settings__target">' +
            '<span class="atlas-print-settings__swatch" style="background-color:' +
            targetColor(i) +
            '"></span>' +
            '<span class="atlas-print-settings__target-text">' +
            escapeHtml(lineText) +
            "</span></p>"
        );
      }
      rows.push("</div>");
      el.innerHTML = rows.join("");
      return;
    }

    var nums = readInputsAsNumbers();
    if (!nums) {
      el.innerHTML = "";
      return;
    }

    var rows = [
      '<p class="atlas-print-settings__mode">Standard mode</p>',
      '<p class="atlas-print-settings__row"><span class="atlas-print-settings__label">Coordinates</span> ' +
        "ML " +
        escapeHtml(formatCoordReadout(nums.ml)) +
        " mm · AP " +
        escapeHtml(formatCoordReadout(nums.ap)) +
        " mm · DV " +
        escapeHtml(formatCoordReadout(nums.dv)) +
        " mm</p>",
    ];

    if (hasElectrodeLineFeature()) {
      var markerParts = [isElectrodeLineActive() ? "Line" : "Crosshair"];
      if (isElectrodeLineActive()) {
        markerParts.push(entryDirection === "ap" ? "Dir AP" : "Dir ML");
        markerParts.push("Angle " + String(entryAngleDeg) + "°");
        var readoutEl = document.getElementById("atlas-line-readout-" + entryDirection);
        if (readoutEl && readoutEl.textContent) {
          markerParts.push(readoutEl.textContent);
        }
      }
      rows.push(
        '<p class="atlas-print-settings__row"><span class="atlas-print-settings__label">Marker</span> ' +
          escapeHtml(markerParts.join(" · ")) +
          "</p>"
      );
    }

    var sel = document.getElementById("atlas-region-select");
    if (sel && sel.selectedIndex > 0 && sel.options[sel.selectedIndex]) {
      rows.push(
        '<p class="atlas-print-settings__row"><span class="atlas-print-settings__label">Region</span> ' +
          escapeHtml(sel.options[sel.selectedIndex].text) +
          "</p>"
      );
    }

    el.innerHTML = rows.join("");
  }

  function renderTargetLegend(targets, rawLines) {
    var el = document.getElementById("atlas-target-legend");
    if (!el) return;
    el.innerHTML = "";
    for (var i = 0; i < targets.length; i++) {
      var row = document.createElement("div");
      row.className = "atlas-target-legend__item";
      var swatch = document.createElement("span");
      swatch.className = "atlas-target-legend__swatch";
      swatch.style.backgroundColor = targetColor(i);
      var text = document.createElement("span");
      text.className = "atlas-target-legend__text";
      text.textContent = rawLines[i] || serializeTarget(targets[i]);
      row.appendChild(swatch);
      row.appendChild(text);
      el.appendChild(row);
    }
    el.hidden = targets.length === 0;
    updatePrintSettings();
  }

  function depthLookupForPlane(plane, target) {
    if (plane === "coronal") return target.ap;
    if (plane === "sagittal") return target.ml;
    return horizontalLookupFromDv(target.dv);
  }

  function formatPlanePanelTitle(plane, row) {
    var label = plane.charAt(0).toUpperCase() + plane.slice(1);
    if (plane === "coronal") return label + " · AP " + formatCoordForInput(row.depth) + " mm";
    if (plane === "sagittal") return label + " · ML " + formatCoordForInput(row.depth) + " mm";
    return label + " · DV " + formatCoordForInput(-row.depth) + " mm";
  }

  function groupTargetsByPlate(targets, rows, imageUrlFn) {
    var planes = panelOrder();
    var map = {};
    for (var i = 0; i < targets.length; i++) {
      var tgt = targets[i];
      for (var p = 0; p < planes.length; p++) {
        var plane = planes[p];
        var lookup = depthLookupForPlane(plane, tgt);
        var row = closestByType(rows, plane, lookup);
        if (!row) continue;
        var key = plane + ":" + row.index;
        if (!map[key]) {
          map[key] = {
            plane: plane,
            row: row,
            imageUrl: imageUrlFn(row.index),
            cal: { x0: row.x0, y0: row.y0, pxx: row.pxx, pxy: row.pxy },
            targets: [],
          };
        }
        map[key].targets.push({ target: tgt, targetIndex: i });
      }
    }

    var keys = Object.keys(map);
    keys.sort(function (a, b) {
      var ga = map[a];
      var gb = map[b];
      var pa = planes.indexOf(ga.plane);
      var pb = planes.indexOf(gb.plane);
      if (pa !== pb) return pa - pb;
      return ga.row.depth - gb.row.depth;
    });
    var out = [];
    for (var k = 0; k < keys.length; k++) out.push(map[keys[k]]);
    return out;
  }

  function targetPositionOnPlane(plane, cal, ml, ap, dv) {
    var d = Math.abs(dv);
    if (plane === "coronal") {
      return { x: cal.x0 + coronalMlSign() * ml * cal.pxx, y: cal.y0 + d * cal.pxy };
    }
    if (plane === "sagittal") {
      return { x: cal.x0 - ap * cal.pxx, y: cal.y0 + d * cal.pxy };
    }
    return { x: cal.x0 - ap * cal.pxx, y: cal.y0 - ml * cal.pxy };
  }

  function clearSvgTargets(svg) {
    var g = svg.querySelector(".atlas-targets");
    if (g) g.innerHTML = "";
  }

  function overlayMetric(name, fallback) {
    try {
      var body = document.body;
      if (!body) return fallback;
      var raw = getComputedStyle(body).getPropertyValue(name).trim();
      var n = parseFloat(raw);
      return Number.isFinite(n) ? n : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function drawCrosshairOnSvg(g, x, y, color) {
    var arm = overlayMetric("--atlas-overlay-crosshair-arm", 12);
    var sw = overlayMetric("--atlas-overlay-stroke", 2.5);
    var dotR = overlayMetric("--atlas-overlay-dot-r", 4);
    var coords = [
      [x - arm, y, x + arm, y],
      [x, y - arm, x, y + arm],
    ];
    for (var i = 0; i < coords.length; i++) {
      var ln = document.createElementNS("http://www.w3.org/2000/svg", "line");
      ln.setAttribute("x1", String(coords[i][0]));
      ln.setAttribute("y1", String(coords[i][1]));
      ln.setAttribute("x2", String(coords[i][2]));
      ln.setAttribute("y2", String(coords[i][3]));
      ln.setAttribute("stroke", color);
      ln.setAttribute("stroke-width", String(sw));
      ln.setAttribute("stroke-linecap", "round");
      ln.setAttribute("class", "atlas-overlay-crosshair");
      g.appendChild(ln);
    }
    var dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", String(x));
    dot.setAttribute("cy", String(y));
    dot.setAttribute("r", String(dotR));
    dot.setAttribute("fill", color);
    dot.setAttribute("class", "atlas-overlay-dot");
    g.appendChild(dot);
  }

  function drawLineTargetOnSvg(g, plane, cal, target, color) {
    var stroke = overlayMetric("--atlas-overlay-stroke", 2.5);
    var tipR = overlayMetric("--atlas-overlay-tip-r", 5);
    var ends = electrodeLineEndpoints(
      plane,
      cal,
      target.ml,
      target.ap,
      target.dv,
      target.angle,
      target.dir
    );
    if (ends) {
      var ln = document.createElementNS("http://www.w3.org/2000/svg", "line");
      ln.setAttribute("x1", String(ends.x1));
      ln.setAttribute("y1", String(ends.y1));
      ln.setAttribute("x2", String(ends.x2));
      ln.setAttribute("y2", String(ends.y2));
      ln.setAttribute("stroke", color);
      ln.setAttribute("stroke-width", String(stroke));
      ln.setAttribute("stroke-linecap", "round");
      ln.setAttribute("class", "atlas-overlay-line");
      g.appendChild(ln);
    }
    var pos = targetPositionOnPlane(plane, cal, target.ml, target.ap, target.dv);
    var tip = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    tip.setAttribute("cx", String(pos.x));
    tip.setAttribute("cy", String(pos.y));
    tip.setAttribute("r", String(tipR));
    tip.setAttribute("fill", color);
    tip.setAttribute("class", "atlas-overlay-dot");
    g.appendChild(tip);
  }

  function drawTargetsOnPanel(svg, img, plane, cal, drawList) {
    function apply() {
      var nw = img.naturalWidth;
      var nh = img.naturalHeight;
      if (!nw || !nh || !svg || !cal) return;
      svg.setAttribute("viewBox", "0 0 " + nw + " " + nh);
      svg.setAttribute("width", "100%");
      svg.setAttribute("height", "100%");
      clearSvgTargets(svg);
      var g = svg.querySelector(".atlas-targets");
      if (!g) return;
      for (var i = 0; i < drawList.length; i++) {
        var item = drawList[i];
        var target = item.target || item;
        var colorIndex =
          item.targetIndex != null
            ? item.targetIndex
            : item.colorIndex != null
              ? item.colorIndex
              : i;
        var color = targetColor(colorIndex);
        if (target.mode === "line" && lastConfig && lastConfig.electrodeLine) {
          drawLineTargetOnSvg(g, plane, cal, target, color);
        } else {
          var pos = targetPositionOnPlane(plane, cal, target.ml, target.ap, target.dv);
          drawCrosshairOnSvg(g, pos.x, pos.y, color);
        }
      }
    }

    if (img.complete && img.naturalWidth) apply();
    else img.addEventListener("load", apply, { once: true });
  }

  function loadImageToElement(img, imageUrl) {
    if (!img) return Promise.resolve();

    if (!atlasUrlIsObfuscated(imageUrl)) {
      revokeAtlasBlobUrl(img);
      img.src = imageUrl;
      return new Promise(function (resolve) {
        if (img.complete && img.naturalWidth) resolve();
        else img.addEventListener("load", function () { resolve(); }, { once: true });
      });
    }

    revokeAtlasBlobUrl(img);
    return fetch(imageUrl, { credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) throw new Error("Failed to load image: " + imageUrl);
        return r.arrayBuffer();
      })
      .then(function (buf) {
        var decoded = atlasXorDecodeBuffer(buf);
        var blob = new Blob([decoded]);
        var objUrl = URL.createObjectURL(blob);
        img.setAttribute("data-atlas-blob-url", objUrl);
        return new Promise(function (resolve, reject) {
          img.onload = function () {
            img.onload = null;
            resolve();
          };
          img.onerror = function () {
            img.onerror = null;
            try {
              URL.revokeObjectURL(objUrl);
            } catch (e2) {}
            img.removeAttribute("data-atlas-blob-url");
            reject(new Error("Image failed to load"));
          };
          img.src = objUrl;
        });
      });
  }

  function renderMultiAtlasView(targets) {
    if (!lastRows || !lastConfig || !lastConfig.getImageUrl) return Promise.resolve();
    var groups = groupTargetsByPlate(targets, lastRows, lastConfig.getImageUrl);
    var container = document.getElementById("atlas-panels-multi");
    var single = document.getElementById("atlas-panels-single");
    if (!container) return Promise.resolve();

    if (single) single.hidden = true;
    container.hidden = false;
    container.innerHTML = "";

    var tasks = [];
    for (var g = 0; g < groups.length; g++) {
      (function (group, idx) {
        var panelId = "multi-" + group.plane + "-" + group.row.index + "-" + idx;
        var section = document.createElement("section");
        section.className = "atlas-panel page-break";
        var title = formatPlanePanelTitle(group.plane, group.row);
        section.innerHTML =
          '<h2 class="atlas-panel__title"><span class="atlas-panel__title-text">' +
          title +
          '</span></h2><div class="figure"><svg class="atlas-overlay-svg" id="' +
          panelId +
          '-overlay-svg" data-plane="' +
          group.plane +
          '" aria-hidden="true" focusable="false"><g class="atlas-targets"></g></svg><img id="' +
          panelId +
          '-img" src="" alt="' +
          group.plane +
          ' section"></div>';
        container.appendChild(section);

        var imgId = panelId + "-img";
        var svgId = panelId + "-overlay-svg";
        tasks.push(
          loadImageToElement(document.getElementById(imgId), group.imageUrl)
            .then(function () {
              var img = document.getElementById(imgId);
              var svg = document.getElementById(svgId);
              drawTargetsOnPanel(svg, img, group.plane, group.cal, group.targets);
            })
            .catch(function (e) {
              console.error(e);
            })
        );
      })(groups[g], g);
    }
    return Promise.all(tasks);
  }

  function applyInputModeUi() {
    var multi = isMultiInputMode();
    document.body.classList.toggle("lab-brain-atlas--input-multi", multi);
    var std = document.getElementById("atlas-coord-standard");
    var mul = document.getElementById("atlas-coord-multi");
    var single = document.getElementById("atlas-panels-single");
    var multiPanels = document.getElementById("atlas-panels-multi");
    if (std) std.hidden = multi;
    if (mul) mul.hidden = !multi;
    if (single && multi) single.hidden = true;
    if (single && !multi) single.hidden = false;
    if (multiPanels && !multi) multiPanels.hidden = true;
    if (!multi) hideTargetLegend();

    var radios = document.querySelectorAll('input[name="atlas-input-mode"]');
    for (var i = 0; i < radios.length; i++) {
      radios[i].checked = radios[i].value === (multi ? "multi" : "standard");
    }

    var ta = document.getElementById("atlas-multi-input");
    if (multi && ta) {
      var stored = readMultiTextFromSession();
      if (stored) ta.value = stored;
    }
    updateCopyMenuUi();
    syncInputHelpVisibility();
  }

  function syncInputHelpVisibility() {
    var multi = isMultiInputMode();
    var sections = document.querySelectorAll(".atlas-input-help__section[data-help-mode]");
    for (var i = 0; i < sections.length; i++) {
      var mode = sections[i].getAttribute("data-help-mode");
      if (mode === "standard") sections[i].hidden = multi;
      else if (mode === "multi") sections[i].hidden = !multi;
    }
  }

  function initInputHelp() {
    var details = document.querySelector(".atlas-input-help");
    if (!details) return;
    syncInputHelpVisibility();
    document.addEventListener("click", function (e) {
      if (!details.open) return;
      if (!details.contains(e.target)) details.open = false;
    });
  }

  function initMultiDemos() {
    var demos = document.getElementById("atlas-multi-demos");
    var ta = document.getElementById("atlas-multi-input");
    if (!demos || !ta) return;

    demos.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-demo]");
      if (!btn) return;
      var key = btn.getAttribute("data-demo");
      var text = buildMultiDemoText(key);
      if (!text) return;
      ta.value = text;
      writeMultiTextToSession(ta.value);
      ta.removeAttribute("aria-invalid");
      ta.removeAttribute("aria-describedby");
      var errEl = document.getElementById("atlas-form-error");
      if (errEl) {
        errEl.textContent = "";
        errEl.hidden = true;
      }
      applyMultiCoords();
      notifyMultiTargetsChanged();
    });
  }

  function updateCopyMenuUi() {
    var multi = isMultiInputMode();
    var standardItems = document.querySelectorAll(".atlas-copy__menu-item--standard");
    var multiItems = document.querySelectorAll(".atlas-copy__menu-item--multi");
    for (var i = 0; i < standardItems.length; i++) {
      standardItems[i].setAttribute("aria-hidden", multi ? "true" : "false");
    }
    for (var j = 0; j < multiItems.length; j++) {
      multiItems[j].setAttribute("aria-hidden", multi ? "false" : "true");
    }
  }

  function formatAtlasDownloadFilename() {
    var d = new Date();
    var p = function (n) {
      return String(n).padStart(2, "0");
    };
    var prefix =
      lastConfig && lastConfig.downloadPrefix ? lastConfig.downloadPrefix : "RatBrainAtlas";
    return (
      prefix +
      "_" +
      d.getFullYear() +
      p(d.getMonth() + 1) +
      p(d.getDate()) +
      p(d.getHours()) +
      p(d.getMinutes()) +
      ".txt"
    );
  }

  function downloadMultiTargetText(onSuccess, onError) {
    var ta = document.getElementById("atlas-multi-input");
    var text = ta ? ta.value : "";
    try {
      var blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = formatAtlasDownloadFilename();
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      if (onSuccess) onSuccess();
    } catch (err) {
      if (onError) onError(err);
    }
  }

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

  function entryAngleForDirection(angleDeg, direction, plane) {
    var sign = direction === "ml" ? -1 : 1;
    if (plane === "coronal" && direction === "ml" && coronalMlSign() === -1) {
      sign = -sign;
    }
    return sign * angleDeg;
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
    q.delete("view");
    if (markerModeState === "line") {
      q.set("mode", "line");
      if (entryDirection === "ap") q.set("dir", "ap");
      else q.delete("dir");
      if (entryAngleDeg !== 0) q.set("angle", String(entryAngleDeg));
      else q.delete("angle");
      return;
    }
    q.delete("mode");
    q.delete("dir");
    q.delete("angle");
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
    if (isMultiInputMode()) return;
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
    updatePrintSettings();
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
    updatePrintSettings();
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
    var effAngle = entryAngleForDirection(angleDeg, direction, plane);
    var mlEntry = computeElectrodeEntryMl(ml, dv, effAngle);
    var apEntry = computeElectrodeEntryAp(ap, dv, effAngle);
    var cSign = coronalMlSign();

    if (direction === "ml") {
      if (plane === "coronal") {
        var xEntryMl = cal.x0 + cSign * mlEntry * cal.pxx;
        var yEntryMl = cal.y0;
        var xTargetMl = cal.x0 + cSign * ml * cal.pxx;
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
        var xCorAp = cal.x0 + cSign * ml * cal.pxx;
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
    if (!svg || !data.plane || !data.cal) return;
    var drawList = [
      {
        target: {
          ml: data.targetMl,
          ap: data.targetAp,
          dv: data.targetDv,
          mode: "line",
          dir: entryDirection,
          angle: angleDeg,
        },
        colorIndex: 0,
      },
    ];
    drawTargetsOnPanel(svg, img, data.plane, data.cal, drawList);
  }

  function layoutPanelMarkers(prefix, data) {
    var img = document.getElementById(prefix + "-img");
    var svg = document.getElementById(prefix + "-overlay-svg");
    if (!img || !svg || !data || !data.plane || !data.cal) return;

    var drawList = [
      {
        target: {
          ml: data.targetMl,
          ap: data.targetAp,
          dv: data.targetDv,
          mode: isElectrodeLineActive() ? "line" : "crosshair",
          dir: entryDirection,
          angle: entryAngleDeg,
        },
        colorIndex: 0,
      },
    ];
    drawTargetsOnPanel(svg, img, data.plane, data.cal, drawList);
  }

  function refreshLineReadoutFromPayload() {
    if (!isElectrodeLineActive() || !lastAtlasPayload) return;
    var cor = lastAtlasPayload.atlas.coronal;
    if (!cor || cor.targetMl === undefined || cor.targetAp === undefined) return;
    var entryValue;
    var effAngle = entryAngleForDirection(
      entryAngleDeg,
      entryDirection,
      entryDirection === "ml" ? "coronal" : "sagittal"
    );
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
    if (!img) return Promise.resolve();

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

  function allStandardCoordsValid(inputs) {
    for (var i = 0; i < inputs.length; i++) {
      if (!inputs[i] || !isValidFloatString(inputs[i].value)) return false;
    }
    return true;
  }

  function applyStandardCoords() {
    if (isMultiInputMode()) return false;
    if (!lastRows || !lastConfig) return false;
    var mlEl = document.getElementById("input-ml");
    var apEl = document.getElementById("input-ap");
    var dvEl = document.getElementById("input-dv");
    if (!mlEl || !apEl || !dvEl) return false;
    if (!isValidFloatString(mlEl.value) || !isValidFloatString(apEl.value) || !isValidFloatString(dvEl.value)) {
      return false;
    }
    replaceAtlasUrl();
    redrawAtlasFromInputs();
    updatePrintSettings();
    return true;
  }

  function clearMultiPanels() {
    var multiPanels = document.getElementById("atlas-panels-multi");
    if (multiPanels) {
      multiPanels.hidden = true;
      multiPanels.innerHTML = "";
    }
  }

  function applyMultiCoords() {
    if (!isMultiInputMode()) return false;
    if (!lastRows || !lastConfig) return false;
    var ta = document.getElementById("atlas-multi-input");
    if (!ta) return false;

    var text = ta.value;
    if (!String(text).trim()) {
      hideTargetLegend();
      clearMultiPanels();
      writeMultiTextToSession("");
      notifyMultiTargetsChanged();
      updatePrintSettings();
      return true;
    }

    var parsed = parseTargetText(text);
    if (parsed.errors.length || !parsed.targets.length || parsed.targets.length > MAX_TARGETS) {
      return false;
    }

    writeMultiTextToSession(text);
    var rawLines = extractRawTargetLines(text);
    renderTargetLegend(parsed.targets, rawLines);
    renderMultiAtlasView(parsed.targets).catch(function (err) {
      console.error(err);
    });
    notifyMultiTargetsChanged();
    updatePrintSettings();
    return true;
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
      var ta = document.getElementById("atlas-multi-input");
      if (ta) {
        ta.removeAttribute("aria-invalid");
        ta.removeAttribute("aria-describedby");
      }
      if (errEl) {
        errEl.textContent = "";
        errEl.hidden = true;
      }
    }

    function cancelMultiRedrawDebounce() {
      if (multiRedrawDebounceId !== null) {
        window.clearTimeout(multiRedrawDebounceId);
        multiRedrawDebounceId = null;
      }
    }

    function scheduleMultiRedraw() {
      if (!isMultiInputMode()) return;
      cancelMultiRedrawDebounce();
      multiRedrawDebounceId = window.setTimeout(function () {
        multiRedrawDebounceId = null;
        if (applyMultiCoords()) {
          clearFieldErrors();
        }
      }, 300);
    }

    function applyMultiCoordsWithValidation() {
      if (!isMultiInputMode()) return;
      cancelMultiRedrawDebounce();
      clearFieldErrors();

      var ta = document.getElementById("atlas-multi-input");
      if (!ta) return;

      var text = ta.value;
      if (!String(text).trim()) {
        hideTargetLegend();
        clearMultiPanels();
        writeMultiTextToSession("");
        return;
      }

      var parsed = parseTargetText(text);
      if (parsed.errors.length) {
        hideTargetLegend();
        if (errEl) {
          errEl.textContent = parsed.errors.join(" ");
          errEl.hidden = false;
        }
        ta.setAttribute("aria-invalid", "true");
        ta.setAttribute("aria-describedby", "atlas-form-error");
        return;
      }
      if (!parsed.targets.length) {
        hideTargetLegend();
        if (errEl) {
          errEl.textContent = "Enter at least one target line.";
          errEl.hidden = false;
        }
        ta.setAttribute("aria-invalid", "true");
        ta.setAttribute("aria-describedby", "atlas-form-error");
        return;
      }
      if (parsed.targets.length > MAX_TARGETS) {
        hideTargetLegend();
        if (errEl) {
          errEl.textContent = "Maximum " + MAX_TARGETS + " targets supported.";
          errEl.hidden = false;
        }
        ta.setAttribute("aria-invalid", "true");
        ta.setAttribute("aria-describedby", "atlas-form-error");
        return;
      }

      applyMultiCoords();
    }

    function cancelStandardRedrawDebounce() {
      if (standardRedrawDebounceId !== null) {
        window.clearTimeout(standardRedrawDebounceId);
        standardRedrawDebounceId = null;
      }
    }

    function scheduleStandardRedraw() {
      if (isMultiInputMode()) return;
      if (!allStandardCoordsValid(inputs)) return;
      cancelStandardRedrawDebounce();
      standardRedrawDebounceId = window.setTimeout(function () {
        standardRedrawDebounceId = null;
        applyStandardCoords();
      }, 300);
    }

    function applyStandardCoordsWithValidation() {
      if (isMultiInputMode()) return;
      cancelStandardRedrawDebounce();
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
        if (errEl) {
          errEl.textContent =
            "Enter a valid number for ML, AP, and DV (decimals allowed, e.g. 0.43 or .43).";
          errEl.hidden = false;
        }
        firstBad.focus();
        return;
      }
      applyStandardCoords();
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (isMultiInputMode()) {
        applyMultiCoordsWithValidation();
      } else {
        applyStandardCoordsWithValidation();
      }
    });

    for (var k = 0; k < inputs.length; k++) {
      (function (inp) {
        if (!inp) return;
        inp.addEventListener("input", function () {
          if (inp.getAttribute("aria-invalid") === "true") clearFieldErrors();
          scheduleStandardRedraw();
        });
        inp.addEventListener("blur", function () {
          applyStandardCoordsWithValidation();
        });
        inp.addEventListener("keydown", function (e) {
          if (e.key === "Enter") {
            e.preventDefault();
            applyStandardCoordsWithValidation();
          }
        });
      })(inputs[k]);
    }

    var multiTa = document.getElementById("atlas-multi-input");
    if (multiTa) {
      multiTa.addEventListener("input", function () {
        writeMultiTextToSession(multiTa.value);
        if (multiTa.getAttribute("aria-invalid") === "true") clearFieldErrors();
        scheduleMultiRedraw();
        notifyMultiTargetsChanged();
      });
      multiTa.addEventListener("blur", function () {
        applyMultiCoordsWithValidation();
      });
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
  var multiTargetsChangeListeners = [];

  function notifyMultiTargetsChanged() {
    for (var i = 0; i < multiTargetsChangeListeners.length; i++) {
      try {
        multiTargetsChangeListeners[i]();
      } catch (e) {}
    }
  }
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
    var multiPanels = document.getElementById("atlas-panels-multi");
    var single = document.getElementById("atlas-panels-single");
    if (multiPanels) {
      multiPanels.hidden = true;
      multiPanels.innerHTML = "";
    }
    if (single) single.hidden = false;
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

        applyInputModeUi();

        var params = new URLSearchParams(window.location.search);
        var chain = Promise.resolve();

        if (isMultiInputMode()) {
          var storedText = readMultiTextFromSession();
          if (storedText) {
            var ta = document.getElementById("atlas-multi-input");
            if (ta) ta.value = storedText;
            var parsed = parseTargetText(storedText);
            if (parsed.targets.length && !parsed.errors.length && parsed.targets.length <= MAX_TARGETS) {
              renderTargetLegend(parsed.targets, extractRawTargetLines(storedText));
              chain = renderMultiAtlasView(parsed.targets);
            }
          }
        } else {
          syncInputsFromParams(params);
          if (config.queryTitle !== false) applyQueryTitle(params);

          var nums = readInputsAsNumbers();
          if (nums) {
            chain = renderAtlasView(lastRows, lastConfig, nums.ap, nums.ml, nums.dv);
          }
        }
        return chain;
      })
      .then(function () {
        if (!isMultiInputMode()) {
          syncMarkerUi();
          replaceAtlasUrl();
          initSliceNavigation();
          updateSliceNavButtonStates();
        }
        updatePrintSettings();
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

  function initCopyMenu() {
    var details = document.querySelector(".atlas-copy__details");
    var statusEl = document.getElementById("atlas-copy-status");
    if (!details) return;

    function showStatus(msg, isError) {
      if (!statusEl) return;
      statusEl.textContent = msg;
      statusEl.hidden = false;
      if (isError) statusEl.classList.add("atlas-copy__status--error");
      else statusEl.classList.remove("atlas-copy__status--error");
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

    function closeMenu() {
      details.open = false;
    }

    var items = details.querySelectorAll("[data-copy-action]");
    for (var i = 0; i < items.length; i++) {
      items[i].addEventListener("click", function (e) {
        e.preventDefault();
        var action = this.getAttribute("data-copy-action");
        if (action === "link") {
          flushReplaceAtlasUrl();
          copyTextToClipboard(
            buildAtlasShareUrl(),
            function () {
              showStatus("Link copied");
              closeMenu();
            },
            function () {
              showStatus("Could not copy link", true);
            }
          );
          return;
        }
        if (action === "text-for-multi") {
          copyTextToClipboard(
            serializeCurrentSettings(),
            function () {
              showStatus("Text copied");
              closeMenu();
            },
            function () {
              showStatus("Could not copy", true);
            }
          );
          return;
        }
        if (action === "text") {
          var ta = document.getElementById("atlas-multi-input");
          copyTextToClipboard(
            ta ? ta.value : "",
            function () {
              showStatus("Text copied");
              closeMenu();
            },
            function () {
              showStatus("Could not copy", true);
            }
          );
          return;
        }
        if (action === "download") {
          downloadMultiTargetText(
            function () {
              showStatus("Download started");
              closeMenu();
            },
            function () {
              showStatus("Could not download", true);
            }
          );
        }
      });
    }

    updateCopyMenuUi();
  }

  function initInputModeToggle() {
    var radios = document.querySelectorAll('input[name="atlas-input-mode"]');
    if (!radios.length) return;

    applyInputModeUi();

    for (var i = 0; i < radios.length; i++) {
      radios[i].addEventListener("change", function () {
        if (!this.checked) return;
        var path = window.location.pathname;
        if (this.value === "multi") {
          var ta = document.getElementById("atlas-multi-input");
          if (ta && ta.value) writeMultiTextToSession(ta.value);
          window.location.href = path + "?view=multi";
        } else {
          window.location.href = path;
        }
      });
    }
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
    if (!modeRadios.length || isMultiInputMode()) return;

    var angleInputs = document.querySelectorAll(".atlas-panel-angle__range");
    var directionRadios = document.querySelectorAll('input[name="atlas-entry-direction"]');

    markerModeState = "crosshair";
    entryDirection = "ml";
    entryAngleDeg = 0;

    var urlMarkerState = isMultiInputMode() ? null : readMarkerStateFromUrl();
    if (urlMarkerState && urlMarkerState.mode) markerModeState = urlMarkerState.mode;
    else {
      try {
        var storedMode = localStorage.getItem(LS_MARKER_MODE);
        if (storedMode === "line" || storedMode === "crosshair") markerModeState = storedMode;
      } catch (e) {}
    }

    if (markerModeState === "line") {
      if (urlMarkerState && urlMarkerState.dir) entryDirection = urlMarkerState.dir;
      else {
        try {
          var storedDir = localStorage.getItem(LS_ENTRY_DIRECTION);
          if (storedDir === "ml" || storedDir === "ap") entryDirection = storedDir;
        } catch (e) {}
      }

      if (urlMarkerState && urlMarkerState.angle !== undefined) {
        entryAngleDeg = urlMarkerState.angle;
      } else {
        entryAngleDeg = Math.round(clampNum(readStoredNum(LS_ENTRY_ANGLE, 0), -45, 45));
      }
    } else {
      entryDirection = "ml";
      try {
        var storedDirCross = localStorage.getItem(LS_ENTRY_DIRECTION);
        if (storedDirCross === "ml" || storedDirCross === "ap") entryDirection = storedDirCross;
      } catch (e) {}
      entryAngleDeg = Math.round(clampNum(readStoredNum(LS_ENTRY_ANGLE, 0), -45, 45));
    }

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
    applyStandardCoords: applyStandardCoords,
    applyMultiCoords: applyMultiCoords,
    isMultiInputMode: isMultiInputMode,
    serializeTarget: serializeTarget,
    parseTargetText: parseTargetText,
    extractRawTargetLines: extractRawTargetLines,
    onAtlasCoordsChanged: function (fn) {
      if (typeof fn === "function") coordsChangeListeners.push(fn);
    },
    onMultiTargetsChanged: function (fn) {
      if (typeof fn === "function") multiTargetsChangeListeners.push(fn);
    },
  };

  function initRegionPresets() {
    var sel = document.getElementById("atlas-region-select");
    var ml = document.getElementById("input-ml");
    var ap = document.getElementById("input-ap");
    var dv = document.getElementById("input-dv");
    if (!sel || !ml || !ap || !dv) return;

    var EPS = 1e-4;

    function near(a, b) {
      return Math.abs(a - b) <= EPS;
    }

    function updateRegionSelectAppearance(index) {
      sel.classList.toggle("atlas-region-pick__select--named", index > 0);
    }

    function matchRegionIndex(mlVal, apVal, dvVal) {
      for (var i = 0; i < sel.options.length; i++) {
        var o = sel.options[i];
        if (!o.value) continue;
        var oml = parseFloat(o.getAttribute("data-ml"));
        var oap = parseFloat(o.getAttribute("data-ap"));
        var odv = parseFloat(o.getAttribute("data-dv"));
        if (
          Number.isFinite(oml) &&
          Number.isFinite(oap) &&
          Number.isFinite(odv) &&
          near(mlVal, oml) &&
          near(apVal, oap) &&
          near(dvVal, odv)
        ) {
          return i;
        }
      }
      return 0;
    }

    function syncSelectFromMultiText() {
      if (!isMultiInputMode()) return;
      var ta = document.getElementById("atlas-multi-input");
      if (!ta || !String(ta.value).trim()) {
        sel.selectedIndex = 0;
        updateRegionSelectAppearance(0);
        return;
      }

      var rawLines = extractRawTargetLines(ta.value);
      var parsed = parseTargetText(ta.value);
      if (rawLines.length !== 1 || parsed.targets.length !== 1 || parsed.errors.length) {
        sel.selectedIndex = 0;
        updateRegionSelectAppearance(0);
        return;
      }

      var t = parsed.targets[0];
      var idx = matchRegionIndex(t.ml, t.ap, t.dv);
      sel.selectedIndex = idx;
      updateRegionSelectAppearance(idx);
    }

    function syncSelectFromUrl() {
      if (isMultiInputMode()) {
        syncSelectFromMultiText();
        return;
      }
      var params = new URLSearchParams(window.location.search);
      if (!params.has("ml") && !params.has("ap") && !params.has("dv")) {
        sel.selectedIndex = 0;
        updateRegionSelectAppearance(0);
        return;
      }
      var nml = parseFloat(params.get("ml"));
      var nap = parseFloat(params.get("ap"));
      var ndv = parseFloat(params.get("dv"));
      if (!Number.isFinite(nml) || !Number.isFinite(nap) || !Number.isFinite(ndv)) {
        sel.selectedIndex = 0;
        updateRegionSelectAppearance(0);
        return;
      }
      var idx = matchRegionIndex(nml, nap, ndv);
      sel.selectedIndex = idx;
      updateRegionSelectAppearance(idx);
    }

    sel.addEventListener("change", function () {
      var opt = sel.selectedOptions[0];
      if (!opt) return;

      if (isMultiInputMode()) {
        var ta = document.getElementById("atlas-multi-input");
        if (!ta) return;
        if (!opt.value || opt.getAttribute("data-ap") === null) {
          ta.value = "";
          updateRegionSelectAppearance(0);
        } else {
          ta.value = serializeTarget({
            ml: parseFloat(opt.getAttribute("data-ml")),
            ap: parseFloat(opt.getAttribute("data-ap")),
            dv: parseFloat(opt.getAttribute("data-dv")),
            mode: "crosshair",
            dir: "ml",
            angle: 0,
          });
          updateRegionSelectAppearance(sel.selectedIndex);
        }
        applyMultiCoords();
        return;
      }

      if (!opt.value || opt.getAttribute("data-ap") === null) {
        ml.value = "0";
        ap.value = "0";
        dv.value = "0";
        updateRegionSelectAppearance(0);
      } else {
        ml.value = opt.getAttribute("data-ml") || "0";
        ap.value = opt.getAttribute("data-ap") || "0";
        dv.value = opt.getAttribute("data-dv") || "0";
        updateRegionSelectAppearance(sel.selectedIndex);
      }
      applyStandardCoords();
    });

    coordsChangeListeners.push(syncSelectFromUrl);
    multiTargetsChangeListeners.push(syncSelectFromMultiText);
    syncSelectFromUrl();
  }

  function initBrainAtlasUi() {
    initInputModeToggle();
    initMarkerModeControls();
    initCopyMenu();
    initInputHelp();
    initMultiDemos();
    initRegionPresets();
    initBrainAtlasFooter();
    updatePrintSettings();
    window.addEventListener("beforeprint", updatePrintSettings);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initBrainAtlasUi);
  } else {
    initBrainAtlasUi();
  }
})(typeof window !== "undefined" ? window : this);
