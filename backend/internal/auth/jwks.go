package auth

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"sync"
	"time"
)

// jwkSet is the response of Apple's JWKS endpoint.
type jwkSet struct {
	Keys []jwk `json:"keys"`
}

type jwk struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	Use string `json:"use"`
	Alg string `json:"alg"`
	N   string `json:"n"` // modulus (base64url)
	E   string `json:"e"` // exponent (base64url)
}

// jwksCache fetches and caches Apple's public keys as a kid → *rsa.PublicKey map.
type jwksCache struct {
	url    string
	client *http.Client
	ttl    time.Duration

	mu        sync.RWMutex
	keys      map[string]*rsa.PublicKey
	fetchedAt time.Time
}

func newJWKSCache(url string) *jwksCache {
	return &jwksCache{
		url:    url,
		client: &http.Client{Timeout: 10 * time.Second},
		ttl:    12 * time.Hour,
		keys:   map[string]*rsa.PublicKey{},
	}
}

// keyForKid returns the key belonging to kid; if it is not cached or the cache
// has expired, it refreshes.
func (c *jwksCache) keyForKid(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	c.mu.RLock()
	k, ok := c.keys[kid]
	fresh := time.Since(c.fetchedAt) < c.ttl
	c.mu.RUnlock()
	if ok && fresh {
		return k, nil
	}
	if err := c.refresh(ctx); err != nil {
		// If the refresh fails but we still hold an old (even stale) key, use that one.
		if ok {
			return k, nil
		}
		return nil, err
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	if k, ok := c.keys[kid]; ok {
		return k, nil
	}
	return nil, fmt.Errorf("unknown kid: %s", kid)
}

func (c *jwksCache) refresh(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.url, nil)
	if err != nil {
		return err
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("jwks fetch: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("jwks status %d", resp.StatusCode)
	}
	var set jwkSet
	if err := json.NewDecoder(resp.Body).Decode(&set); err != nil {
		return fmt.Errorf("jwks decode: %w", err)
	}
	keys := make(map[string]*rsa.PublicKey, len(set.Keys))
	for _, k := range set.Keys {
		if k.Kty != "RSA" {
			continue
		}
		pub, err := rsaPublicKeyFromJWK(k)
		if err != nil {
			continue
		}
		keys[k.Kid] = pub
	}
	c.mu.Lock()
	c.keys = keys
	c.fetchedAt = time.Now()
	c.mu.Unlock()
	return nil
}

// rsaPublicKeyFromJWK builds an rsa.PublicKey from the base64url-encoded n/e values.
func rsaPublicKeyFromJWK(k jwk) (*rsa.PublicKey, error) {
	nBytes, err := base64.RawURLEncoding.DecodeString(k.N)
	if err != nil {
		return nil, fmt.Errorf("modulus decode: %w", err)
	}
	eBytes, err := base64.RawURLEncoding.DecodeString(k.E)
	if err != nil {
		return nil, fmt.Errorf("exponent decode: %w", err)
	}
	// Left-pad e to 4 bytes for binary.BigEndian.Uint32.
	eBuf := make([]byte, 4)
	copy(eBuf[4-len(eBytes):], eBytes)
	return &rsa.PublicKey{
		N: new(big.Int).SetBytes(nBytes),
		E: int(binary.BigEndian.Uint32(eBuf)),
	}, nil
}
