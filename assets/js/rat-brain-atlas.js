(function () {
  "use strict";

  var C = window.BrainAtlasCommon;

  function getAtlas(ap, ml, dv, rows) {
    dv = Math.abs(dv);

    var cor = C.closestByType(rows, "coronal", ap);
    var sag = C.closestByType(rows, "sagittal", ml);
    var hor = C.closestByType(rows, "horizontal", -dv);

    if (!cor || !sag || !hor) {
      throw new Error("Atlas CSV missing required section types.");
    }

    return {
      coronal: {
        imageUrl: "images/Rat_Brain_Atlas_" + cor.index + ".atlasbin",
        left: cor.x0 + ml * cor.pxx,
        top: cor.y0 + dv * cor.pxy,
        plane: "coronal",
        cal: { x0: cor.x0, y0: cor.y0, pxx: cor.pxx, pxy: cor.pxy },
        targetAp: ap,
        targetMl: ml,
        targetDv: dv,
      },
      sagittal: {
        imageUrl: "images/Rat_Brain_Atlas_" + sag.index + ".atlasbin",
        left: sag.x0 + -ap * sag.pxx,
        top: sag.y0 + dv * sag.pxy,
        plane: "sagittal",
        cal: { x0: sag.x0, y0: sag.y0, pxx: sag.pxx, pxy: sag.pxy },
        targetAp: ap,
        targetMl: ml,
        targetDv: dv,
      },
      horizontal: {
        imageUrl: "images/Rat_Brain_Atlas_" + hor.index + ".atlasbin",
        left: hor.x0 + -ap * hor.pxx,
        top: hor.y0 + -ml * hor.pxy,
        plane: "horizontal",
        cal: { x0: hor.x0, y0: hor.y0, pxx: hor.pxx, pxy: hor.pxy },
        targetAp: ap,
        targetMl: ml,
        targetDv: dv,
      },
    };
  }

  C.boot({
    csvUrl: "rat-brain-atlas.csv",
    getAtlas: getAtlas,
    getImageUrl: function (index) {
      return "images/Rat_Brain_Atlas_" + index + ".atlasbin";
    },
    panels: ["coronal", "sagittal", "horizontal"],
    queryTitle: true,
    electrodeLine: true,
    multiTarget: true,
  });

  function initRatRegionPresets() {
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
      if (!C.isMultiInputMode()) return;
      var ta = document.getElementById("atlas-multi-input");
      if (!ta || !String(ta.value).trim()) {
        sel.selectedIndex = 0;
        updateRegionSelectAppearance(0);
        return;
      }

      var rawLines = C.extractRawTargetLines(ta.value);
      var parsed = C.parseTargetText(ta.value);
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
      if (C.isMultiInputMode()) {
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

      if (C.isMultiInputMode()) {
        var ta = document.getElementById("atlas-multi-input");
        if (!ta) return;
        if (!opt.value || opt.getAttribute("data-ap") === null) {
          ta.value = "";
          updateRegionSelectAppearance(0);
        } else {
          ta.value = C.serializeTarget({
            ml: parseFloat(opt.getAttribute("data-ml")),
            ap: parseFloat(opt.getAttribute("data-ap")),
            dv: parseFloat(opt.getAttribute("data-dv")),
            mode: "crosshair",
            dir: "ml",
            angle: 0,
          });
          updateRegionSelectAppearance(sel.selectedIndex);
        }
        C.applyMultiCoords();
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
      C.applyStandardCoords();
    });

    if (C.onAtlasCoordsChanged) {
      C.onAtlasCoordsChanged(syncSelectFromUrl);
    }
    if (C.onMultiTargetsChanged) {
      C.onMultiTargetsChanged(syncSelectFromMultiText);
    }
    syncSelectFromUrl();
  }

  initRatRegionPresets();
})();
