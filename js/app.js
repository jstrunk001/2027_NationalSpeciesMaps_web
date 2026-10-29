// Observed plant ranges web map
//
// Reads data/species.json at start-up, then draws one species at a time
// from its cloud-optimized GeoTIFF (COG). The browser fetches only the COG
// tiles covering the screen at the current zoom, so adding species does not
// slow the page down. The data files are written by
// R/002e_national_species_maps_cog_web_map.qmd in the 2027_NationalSpeciesMaps
// project.

(function() {
  "use strict";

  // ---- 1. Settings ----

  // NLCD 2021 land cover shown in three bands (class codes from the NLCD
  // legend); the server only applies a custom style when the layer name in
  // the style carries its workspace prefix
  var NLCD_WORKSPACE = "mrlc_display";
  var NLCD_LAYER = "NLCD_2021_Land_Cover_L48";
  var NLCD_BANDS = [
    { band: "Forest", color: "#2e7d32", opacity: 0.75, classes: [41, 42, 43, 90] },
    { band: "Non-forest vegetation", color: "#d4a017", opacity: 0.75, classes: [52, 71, 81, 82, 95] },
    { band: "No vegetation / water / barren / developed", color: "#9e9e9e", opacity: 0.6, classes: [11, 12, 21, 22, 23, 24, 31] }
  ];

  var SPECIES_OPACITY = 0.85;
  var COUNTY_LABEL_MIN_ZOOM = 7;
  var DEFAULT_SPECIES = "PITA";


  // ---- 2. Helper functions ----

  // Convert "#rrggbb" to [r, g, b]
  function hexToRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // Build a 256-entry color lookup for one plant form: index = cell value.
  // 1-100 follow the form's low-middle-high ramp, 0 is semi-transparent
  // grey (surveyed, not recorded), and everything else (255 = blank) is
  // null, which the raster layer draws as transparent.
  function buildColorLookup(formRow, colZero) {
    var low = hexToRgb(formRow.col_low);
    var mid = hexToRgb(formRow.col_mid);
    var high = hexToRgb(formRow.col_high);
    var zero = hexToRgb(colZero);
    var lut = new Array(256).fill(null);
    lut[0] = "rgba(" + zero.join(",") + ",0.5)";
    for(var v = 1; v <= 100; v++) {
      var t = v / 100;
      var a = t <= 0.5 ? low : mid;
      var b = t <= 0.5 ? mid : high;
      var s = t <= 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
      var rgb = [0, 1, 2].map(function(k) { return Math.round(a[k] + s * (b[k] - a[k])); });
      lut[v] = "rgb(" + rgb.join(",") + ")";
    }
    return lut;
  }

  // Write the NLCD three-band style (an SLD document the WMS server applies
  // to each requested tile)
  function nlcdStyle() {
    var entries = "";
    NLCD_BANDS.forEach(function(b) {
      b.classes.forEach(function(c) {
        entries += '<ColorMapEntry color="' + b.color + '" quantity="' + c + '" opacity="' + b.opacity + '"/>';
      });
    });
    return '<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld">' +
      "<NamedLayer><Name>" + NLCD_WORKSPACE + ":" + NLCD_LAYER + "</Name><UserStyle><FeatureTypeStyle><Rule><RasterSymbolizer>" +
      '<ColorMap type="values"><ColorMapEntry color="#000000" quantity="0" opacity="0"/>' + entries +
      "</ColorMap></RasterSymbolizer></Rule></FeatureTypeStyle></UserStyle></NamedLayer></StyledLayerDescriptor>";
  }

  function absoluteUrl(path) {
    return new URL(path, window.location.href).href;
  }

  function fetchJson(path) {
    return fetch(path).then(function(r) {
      if(!r.ok) throw new Error("Could not load " + path + " (" + r.status + ")");
      return r.json();
    });
  }

  function el(tag, className, text) {
    var e = document.createElement(tag);
    if(className) e.className = className;
    if(text !== undefined) e.textContent = text;
    return e;
  }

  function numberWithCommas(n) {
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  // Read the species symbol from the address bar ("#sp=PITA"), so a view of
  // one species can be shared as a link
  function speciesFromHash() {
    var m = window.location.hash.match(/sp=([A-Za-z0-9]+)/);
    return m ? m[1].toUpperCase() : null;
  }


  // ---- 3. Map, panes, and base maps ----

  var map = L.map("map", { preferCanvas: true, zoomControl: true }).setView([38.5, -96], 4);

  // Drawing order, bottom to top: base map, ecoregions (overlayPane, 400),
  // species, plots, county lines, state lines, labels (markerPane, 600)
  map.createPane("speciesPane").style.zIndex = 410;
  map.createPane("plotsPane").style.zIndex = 430;
  map.createPane("countyPane").style.zIndex = 440;
  map.createPane("statePane").style.zIndex = 450;
  ["countyPane", "statePane"].forEach(function(p) { map.getPane(p).style.pointerEvents = "none"; });

  var baseMaps = {
    "Light map": L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 16, attribution: "Tiles &copy; Esri"
    }),
    "Orthophotos (USGS)": L.tileLayer("https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}", {
      maxNativeZoom: 16, maxZoom: 19, attribution: "USGS The National Map: Orthoimagery"
    }),
    "Orthophotos (Esri)": L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19, attribution: "Tiles &copy; Esri"
    }),
    "Topographic (USGS)": L.tileLayer("https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}", {
      maxNativeZoom: 16, maxZoom: 19, attribution: "USGS The National Map: Topo"
    })
  };
  baseMaps["Light map"].addTo(map);
  L.control.layers(baseMaps, null, { position: "topright", collapsed: true }).addTo(map);
  L.control.scale({ position: "bottomleft", imperial: true }).addTo(map);


  // ---- 4. Start-up: load the species list, then build everything else ----

  fetchJson("data/species.json").then(start).catch(function(err) {
    var box = el("div", "info", "The map data could not be loaded: " + err.message);
    box.style.cssText = "position:absolute; top:10px; left:50px; z-index:1000;";
    document.body.appendChild(box);
  });

  function start(meta) {
    var formRows = {};
    var colorLookups = {};
    meta.forms.forEach(function(f) {
      formRows[f.form] = f;
      colorLookups[f.form] = buildColorLookup(f, meta.col_zero);
    });
    var speciesBySymbol = {};
    meta.species.forEach(function(s) {
      s.label = s.common + " (" + s.symbol + ")";
      speciesBySymbol[s.symbol] = s;
    });


    // ---- 5. Species layer: one at a time, read from its COG ----

    var georasterCache = {};   // symbol -> Promise of a georaster
    var current = null;        // { species, layer, georaster }
    var requestId = 0;

    function loadGeoraster(sp) {
      if(!georasterCache[sp.symbol]) {
        georasterCache[sp.symbol] = parseGeoraster(absoluteUrl(sp.file));
      }
      return georasterCache[sp.symbol];
    }

    function showSpecies(symbol) {
      var sp = symbol ? speciesBySymbol[symbol] : null;
      var myId = ++requestId;
      if(current) {
        map.removeLayer(current.layer);
        current = null;
      }
      updateLegend(sp);
      setLoading(sp ? "Loading " + sp.common + "..." : "");
      history.replaceState(null, "", sp ? "#sp=" + sp.symbol : window.location.pathname + window.location.search);
      if(!sp) return;

      loadGeoraster(sp).then(function(georaster) {
        // a later click may have picked another species while this one loaded
        if(myId !== requestId) return;
        var lut = colorLookups[sp.form];
        var layer = new GeoRasterLayer({
          georaster: georaster,
          pane: "speciesPane",
          opacity: SPECIES_OPACITY,
          resolution: 256,
          pixelValuesToColorFn: function(values) { return lut[values[0]]; }
        });
        layer.on("load", function() { if(myId === requestId) setLoading(""); });
        layer.addTo(map);
        current = { species: sp, layer: layer, georaster: georaster };
      }).catch(function(err) {
        delete georasterCache[sp.symbol];
        if(myId === requestId) setLoading("Could not load " + sp.common + ": " + err.message);
      });
    }

    // Read the value of the cell under a map click from the current COG
    // (Leaflet's web-map projection gives the same meters the COG is in)
    function valueAt(georaster, latlng) {
      var p = L.CRS.EPSG3857.project(latlng);
      if(p.x < georaster.xmin || p.x > georaster.xmax || p.y < georaster.ymin || p.y > georaster.ymax) {
        return Promise.resolve(meta.nodata);
      }
      var half = georaster.pixelWidth / 2;
      return georaster.getValues({
        left: p.x - half, right: p.x + half, bottom: p.y - half, top: p.y + half,
        width: 1, height: 1, resampleMethod: "nearest"
      }).then(function(v) { return v[0][0][0]; });
    }

    map.on("click", function(e) {
      if(!current) {
        if(!refLayers.eco.on) {
          L.popup().setLatLng(e.latlng).setContent("No species is selected.<br>Pick one in the species list to see its value here.").openOn(map);
        }
        return;
      }
      var sp = current.species;
      valueAt(current.georaster, e.latlng.wrap()).then(function(v) {
        var body;
        if(v === meta.nodata || v === undefined || v === null) {
          body = "No FIA plot survey coverage for this species here.";
        } else if(v === 0) {
          body = "Plots in this " + meta.radius_km + " km neighborhood were surveyed but none recorded this species.";
        } else {
          body = v + "% of plots in this " + meta.radius_km + " km neighborhood had this species.";
        }
        L.popup().setLatLng(e.latlng).setContent("<b>" + sp.label + "</b><br>" + body).openOn(map);
      }).catch(function(err) {
        L.popup().setLatLng(e.latlng).setContent("Could not read the value here: " + err.message).openOn(map);
      });
    });


    // ---- 6. Reference layers, each loaded the first time it is switched on ----

    var countyLabelGroup = L.layerGroup();

    var refLayers = {
      plots: {
        title: "Measured plots",
        make: function() {
          var lut = new Array(256).fill(null);
          lut[1] = "#c51b7d";
          lut[2] = "#1b7837";
          return parseGeoraster(absoluteUrl("data/plots.tif")).then(function(gr) {
            return new GeoRasterLayer({
              georaster: gr, pane: "plotsPane", opacity: 1, resolution: 256,
              pixelValuesToColorFn: function(values) { return lut[values[0]]; }
            });
          });
        }
      },
      nlcd: {
        title: "Land cover (NLCD 2021)",
        make: function() {
          return Promise.resolve(L.tileLayer.wms("https://www.mrlc.gov/geoserver/" + NLCD_WORKSPACE + "/wms", {
            layers: NLCD_LAYER, format: "image/png", transparent: true, opacity: 1,
            SLD_BODY: nlcdStyle(), attribution: "NLCD 2021 Land Cover, MRLC"
          }));
        }
      },
      eco: {
        title: "Ecoregions (EPA Level III)",
        make: function() {
          return fetchJson("data/ecoregions.geojson").then(function(gj) {
            return L.geoJSON(gj, {
              style: function(f) {
                return { fillColor: f.properties.fill, fillOpacity: 0.38, color: "#4a2d7a", weight: 1 };
              },
              onEachFeature: function(f, lyr) {
                lyr.bindTooltip(f.properties.name, { sticky: true });
              }
            });
          });
        }
      },
      states: {
        title: "State borders",
        on: true,
        make: function() {
          return fetchJson("data/states.geojson").then(function(gj) {
            return L.geoJSON(gj, {
              renderer: L.canvas({ pane: "statePane" }), interactive: false,
              style: { color: "#222", weight: 1.3, opacity: 0.95 }
            });
          });
        }
      },
      stateLabels: {
        title: "State labels",
        make: function() {
          return fetchJson("data/state_labels.json").then(function(pts) {
            var g = L.layerGroup();
            pts.forEach(function(p) {
              g.addLayer(L.marker([p.lat, p.lon], {
                interactive: false,
                icon: L.divIcon({ className: "map-label state", html: "<span>" + p.name + "</span>", iconSize: [24, 12], iconAnchor: [12, 6] })
              }));
            });
            return g;
          });
        }
      },
      counties: {
        title: "County borders",
        on: true,
        make: function() {
          return fetchJson("data/counties.geojson").then(function(gj) {
            return L.geoJSON(gj, {
              renderer: L.canvas({ pane: "countyPane" }), interactive: false,
              style: { color: "#555", weight: 0.65, opacity: 0.8 }
            });
          });
        }
      },
      countyLabels: {
        title: "County labels",
        hint: "(zoom in ≥ " + COUNTY_LABEL_MIN_ZOOM + ")",
        make: function() {
          return fetchJson("data/county_labels.json").then(function(pts) {
            countyLabelGroup.points = pts;
            return countyLabelGroup;
          });
        }
      }
    };

    // Switch a reference layer on or off, building it on first use
    function setRefLayer(key, on) {
      var ref = refLayers[key];
      ref.on = on;
      if(key === "nlcd") showNlcdLegend(on);
      if(!on) {
        if(ref.layer) map.removeLayer(ref.layer);
        return;
      }
      if(!ref.promise) ref.promise = ref.make().then(function(lyr) { ref.layer = lyr; return lyr; });
      ref.promise.then(function(lyr) {
        if(ref.on) {
          lyr.addTo(map);
          if(key === "countyLabels") updateCountyLabels();
        }
      }).catch(function(err) {
        ref.promise = null;
        setLoading("Could not load " + ref.title + ": " + err.message);
      });
    }

    // Draw county labels only at zoom 7 and closer, and only those on screen
    function updateCountyLabels() {
      countyLabelGroup.clearLayers();
      var hint = document.getElementById("hint-countyLabels");
      if(!refLayers.countyLabels.on || !countyLabelGroup.points) return;
      if(map.getZoom() < COUNTY_LABEL_MIN_ZOOM) {
        if(hint) hint.textContent = refLayers.countyLabels.hint;
        return;
      }
      if(hint) hint.textContent = "(active)";
      var b = map.getBounds();
      countyLabelGroup.points.forEach(function(c) {
        if(b.contains([c.lat, c.lon])) {
          countyLabelGroup.addLayer(L.marker([c.lat, c.lon], {
            interactive: false,
            icon: L.divIcon({ className: "map-label county", html: "<span>" + c.name + "</span>", iconSize: [0, 0], iconAnchor: [15, 6] })
          }));
        }
      });
    }
    map.on("moveend", updateCountyLabels);


    // ---- 7. Side panel: reference layer switches and the species list ----

    var PanelControl = L.Control.extend({
      options: { position: "topright" },
      onAdd: function() {
        var panel = el("div", "panel");
        L.DomEvent.disableClickPropagation(panel);
        L.DomEvent.disableScrollPropagation(panel);

        //  a. reference layers
        var refSec = el("div", "panel-section");
        refSec.appendChild(el("div", "panel-title", "Reference layers"));
        Object.keys(refLayers).forEach(function(key) {
          var ref = refLayers[key];
          var lbl = el("label");
          var cb = el("input");
          cb.type = "checkbox";
          cb.checked = !!ref.on;
          cb.addEventListener("change", function() { setRefLayer(key, cb.checked); });
          lbl.appendChild(cb);
          lbl.appendChild(document.createTextNode(ref.title));
          if(ref.hint) {
            var h = el("span", "hint", ref.hint);
            h.id = "hint-" + key;
            lbl.appendChild(h);
          }
          refSec.appendChild(lbl);
        });
        panel.appendChild(refSec);

        //  b. species search, plant-form filter, and list
        var spSec = el("div", "panel-section");
        spSec.appendChild(el("div", "panel-title", "Species ranges (by plant form)"));
        var search = el("input");
        search.type = "text";
        search.placeholder = "Search species, symbol, or plant form...";
        spSec.appendChild(search);

        var filterBar = el("div", "form-filter");
        var formChecks = {};
        meta.forms.forEach(function(f) {
          var lbl = el("label");
          var cb = el("input");
          cb.type = "checkbox";
          cb.checked = true;
          formChecks[f.form] = cb;
          lbl.appendChild(cb);
          lbl.appendChild(document.createTextNode(f.form));
          filterBar.appendChild(lbl);
        });
        spSec.appendChild(filterBar);

        var count = el("div", "species-count");
        spSec.appendChild(count);
        var list = el("div", "species-list");
        spSec.appendChild(list);

        //  - "None" clears the species layer
        var noneLbl = el("label");
        var noneRadio = el("input");
        noneRadio.type = "radio";
        noneRadio.name = "species";
        noneRadio.value = "";
        noneLbl.appendChild(noneRadio);
        noneLbl.appendChild(document.createTextNode("None"));
        list.appendChild(noneLbl);

        //  - one group per plant form, species sorted by common name
        var items = [];
        var groups = {};
        meta.forms.forEach(function(f) {
          var g = { div: el("div"), header: el("div", "form-header", f.form) };
          g.div.appendChild(g.header);
          list.appendChild(g.div);
          groups[f.form] = g;
        });
        var sorted = meta.species.slice().sort(function(a, b) { return a.common.localeCompare(b.common); });
        sorted.forEach(function(sp) {
          var lbl = el("label");
          var radio = el("input");
          radio.type = "radio";
          radio.name = "species";
          radio.value = sp.symbol;
          lbl.appendChild(radio);
          lbl.appendChild(document.createTextNode(sp.common + " "));
          lbl.appendChild(el("span", "species-symbol", sp.symbol));
          (groups[sp.form] || groups[meta.forms[0].form]).div.appendChild(lbl);
          items.push({ sp: sp, el: lbl, radio: radio, text: (sp.common + " " + sp.symbol + " " + sp.form).toLowerCase() });
        });

        list.addEventListener("change", function(e) {
          if(e.target.name === "species") showSpecies(e.target.value || null);
        });

        //  - search text and plant-form boxes together decide what is listed
        function applyFilters() {
          var q = search.value.toLowerCase().trim();
          var shown = 0;
          var shownByForm = {};
          items.forEach(function(it) {
            var visible = formChecks[it.sp.form].checked && (q === "" || it.text.indexOf(q) !== -1);
            it.el.style.display = visible ? "" : "none";
            if(visible) {
              shown++;
              shownByForm[it.sp.form] = true;
            }
          });
          Object.keys(groups).forEach(function(f) {
            groups[f].div.style.display = shownByForm[f] ? "" : "none";
          });
          count.textContent = shown + " of " + items.length + " species";
        }
        search.addEventListener("input", applyFilters);
        Object.keys(formChecks).forEach(function(f) { formChecks[f].addEventListener("change", applyFilters); });
        applyFilters();

        //  - pick the species named in the link, or the default
        var start = speciesFromHash();
        if(!speciesBySymbol[start]) start = speciesBySymbol[DEFAULT_SPECIES] ? DEFAULT_SPECIES : sorted[0].symbol;
        items.forEach(function(it) { if(it.sp.symbol === start) it.radio.checked = true; });
        setTimeout(function() { showSpecies(start); }, 0);

        //  - loading note
        var loading = el("div", "loading");
        loading.id = "loading-note";
        spSec.appendChild(loading);

        panel.appendChild(spSec);
        return panel;
      }
    });


    // ---- 8. Legend and information box ----

    // bottom left, above the scale bar, so it never covers the species panel
    var LegendControl = L.Control.extend({
      options: { position: "bottomleft" },
      onAdd: function() {
        var box = el("div", "legend");
        box.appendChild(el("div", "legend-title", "Occurrence share (%)"));
        var name = el("div", "legend-species");
        name.id = "legend-species";
        box.appendChild(name);
        meta.forms.forEach(function(f) {
          var wrap = el("div");
          wrap.className = "legend-ramp-wrap";
          wrap.setAttribute("data-form", f.form);
          wrap.appendChild(el("div", "hint", f.form));
          var ramp = el("div", "legend-ramp");
          ramp.style.background = "linear-gradient(to right, " + f.col_low + ", " + f.col_mid + ", " + f.col_high + ")";
          wrap.appendChild(ramp);
          box.appendChild(wrap);
        });
        var ticks = el("div", "legend-ticks");
        ["1%", "50%", "100%"].forEach(function(t) { ticks.appendChild(el("span", null, t)); });
        box.appendChild(ticks);

        var nlcd = el("div", "legend-block");
        nlcd.id = "legend-nlcd";
        nlcd.style.display = "none";
        nlcd.appendChild(el("div", "legend-title", "Land cover (NLCD 2021)"));
        NLCD_BANDS.forEach(function(b) { nlcd.appendChild(swatchRow(b.color, b.opacity, b.band)); });
        box.appendChild(nlcd);

        var other = el("div", "legend-block");
        other.appendChild(swatchRow(meta.col_zero, 1, "Surveyed, not recorded"));
        other.appendChild(swatchRow("#1b7837", 1, "Plot: forest"));
        other.appendChild(swatchRow("#c51b7d", 1, "Plot: nonforest"));
        box.appendChild(other);
        return box;
      }
    });

    function swatchRow(color, opacity, text) {
      var row = el("div", "swatch-row");
      var sw = el("i", "swatch");
      sw.style.background = color;
      sw.style.opacity = opacity;
      row.appendChild(sw);
      row.appendChild(el("span", null, text));
      return row;
    }

    // Show only the selected species' plant-form ramp (all ramps when none
    // is selected) and name the species above it
    function updateLegend(sp) {
      document.querySelectorAll(".legend-ramp-wrap").forEach(function(w) {
        w.style.display = (!sp || w.getAttribute("data-form") === sp.form) ? "" : "none";
      });
      var nm = document.getElementById("legend-species");
      if(nm) nm.textContent = sp ? sp.label : "No species selected";
    }

    function showNlcdLegend(on) {
      var box = document.getElementById("legend-nlcd");
      if(box) box.style.display = on ? "" : "none";
    }

    function setLoading(text) {
      var note = document.getElementById("loading-note");
      if(note) note.textContent = text;
    }

    var InfoControl = L.Control.extend({
      options: { position: "topleft" },
      onAdd: function() {
        var box = el("div", "info");
        box.innerHTML =
          "<b>Observed plant ranges (pilot)</b><br>" +
          "Share of surveyed FIA plots with the species,<br>" +
          meta.radius_km + " km window on a 1 km grid; latest plot visits " + meta.years[0] + "-" + meta.years[1] + ".<br>" +
          "Data: FIA DataMart (public plot coordinates).<br>" +
          "Plots: " + numberWithCommas(meta.n_forest) + " forest, " + numberWithCommas(meta.n_nonforest) + " nonforest.<br>" +
          "Click the map to read the selected species' value.";
        return box;
      }
    });

    // Legend goes on before the panel so updateLegend() finds it; Leaflet
    // stacks later controls above earlier ones in the bottom corners, so
    // the scale bar (added first) stays at the very bottom
    new InfoControl().addTo(map);
    new LegendControl().addTo(map);
    new PanelControl().addTo(map);

    // switch on the reference layers that start on
    Object.keys(refLayers).forEach(function(key) { if(refLayers[key].on) setRefLayer(key, true); });
  }
})();
