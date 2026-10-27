package sourcemerge

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// docs/25 F9 was not one query: the dashboard, the insight rules, the challenge
// and the Home Assistant publisher each carried their own `sum(value)` over
// samples, and fixing one would have left the others reporting a tripled day.
// So the guard is structural: outside this package, no Go code may sum sample
// values itself — it goes through BucketQuery, or it argues its case here.
func TestNobodySumsSamplesBehindTheMergesBack(t *testing.T) {
	sum := regexp.MustCompile(`(?i)\bsum\(\s*(\w+\.)?value\s*\)`)
	root := filepath.Join("..")
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if d.Name() == "sourcemerge" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for i, line := range strings.Split(string(src), "\n") {
			// Comments may name the old query; only code counts.
			if strings.HasPrefix(strings.TrimSpace(line), "//") {
				continue
			}
			if sum.MatchString(line) {
				t.Errorf("%s:%d sums sample values directly — use sourcemerge.BucketQuery (docs/25 F9): %s",
					path, i+1, strings.TrimSpace(line))
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
