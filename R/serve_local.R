# Serve this site on http://127.0.0.1:8000 for local testing.
#
# The page reads cloud-optimized GeoTIFFs a piece at a time with HTTP range
# requests ("send me bytes 1000-2000 of this file"). Simple local servers
# often ignore those requests and send the whole file, so this server
# handles them itself. GitHub Pages handles them the same way.
#
# Run from the site folder:  Rscript R/serve_local.R
# Stop with Ctrl+C.

#1. settings
dir_site = normalizePath(".")
port = 8000L
types = c(
    html = "text/html; charset=utf-8"
  , js = "application/javascript"
  , css = "text/css"
  , json = "application/json"
  , geojson = "application/geo+json"
  , tif = "image/tiff"
  , md = "text/plain; charset=utf-8"
  )

#2. answer one request: a whole file, or the byte range asked for
fn_serve = function(req){
  path_rel = utils::URLdecode(req$PATH_INFO)
  if(path_rel == "/" || path_rel == "") path_rel = "/index.html"
  path = normalizePath(file.path(dir_site, path_rel), mustWork = FALSE)
  #  - refuse anything outside the site folder or missing
  if(!startsWith(path, dir_site) || !file.exists(path) || dir.exists(path)) return(list(status = 404L, headers = list("Content-Type" = "text/plain"), body = "Not found"))
  size = file.size(path)
  ext = tolower(tools::file_ext(path))
  type = if(ext %in% names(types)) types[[ext]] else "application/octet-stream"
  range = req$HTTP_RANGE
  #  - a range request: read just those bytes and answer 206 Partial Content
  if(!is.null(range) && grepl("^bytes=\\d*-\\d*$", range)){
    parts = strsplit(sub("^bytes=", "", range), "-", fixed = TRUE)[[1]]
    from = if(nzchar(parts[1])) as.numeric(parts[1]) else size - as.numeric(parts[2])
    to = if(length(parts) > 1 && nzchar(parts[2]) && nzchar(parts[1])) min(as.numeric(parts[2]), size - 1) else size - 1
    if(from > to || from >= size) return(list(status = 416L, headers = list("Content-Range" = paste0("bytes */", size)), body = ""))
    con = file(path, "rb")
    seek(con, from)
    body = readBin(con, "raw", n = to - from + 1)
    close(con)
    headers = list(
        "Content-Type" = type
      , "Accept-Ranges" = "bytes"
      , "Content-Range" = sprintf("bytes %.0f-%.0f/%.0f", from, to, size)
      , "Cache-Control" = "no-cache"
      )
    return(list(status = 206L, headers = headers, body = body))
    }
  #  - otherwise send the whole file
  body = readBin(path, "raw", n = size)
  return(list(status = 200L, headers = list("Content-Type" = type, "Accept-Ranges" = "bytes", "Cache-Control" = "no-cache"), body = body))
  }

#3. start the server and keep it running
srv = httpuv::startServer("127.0.0.1", port, list(call = fn_serve))
message("Serving ", dir_site, " at http://127.0.0.1:", port, " (Ctrl+C to stop)")
while(TRUE) httpuv::service(100)
