# Load the map in headless Chrome and check that it works: no JavaScript
# errors, the species list is built, a species draws, reference layers
# load, and a map click reports a value. Saves screenshots for a look.
#
# Usage, from the site folder:
#   Rscript R/check_page.R [page address] [folder for screenshots]
# The page address defaults to the local test server
# (start it first with: Rscript R/serve_local.R).

#1. settings
args = commandArgs(trailingOnly = TRUE)
url_page = if(length(args) >= 1) args[1] else "http://127.0.0.1:8000/"
dir_shots = if(length(args) >= 2) args[2] else tempdir()
dir.create(dir_shots, recursive = TRUE, showWarnings = FALSE)

#2. helper: run JavaScript in the page and return its value, waiting for
#   promises to finish
fn_js = function(b, code){
  res = b$Runtime$evaluate(code, awaitPromise = TRUE, returnByValue = TRUE)
  if(!is.null(res$exceptionDetails)) stop("Page script failed: ", res$exceptionDetails$exception$description)
  return(res$result$value)
  }

#3. helper: wait until a JavaScript condition is true, up to a time limit
fn_wait_for = function(b, code, secs = 30){
  t_end = Sys.time() + secs
  while(Sys.time() < t_end){
    if(isTRUE(fn_js(b, code))) return(TRUE)
    Sys.sleep(0.5)
    }
  return(FALSE)
  }

#4. open the page and record console errors and failed requests
b = chromote::ChromoteSession$new(width = 1400, height = 900)
errors = character(0)
b$Runtime$enable()
b$Network$enable()
b$Runtime$exceptionThrown(callback_ = function(m) errors <<- c(errors, paste("exception:", m$exceptionDetails$exception$description)))
b$Runtime$consoleAPICalled(callback_ = function(m) if(m$type == "error") errors <<- c(errors, paste("console:", paste(sapply(m$args, function(a) as.character(a$value %||% a$description %||% "")), collapse = " "))))
b$Network$loadingFailed(callback_ = function(m) errors <<- c(errors, paste("request failed:", m$errorText)))
b$Page$navigate(url_page)
b$Page$loadEventFired(wait_ = TRUE)

#5. check the species list was built and the first species drew
#  - a species is drawn when its raster layer has canvas tiles in the
#    species pane and the page has cleared its "Loading ..." note
#  - Leaflet names a pane's CSS class without the "Pane" ending, so
#    "speciesPane" becomes ".leaflet-species-pane"
ok_list = fn_wait_for(b, "document.querySelectorAll('.species-list input[type=radio]').length > 1")
n_species = fn_js(b, "document.querySelectorAll('.species-list input[type=radio]').length - 1")
ok_draw = fn_wait_for(b, "document.querySelectorAll('.leaflet-species-pane canvas').length > 0 && document.getElementById('loading-note').textContent === ''", secs = 60)
sel = fn_js(b, "(document.querySelector('.species-list input[type=radio]:checked') || {}).value")
Sys.sleep(2)
b$screenshot(file.path(dir_shots, "01_start.png"))

#6. switch on the reference layers that start off, and check each loads
keys = c("Measured plots", "Land cover (NLCD 2021)", "Ecoregions (EPA Level III)", "State labels")
for(k in keys){
  fn_js(b, sprintf("Array.from(document.querySelectorAll('.panel label')).find(l => l.textContent.indexOf('%s') === 0).querySelector('input').click(); true", k))
  }
Sys.sleep(8)
b$screenshot(file.path(dir_shots, "02_reference_layers.png"))
for(k in keys){
  fn_js(b, sprintf("Array.from(document.querySelectorAll('.panel label')).find(l => l.textContent.indexOf('%s') === 0).querySelector('input').click(); true", k))
  }

#7. pick another species with the search box and the list
fn_js(b, "var s = document.querySelector('.panel input[type=text]'); s.value = 'sage'; s.dispatchEvent(new Event('input')); true")
n_match = fn_js(b, "Array.from(document.querySelectorAll('.species-list label')).filter(l => l.style.display !== 'none' && l.querySelector('input').value !== '').length")
fn_js(b, "Array.from(document.querySelectorAll('.species-list label')).find(l => l.style.display !== 'none' && l.querySelector('input').value !== '').querySelector('input').click(); true")
ok_draw2 = fn_wait_for(b, "document.getElementById('loading-note').textContent === ''", secs = 60)
hash = fn_js(b, "window.location.hash")
Sys.sleep(2)
b$screenshot(file.path(dir_shots, "03_second_species.png"))

#8. click the middle of the map and read the popup
fn_js(b, "var m = document.getElementById('map').getBoundingClientRect(); var x = m.left + m.width * 0.45, y = m.top + m.height * 0.5; var t = document.elementFromPoint(x, y); ['mousedown','mouseup','click'].forEach(function(ev){ t.dispatchEvent(new MouseEvent(ev, {bubbles: true, clientX: x, clientY: y, view: window})); }); true")
ok_popup = fn_wait_for(b, "!!document.querySelector('.leaflet-popup-content')", secs = 20)
popup = if(ok_popup) fn_js(b, "document.querySelector('.leaflet-popup-content').textContent") else NA
b$screenshot(file.path(dir_shots, "04_click_popup.png"))

#9. report
b$close()
cat(sprintf("page:              %s\n", url_page))
cat(sprintf("species listed:    %s (%s)\n", n_species, if(ok_list) "ok" else "FAILED"))
cat(sprintf("first species:     %s drawn %s\n", sel, if(ok_draw) "ok" else "FAILED"))
cat(sprintf("search 'sage':     %s matches; second species drawn %s; link %s\n", n_match, if(ok_draw2) "ok" else "FAILED", hash))
cat(sprintf("click popup:       %s\n", if(ok_popup) popup else "FAILED"))
cat(sprintf("errors:            %d\n", length(errors)))
if(length(errors) > 0) cat(paste(" -", unique(errors)), sep = "\n")
cat(sprintf("screenshots in:    %s\n", normalizePath(dir_shots)))
