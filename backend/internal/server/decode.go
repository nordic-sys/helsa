package server

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

// decodeBody reads a JSON request body into v. On failure it answers 400 itself
// and returns false.
//
// ⚠️ Two different statements share the 400, and the title is what tells them
// apart. "Malformed JSON" is reserved for a body that is not JSON at all — a
// syntax error, a truncated body, no body. A body that IS well-formed JSON but
// carries a value the field cannot hold (a `device_id` that is not a UUID, a
// string where a number goes, a date that does not parse) gets invalidTitle. The
// walkthrough of 2026-10-27 sent a perfectly good document with a 17-character
// device_id and was told its JSON was malformed — which sends somebody to hunt
// for a missing brace that is not missing.
func decodeBody(w http.ResponseWriter, r *http.Request, v any, invalidTitle string) bool {
	err := json.NewDecoder(r.Body).Decode(v)
	if err == nil {
		return true
	}
	title, detail := decodeProblem(err, invalidTitle)
	problem(w, http.StatusBadRequest, title, detail)
	return false
}

// decodeProblem picks the title and detail for a decode error.
func decodeProblem(err error, invalidTitle string) (title, detail string) {
	var syntax *json.SyntaxError
	switch {
	case errors.Is(err, io.EOF):
		return "Malformed JSON", "the request body is empty"
	case errors.Is(err, io.ErrUnexpectedEOF), errors.As(err, &syntax):
		return "Malformed JSON", err.Error()
	default:
		// json.UnmarshalTypeError, and whatever a field's own UnmarshalJSON
		// returned (uuid, time): the document parsed, a value did not fit.
		return invalidTitle, err.Error()
	}
}
