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

  C.boot({
    csvUrl: "rat-brain-atlas.csv",
    getAtlas: getAtlas,
    panels: ["coronal", "sagittal", "horizontal"],
    queryTitle: true,
  });
})();
