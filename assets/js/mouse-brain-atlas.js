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
        imageUrl: "images/Mouse_Brain_Atlas_" + cor.index + ".atlasbin",
        left: cor.x0 - ml * cor.pxx,
        top: cor.y0 + dv * cor.pxy,
        plane: "coronal",
        cal: { x0: cor.x0, y0: cor.y0, pxx: cor.pxx, pxy: cor.pxy },
        targetAp: ap,
        targetMl: ml,
        targetDv: dv,
      },
      sagittal: {
        imageUrl: "images/Mouse_Brain_Atlas_" + sag.index + ".atlasbin",
        left: sag.x0 + -ap * sag.pxx,
        top: sag.y0 + dv * sag.pxy,
        plane: "sagittal",
        cal: { x0: sag.x0, y0: sag.y0, pxx: sag.pxx, pxy: sag.pxy },
        targetAp: ap,
        targetMl: ml,
        targetDv: dv,
      },
    };
  }

  C.boot({
    csvUrl: "mouse-brain-atlas.csv",
    getAtlas: getAtlas,
    getImageUrl: function (index) {
      return "images/Mouse_Brain_Atlas_" + index + ".atlasbin";
    },
    panels: ["coronal", "sagittal"],
    coronalMlSign: -1,
    downloadPrefix: "MouseBrainAtlas",
    queryTitle: true,
    electrodeLine: true,
    multiTarget: true,
  });
})();
