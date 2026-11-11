package quake

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func historyValues() url.Values {
	return url.Values{"start": {"2026-11-01T00:00:00Z"}, "end": {"2026-11-08T00:00:00Z"}, "minMagnitude": {"4.5"}, "limit": {"25"}}
}

func TestParseHistoryQuery(t *testing.T) {
	q, err := ParseHistoryQuery(historyValues(), time.Date(2026, 11, 9, 0, 0, 0, 0, time.UTC))
	if err != nil || q.Start.Location() != time.UTC || q.MinMagnitude != 4.5 || q.Limit != 25 {
		t.Fatal(q, err)
	}
	bad := []url.Values{{}, {"start": {"2026-01-01T00:00:00Z"}, "end": {"2026-03-01T00:00:00Z"}}, {"start": {"2026-11-08T00:00:00Z"}, "end": {"2026-11-01T00:00:00Z"}}}
	for _, v := range bad {
		if _, err := ParseHistoryQuery(v, time.Now()); err == nil {
			t.Fatal("expected validation error", v)
		}
	}
}

func TestHistoryURLAndSortingTruncationCache(t *testing.T) {
	var calls atomic.Int32
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path == "/count" {
			w.Write([]byte("3"))
			return
		}
		if r.URL.Query().Get("orderby") != "time-asc" {
			t.Error("missing ordering")
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"metadata":{"count":3},"features":[{"id":"b","properties":{"mag":5,"time":2000},"geometry":{"coordinates":[2,2,2]}},{"id":"a","properties":{"mag":4,"time":1000},"geometry":{"coordinates":[1,1,1]}}]}`))
	}))
	defer ts.Close()
	q := HistoryQuery{Start: time.Unix(0, 0).UTC(), End: time.Unix(10, 0).UTC(), MinMagnitude: 2.5, Limit: 2}
	s := NewHistoryService(ts.Client(), ts.URL, time.Minute)
	r, err := s.Query(context.Background(), q)
	if err != nil || len(r.Events) != 2 || r.Events[0].SourceID != "a" || !r.Truncated || r.Total != 3 {
		t.Fatal(r, err)
	}
	_, _ = s.Query(context.Background(), q)
	if calls.Load() != 2 {
		t.Fatalf("cache missed: %d calls", calls.Load())
	}
	if got := HistoryURL(ts.URL, q); !strings.Contains(got, "orderby=time-asc") || !strings.Contains(got, "limit=2") {
		t.Fatal(got)
	}
}

func TestHistoryUpstreamFailure(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Error(w, "no", 503) }))
	defer ts.Close()
	_, err := NewHistoryService(ts.Client(), ts.URL, time.Minute).Query(context.Background(), HistoryQuery{Start: time.Unix(0, 0), End: time.Unix(1, 0), Limit: 1})
	if err == nil {
		t.Fatal("expected upstream failure")
	}
}

func emptyCatalog() *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/count" {
			w.Write([]byte("0"))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"metadata":{"count":0},"features":[]}`))
	}))
}

func historyQuery(startSeconds int64) HistoryQuery {
	return HistoryQuery{Start: time.Unix(startSeconds, 0).UTC(), End: time.Unix(startSeconds+60, 0).UTC(), MinMagnitude: 2.5, Limit: 1}
}

func TestHistoryCacheDropsExpiredEntries(t *testing.T) {
	ts := emptyCatalog()
	defer ts.Close()
	// A negative TTL makes every stored result unusable on arrival, so each
	// query must find room by evicting what it can no longer serve.
	s := NewHistoryService(ts.Client(), ts.URL, -time.Second)
	for i := int64(0); i < 5; i++ {
		if _, err := s.Query(context.Background(), historyQuery(i*600)); err != nil {
			t.Fatal(err)
		}
	}
	s.mu.Lock()
	cached := len(s.cache)
	s.mu.Unlock()
	if cached != 1 {
		t.Fatalf("expired results retained: %d entries", cached)
	}
}

func TestHistoryCacheStaysBounded(t *testing.T) {
	ts := emptyCatalog()
	defer ts.Close()
	s := NewHistoryService(ts.Client(), ts.URL, time.Hour)
	for i := int64(0); i < MaxHistoryCacheEntries+16; i++ {
		if _, err := s.Query(context.Background(), historyQuery(i*600)); err != nil {
			t.Fatal(err)
		}
	}
	s.mu.Lock()
	cached := len(s.cache)
	s.mu.Unlock()
	if cached > MaxHistoryCacheEntries {
		t.Fatalf("cache grew past its cap: %d entries", cached)
	}
	if cached != MaxHistoryCacheEntries {
		t.Fatalf("cache evicted more than it had to: %d entries", cached)
	}
}
