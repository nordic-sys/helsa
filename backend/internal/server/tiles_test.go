package server

import "testing"

// The whole of the proxy's trust boundary is `tileUpstream`: everything after it
// is an HTTP GET with a cap and a timeout. So this is where the tests are.

func TestTileUpstreamRejectsWhatItShould(t *testing.T) {
	const ok = "https://tiles.example/{z}/{x}/{y}.png"

	cases := []struct {
		name         string
		src, z, x, y string
	}{
		{"no source at all", "", "12", "2264", "1432"},
		// ⛔ The schemes that are not a tile fetch. `file:` would read the
		// server's own disk and hand it back through the browser.
		{"a file URL", "file:///etc/passwd?{z}{x}{y}", "12", "2264", "1432"},
		{"a data URL", "data:text/plain,{z}{x}{y}", "12", "2264", "1432"},
		{"no host", "https://{z}/{x}/{y}", "12", "2264", "1432"},
		// A template with no placeholders is a single fixed URL, which is a
		// fetch-anything endpoint rather than a tile source.
		{"no placeholders", "https://tiles.example/a.png", "12", "2264", "1432"},
		{"only some placeholders", "https://tiles.example/{z}/{x}.png", "12", "2264", "1432"},
		// ⚠️ The coordinates are the part an attacker controls in the PATH. They
		// are parsed as integers, so nothing else can ride through them.
		{"a path in the zoom", ok, "../../secret", "2264", "1432"},
		{"a query in x", ok, "12", "1&a=b", "1432"},
		{"a negative y", ok, "12", "2264", "-1"},
		{"an absurd zoom", ok, "99", "1", "1"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got, err := tileUpstream(c.src, c.z, c.x, c.y); err == nil {
				t.Fatalf("expected a refusal, got %q", got)
			}
		})
	}
}

func TestTileUpstreamBuildsTheAddress(t *testing.T) {
	cases := []struct {
		name    string
		src     string
		z, x, y string
		want    string
	}{
		{
			"a public raster provider",
			"https://tile.openstreetmap.org/{z}/{x}/{y}.png",
			"12", "2264", "1432",
			"https://tile.openstreetmap.org/12/2264/1432.png",
		},
		{
			// The optional container in deploy/, on the compose network: a plain
			// http address on a private host, which is exactly the case a
			// "block private addresses" rule would have broken.
			"a tile server of your own",
			"http://tiles:3000/hungary/{z}/{x}/{y}",
			"14", "9059", "5728",
			"http://tiles:3000/hungary/14/9059/5728",
		},
		{
			// MapLibre puts the extension on the last segment for some raster
			// styles. It is not ours to forward — the template says what the
			// upstream's suffix is.
			"an extension arriving on y",
			"https://tiles.example/{z}/{x}/{y}.png",
			"12", "2264", "1432.png",
			"https://tiles.example/12/2264/1432.png",
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := tileUpstream(c.src, c.z, c.x, c.y)
			if err != nil {
				t.Fatalf("unexpected refusal: %v", err)
			}
			if got != c.want {
				t.Fatalf("got %q, want %q", got, c.want)
			}
		})
	}
}
