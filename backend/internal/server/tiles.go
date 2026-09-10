package server

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

// --- GET /v1/tiles/{z}/{x}/{y} — the map-tile proxy ---
//
// # Why the server fetches the tiles and the browser does not
//
// The web dashboard can draw a basemap under a workout route, and the reader
// chooses where it comes from (Settings ▸ Map under the route). Whatever they
// choose, the BROWSER must keep talking to one host only — this one. Two reasons,
// and the second decides it:
//
//  1. A tile request on a page about where somebody ran tells the tile host that
//     somebody is looking at that square of the world. Sent from here, what the
//     host learns is this server's address; sent from the browser, it would be the
//     reader's, along with everything else a browser carries.
//  2. An address the reader types in cannot be put in an origin allowlist. A rule
//     that has to permit "whatever the user entered" permits everything, and a
//     page's request list stops being something anyone can check. Proxying keeps
//     the rule absolute: the page contacts its own origin, full stop.
//
// # Why an arbitrary URL is acceptable here, and what keeps it acceptable
//
// ⚠️ This is a forward proxy, and a forward proxy is normally a thing to be very
// careful about. What makes it safe enough here is the shape of the system rather
// than the shape of the URL:
//
//   - **It is behind the device token**, like every other `/v1` route. Helsa is
//     single-user (ADR-0002/0003); the only party who can use this proxy is the
//     one who owns the server it runs on. It is his proxy, used by him.
//   - **The destination is deliberately unrestricted.** Blocking private
//     addresses would break the option this feature exists for — a tile server on
//     the owner's own LAN — so it is not done, and this comment says so rather
//     than leaving the absence to be discovered.
//   - It is **GET only**, **http/https only**, **size-capped**, **time-limited**,
//     and it **follows no redirects**. Nothing of the response is interpreted;
//     only a handful of headers are copied back.
//
// # Why it is not in the OpenAPI contract
//
// The contract is the PHONE's contract — the shape both sides of the sync agree
// on. This is a browser convenience with no counterpart on the phone (which has
// MapKit), and adding it would put a forward proxy into the app's published API
// surface. It is wired by hand in `Router()` instead, beside the health probes,
// which are hand-wired for the same kind of reason.

const (
	// A tile is tens of kilobytes; a megabyte is already a generous vector tile
	// at zoom 14. The cap is what stops a mistyped address from streaming an ISO
	// image through the server.
	maxTileBytes = 4 << 20

	// Long enough for a cold cache on a slow provider, short enough that a dead
	// address fails while somebody is still looking at the screen.
	tileTimeout = 12 * time.Second

	// ⚠️ OpenStreetMap's tile usage policy REQUIRES a User-Agent that identifies
	// the application — an anonymous or generic one gets blocked, and the block
	// looks like a broken map rather than like a rule.
	tileUserAgent = "Helsa/1.0 (self-hosted; +https://github.com/nordic-sys/helsa)"
)

// tileClient follows no redirects on purpose: a redirect is the one way a
// checked address can turn into an unchecked one between the check and the
// fetch.
var tileClient = &http.Client{
	Timeout: tileTimeout,
	CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

// tileUpstream turns the `src` template plus z/x/y into the URL to fetch.
//
// The template is the address the reader entered, with `{z}`, `{x}` and `{y}` in
// it. ⚠️ The coordinates are re-formatted from PARSED integers rather than
// pasted in as text: it is what stops a path segment from carrying anything but
// a number into somebody else's server.
func tileUpstream(src, z, x, y string) (string, error) {
	if src == "" {
		return "", fmt.Errorf("no src")
	}
	zi, err := strconv.Atoi(z)
	if err != nil || zi < 0 || zi > 24 {
		return "", fmt.Errorf("bad zoom")
	}
	xi, err := strconv.Atoi(x)
	if err != nil || xi < 0 {
		return "", fmt.Errorf("bad x")
	}
	// MapLibre appends the format to the last segment for raster sources in some
	// styles; anything after the number is not ours to forward.
	yi, err := strconv.Atoi(strings.SplitN(y, ".", 2)[0])
	if err != nil || yi < 0 {
		return "", fmt.Errorf("bad y")
	}

	u, err := url.Parse(src)
	if err != nil {
		return "", fmt.Errorf("unparseable src")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", fmt.Errorf("src must be http or https")
	}
	if u.Host == "" {
		return "", fmt.Errorf("src has no host")
	}
	if !strings.Contains(src, "{z}") || !strings.Contains(src, "{x}") || !strings.Contains(src, "{y}") {
		return "", fmt.Errorf("src needs {z}, {x} and {y}")
	}

	r := strings.NewReplacer(
		"{z}", strconv.Itoa(zi),
		"{x}", strconv.Itoa(xi),
		"{y}", strconv.Itoa(yi),
	)
	return r.Replace(src), nil
}

// GetTile is the handler. It is registered by hand — see the header.
func (s *Server) GetTile(w http.ResponseWriter, r *http.Request) {
	target, err := tileUpstream(
		r.URL.Query().Get("src"),
		chiURLParam(r, "z"), chiURLParam(r, "x"), chiURLParam(r, "y"),
	)
	if err != nil {
		problem(w, http.StatusBadRequest, "Unusable tile source", err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), tileTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		problem(w, http.StatusBadRequest, "Unusable tile source", err.Error())
		return
	}
	req.Header.Set("User-Agent", tileUserAgent)
	req.Header.Set("Accept", "image/*,application/x-protobuf,application/octet-stream;q=0.9,*/*;q=0.5")

	resp, err := tileClient.Do(req)
	if err != nil {
		// ⚠️ 502, not 500: the fault is at the other end, and the difference is
		// what tells the reader to check the address rather than the server.
		problem(w, http.StatusBadGateway, "The tile source did not answer", err.Error())
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		// A missing tile is normal — an extract that does not cover this square
		// answers 404, and the map should simply have a hole there rather than an
		// error. Anything else is passed through as a gateway fault.
		if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusNoContent {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		problem(w, http.StatusBadGateway, "The tile source refused",
			fmt.Sprintf("upstream answered %d", resp.StatusCode))
		return
	}

	if ct := resp.Header.Get("Content-Type"); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	if ce := resp.Header.Get("Content-Encoding"); ce != "" {
		// Vector tiles are usually served gzipped and MapLibre expects the
		// browser to have undone that, so the header has to survive the trip.
		w.Header().Set("Content-Encoding", ce)
	}
	// A basemap tile does not change on the timescale a person looks at a
	// workout, and every cached tile is one request the provider does not see.
	w.Header().Set("Cache-Control", "private, max-age=86400")

	w.WriteHeader(http.StatusOK)
	// ⚠️ The cap is enforced here rather than trusted from Content-Length, which
	// a hostile or broken upstream is free to lie about.
	_, _ = io.Copy(w, io.LimitReader(resp.Body, maxTileBytes))
}

// chiURLParam keeps the chi import in one place; the rest of the file is plain
// net/http and reads better for it.
func chiURLParam(r *http.Request, key string) string {
	return chi.URLParam(r, key)
}
