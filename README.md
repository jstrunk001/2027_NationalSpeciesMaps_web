# Observed Plant Ranges web map

An interactive map of where plant species were recorded on USDA Forest
Service Forest Inventory and Analysis (FIA) plots across the conterminous
United States. For each species, the map shows the share of surveyed FIA
plots within 20 km that recorded the species. The data come from the public
FIA DataMart, using its publicly released plot coordinates.

## How the page works

Each species is stored as one cloud-optimized GeoTIFF (COG) in
`data/species/`. A COG stores the raster in small tiles plus built-in
lower-resolution copies. The browser downloads only the tiles covering the
screen at the current zoom, so the page loads at the same speed with
hundreds of species as it does with a few.

- `index.html`, `js/app.js`, `css/style.css`: the page. It uses
  [Leaflet](https://leafletjs.com/) for the map and
  [georaster-layer-for-leaflet](https://github.com/GeoTIFF/georaster-layer-for-leaflet)
  to draw the COGs.
- `data/species.json`: the species list (symbol, common name, plant form,
  file), the color ramp for each plant form, and the facts shown in the
  information box.
- `data/species/<SYMBOL>.tif`: occurrence share 0-100 on web-map cells
  (EPSG:3857, 1000 m); 255 marks areas with no surveyed plots.
- `data/plots.tif`: measured plot locations (1 = nonforest, 2 = forest).
- `data/*.geojson`, `data/*_labels.json`: ecoregion, state, and county
  boundaries and labels.

Everything under `data/` is written by
`R/002e_national_species_maps_cog_web_map.qmd` in the companion analysis
project (2027_NationalSpeciesMaps). The page files are edited by hand here.

A link to one species: add `#sp=<SYMBOL>` to the address, for example
`#sp=PSME`.

## Test locally

The page needs a web server that supports HTTP range requests. From this
folder:

```
Rscript R/serve_local.R
```

then open http://127.0.0.1:8000.

## Publish

The site is served by GitHub Pages from the `main` branch root. Pushing to
`main` publishes the changes.
