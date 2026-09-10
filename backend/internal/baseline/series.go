package baseline

import (
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/nordic-sys/helsa/backend/internal/api"
)

// DailyValues are the MEASURED days of a daily-bucketed series.
//
// ⚠️ **A bucket with no value is skipped, never read as a zero.** That is the
// whole point of /summary leaving the field absent (see summary.makeBucket): "0
// steps" and "no measurement arrived" are two different statements, and in a
// health app the first is alarming while the second is perfectly normal. A
// measured zero, on the other hand, IS a zero and stays in — it counts towards the
// minimum and towards the mean.
//
// A summed metric fills `v` and an averaged one `avg`, never both; taking
// whichever is present is the same rule the app applies when the series it
// received disagrees with the aggregation it expected.
func DailyValues(ms api.MetricSeries) []float64 {
	if ms.Buckets == nil {
		return nil
	}
	out := make([]float64, 0, len(*ms.Buckets))
	for _, b := range *ms.Buckets {
		switch {
		case b.V != nil:
			out = append(out, float64(*b.V))
		case b.Avg != nil:
			out = append(out, float64(*b.Avg))
		}
	}
	return out
}

// Windows are the two day spans a response is built over: the period being looked
// at and the reference it is judged against. Every end is an INCLUSIVE day, the
// shape they go out on the wire in.
type Windows struct {
	From, To                   time.Time
	ReferenceFrom, ReferenceTo time.Time
}

// build assembles the response from the two /summary windows.
//
// The metric set comes from the reference response, because /summary answers for
// every metric that was asked about — with an empty series if it has no data
// (summary.fillMissingSeries). So a metric that carries nothing still gets an
// entry here, with a day_count of 0: "we looked, and there is not enough yet" is
// an answer, and a silently absent key is not.
func build(rangeName, tz string, w Windows, ref, period api.SummaryResponse) api.BaselineResponse {
	out := map[string]api.MetricBaseline{}
	for name, refSeries := range deref(ref.Metrics) {
		values := DailyValues(refSeries)
		mb := api.MetricBaseline{
			Unit:     refSeries.Unit,
			DayCount: intPtr(len(values)),
		}
		if refSeries.Agg != nil {
			agg := api.MetricBaselineAgg(*refSeries.Agg)
			mb.Agg = &agg
		}

		band := Make(values)
		if band != nil {
			mb.Mean = f32(band.Mean)
			mb.Sd = f32(band.SD)
			mb.Low = f32(band.Low())
			mb.High = f32(band.High())
			// The count the band actually rests on, which is the same number — but it is
			// taken from the band rather than recomputed, so the two can never drift.
			mb.DayCount = intPtr(band.DayCount)
		}

		if value, ok := Average(DailyValues(deref(period.Metrics)[name])); ok {
			mb.PeriodValue = f32(value)
			// ⚠️ No band, no standing. There is no weaker claim to fall back on: with fewer
			// than MinReferenceDays measured days we do not know what usual looks like, and
			// "typical" would be the loudest lie this file could tell.
			if band != nil {
				standing := band.Standing(value)
				mb.Standing = &standing
			}
		}
		out[name] = mb
	}

	refDays, minDays := ReferenceDays, MinReferenceDays
	return api.BaselineResponse{
		Range:         &rangeName,
		Tz:            &tz,
		From:          datePtr(w.From),
		To:            datePtr(w.To),
		ReferenceFrom: datePtr(w.ReferenceFrom),
		ReferenceTo:   datePtr(w.ReferenceTo),
		ReferenceDays: &refDays,
		MinDays:       &minDays,
		Metrics:       &out,
	}
}

func deref(m *map[string]api.MetricSeries) map[string]api.MetricSeries {
	if m == nil {
		return nil
	}
	return *m
}

func datePtr(t time.Time) *openapi_types.Date {
	d := openapi_types.Date{Time: t}
	return &d
}

func intPtr(v int) *int { return &v }

func f32(v float64) *float32 {
	f := float32(v)
	return &f
}
