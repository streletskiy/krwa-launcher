package main

import (
	"crypto/aes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"strings"
	"testing"

	jose "github.com/go-jose/go-jose/v3"
	josecipher "github.com/go-jose/go-jose/v3/cipher"
	"github.com/go-jose/go-jose/v3/json"
)

func TestDeepJSONIsRejected(t *testing.T) {
	input := strings.Repeat("[", 10001) + "0" + strings.Repeat("]", 10001)
	var result interface{}
	if err := json.Unmarshal([]byte(input), &result); err == nil {
		t.Fatal("excessive JSON nesting was accepted")
	}
}

func TestEmptyCBCCiphertextDoesNotPanic(t *testing.T) {
	key := make([]byte, 32)
	aead, err := josecipher.NewCBCHMAC(key, aes.NewCipher)
	if err != nil {
		t.Fatal(err)
	}
	nonce := make([]byte, aead.NonceSize())
	mac := hmac.New(sha256.New, key[:16])
	mac.Write(nonce)
	mac.Write(make([]byte, 8)) // empty AAD's length in bits
	tag := mac.Sum(nil)[:16]
	if _, err := aead.Open(nil, nonce, tag, nil); err == nil {
		t.Fatal("empty CBC ciphertext was accepted")
	}
}

func TestOversizedRSAIsRejectedBeforeValidation(t *testing.T) {
	n := make([]byte, 514)
	n[0] = 1
	var key jose.JSONWebKey
	err := key.UnmarshalJSON([]byte(`{"kty":"RSA","e":"AQAB","n":"` + base64.RawURLEncoding.EncodeToString(n) + `"}`))
	if err == nil || !strings.Contains(err.Error(), "modulus too large") {
		t.Fatalf("expected modulus size rejection, got %v", err)
	}
}

func TestNormalRSASigningStillWorks(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: key}, nil)
	if err != nil {
		t.Fatal(err)
	}
	signed, err := signer.Sign([]byte("KRWA security regression"))
	if err != nil {
		t.Fatal(err)
	}
	compact, err := signed.CompactSerialize()
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := jose.ParseSigned(compact)
	if err != nil {
		t.Fatal(err)
	}
	message, err := parsed.Verify(&key.PublicKey)
	if err != nil || string(message) != "KRWA security regression" {
		t.Fatalf("signature verification failed: %v", err)
	}
}
