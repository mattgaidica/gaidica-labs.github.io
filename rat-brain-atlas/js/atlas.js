(function () {
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

  function getAtlas(ap, ml, dv, rows) {
    dv = Math.abs(dv);

    var cor = closestByType(rows, "coronal", ap);
    var sag = closestByType(rows, "sagittal", ml);
    var hor = closestByType(rows, "horizontal", -dv);

    if (!cor || !sag || !hor) {
      throw new Error("Atlas CSV missing required section types.");
    }

    return {
      coronal: {
        imageUrl: "images/Rat_Brain_Atlas_" + cor.index + ".jpg",
        left: cor.x0 + ml * cor.pxx,
        top: cor.y0 + dv * cor.pxy,
      },
      sagittal: {
        imageUrl: "images/Rat_Brain_Atlas_" + sag.index + ".jpg",
        left: sag.x0 + -ap * sag.pxx,
        top: sag.y0 + dv * sag.pxy,
      },
      horizontal: {
        imageUrl: "images/Rat_Brain_Atlas_" + hor.index + ".jpg",
        left: hor.x0 + -ap * hor.pxx,
        top: hor.y0 + -ml * hor.pxy,
      },
    };
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

  function main(rows) {
    var params = new URLSearchParams(window.location.search);
    var ap = parseCoord("ap", params);
    var ml = parseCoord("ml", params);
    var dv = parseCoord("dv", params);

    var apInput = document.getElementById("input-ap");
    var mlInput = document.getElementById("input-ml");
    var dvInput = document.getElementById("input-dv");
    if (mlInput) mlInput.value = params.has("ml") ? params.get("ml") : String(ml);
    if (apInput) apInput.value = params.has("ap") ? params.get("ap") : String(ap);
    if (dvInput) dvInput.value = params.has("dv") ? params.get("dv") : String(dv);

    var titleEl = document.getElementById("atlas-query-title");
    var titleParam = params.get("title");
    if (titleEl) {
      if (titleParam) {
        titleEl.textContent = titleParam;
        titleEl.hidden = false;
      } else {
        titleEl.textContent = "";
        titleEl.hidden = true;
      }
    }

    var atlas = getAtlas(ap, ml, dv, rows);
    applyPanel("coronal", atlas.coronal);
    applyPanel("sagittal", atlas.sagittal);
    applyPanel("horizontal", atlas.horizontal);
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

  function run() {
    fetch("rat-brain-atlas.csv", { credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) throw new Error("Failed to load atlas data.");
        return r.text();
      })
      .then(function (text) {
        main(parseCsv(text));
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

  function boot() {
    initFormValidation();
    run();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
