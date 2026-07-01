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
    coronalMlSign: 1,
    downloadPrefix: "RatBrainAtlas",
    queryTitle: true,
    electrodeLine: true,
    multiTarget: true,
  });
})();
