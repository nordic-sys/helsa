package baseline

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/summary"
)

// Service answers GET /v1/baseline.
//
// It owns no query of its own: both windows are fetched through summary.Service,
// so the days the band is built from are the very buckets a client would receive
// from /summary — the same timezone-aware bucketing, the same percentage scaling,
// the same Redis cache. A second, hand-written aggregation here would be a third
// place for the meaning of "a day" to drift.
type Service struct {
	summary *summary.Service
	// now is here so that the anchor rule can be tested without waiting for a
	// calendar. Production leaves it nil and gets time.Now.
	now func() time.Time
}

func New(s *summary.Service) *Service { return &Service{summary: s} }

type Request struct {
	Range   string
	Metrics []string
	TZ      string
	From    *time.Time
	To      *time.Time
}

// Compute returns the usual range of every requested metric, and where the period
// stands against it.
func (s *Service) Compute(ctx context.Context, userID uuid.UUID, req Request) (api.BaselineResponse, error) {
	// ⚠️ Only the daily-bucketed ranges. The reference is always daily, so on `day`
	// (hourly buckets) and `year` (monthly ones) the band would be drawn against
	// numbers of an entirely different size — for a summed metric it would be wrong
	// by a factor of 24 or 30. Silence is the only correct answer, and a 400 says so
	// out loud rather than returning an empty object that reads like "no data".
	if req.Range != "week" && req.Range != "month" {
		return api.BaselineResponse{}, fmt.Errorf(
			"range %q has no usual range: the reference is daily, so only week and month can carry one", req.Range)
	}
	if len(req.Metrics) == 0 {
		return api.BaselineResponse{}, errors.New("metrics is required")
	}
	loc, err := time.LoadLocation(req.TZ)
	if err != nil {
		return api.BaselineResponse{}, fmt.Errorf("unknown tz %q: %w", req.TZ, err)
	}

	periodReq := summary.Request{
		Range: req.Range, Metrics: req.Metrics, TZ: req.TZ, From: req.From, To: req.To,
	}
	_, periodStart, periodEnd := summary.Window(periodReq, loc)
	refFrom, refTo := ReferenceWindow(Anchor(periodEnd, s.clock(), loc), loc)

	// ⚠️ `month` here picks the BUCKET WIDTH ONLY — one day — while from/to move the
	// window (summary.window). This is the same request the phone makes for its own
	// reference window, which is what makes the two bands the same arithmetic over
	// the same numbers.
	ref, err := s.summary.Compute(ctx, userID, summary.Request{
		Range: "month", Metrics: req.Metrics, TZ: req.TZ, From: &refFrom, To: &refTo,
	})
	if err != nil {
		return api.BaselineResponse{}, fmt.Errorf("reference window: %w", err)
	}
	period, err := s.summary.Compute(ctx, userID, periodReq)
	if err != nil {
		return api.BaselineResponse{}, fmt.Errorf("period window: %w", err)
	}

	windows := Windows{
		From: periodStart, To: periodEnd.AddDate(0, 0, -1),
		ReferenceFrom: refFrom, ReferenceTo: refTo,
	}
	return build(req.Range, req.TZ, windows, ref, period), nil
}

func (s *Service) clock() time.Time {
	if s.now != nil {
		return s.now()
	}
	return time.Now()
}
