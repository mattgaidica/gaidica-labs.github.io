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
})();
