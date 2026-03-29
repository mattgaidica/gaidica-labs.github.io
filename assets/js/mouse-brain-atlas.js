(function () {
  "use strict";

  var C = window.BrainAtlasCommon;

  /** Matches legacy PHP: coronal uses x0 - ml*pxx; sagittal matches rat convention. */
  function getAtlas(ap, ml, dv, rows) {
    dv = Math.abs(dv);

    var cor = C.closestByType(rows, "coronal", ap);
    var sag = C.closestByType(rows, "sagittal", ml);

    if (!cor || !sag) {
      throw new Error("Atlas CSV missing required section types.");
    }

    return {
      coronal: {
        imageUrl: "images/Mouse_Brain_Atlas_" + cor.index + ".jpg",
        left: cor.x0 - ml * cor.pxx,
        top: cor.y0 + dv * cor.pxy,
      },
      sagittal: {
        imageUrl: "images/Mouse_Brain_Atlas_" + sag.index + ".jpg",
        left: sag.x0 + -ap * sag.pxx,
        top: sag.y0 + dv * sag.pxy,
      },
    };
  }

  C.boot({
    csvUrl: "mouse-brain-atlas.csv",
    getAtlas: getAtlas,
    panels: ["coronal", "sagittal"],
    queryTitle: true,
  });

  function initMouseRegionPresets() {
    var form = document.getElementById("atlas-coord-form");
    var sel = document.getElementById("atlas-region-select");
    var ml = document.getElementById("input-ml");
    var ap = document.getElementById("input-ap");
    var dv = document.getElementById("input-dv");
    if (!form || !sel || !ml || !ap || !dv) return;

    var EPS = 1e-4;

    function near(a, b) {
      return Math.abs(a - b) <= EPS;
    }

    function syncSelectFromUrl() {
      var params = new URLSearchParams(window.location.search);
      if (!params.has("ml") && !params.has("ap") && !params.has("dv")) {
        sel.selectedIndex = 0;
        return;
      }
      var nml = parseFloat(params.get("ml"));
      var nap = parseFloat(params.get("ap"));
      var ndv = parseFloat(params.get("dv"));
      if (!Number.isFinite(nml) || !Number.isFinite(nap) || !Number.isFinite(ndv)) {
        sel.selectedIndex = 0;
        return;
      }
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
          near(nml, oml) &&
          near(nap, oap) &&
          near(ndv, odv)
        ) {
          sel.selectedIndex = i;
          return;
        }
      }
      sel.selectedIndex = 0;
    }

    sel.addEventListener("change", function () {
      var opt = sel.selectedOptions[0];
      if (!opt) return;
      if (!opt.value || opt.getAttribute("data-ap") === null) {
        ml.value = "0";
        ap.value = "0";
        dv.value = "0";
      } else {
        ml.value = opt.getAttribute("data-ml") || "0";
        ap.value = opt.getAttribute("data-ap") || "0";
        dv.value = opt.getAttribute("data-dv") || "0";
      }
      if (typeof form.requestSubmit === "function") {
        form.requestSubmit();
      } else {
        form.submit();
      }
    });

    if (C.onAtlasCoordsChanged) {
      C.onAtlasCoordsChanged(syncSelectFromUrl);
    }
    syncSelectFromUrl();
  }

  initMouseRegionPresets();
})();
