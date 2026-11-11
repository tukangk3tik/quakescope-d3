package quake

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const MaxHistoryEvents = 1500
const MaxHistoryRange = 31 * 24 * time.Hour

type HistoryQuery struct {
	Start        time.Time
	End          time.Time
	MinMagnitude float64
	Limit        int
}

type HistoryResult struct {
	Events      []Event `json:"events"`
	Total       int     `json:"total"`
	Returned    int     `json:"returned"`
	Truncated   bool    `json:"truncated"`
	Source      string  `json:"source"`
	Attribution string  `json:"attribution"`
	Suggestion  string  `json:"suggestion,omitempty"`
}

func ParseHistoryQuery(values url.Values, now time.Time) (HistoryQuery, error) {
	start, err := time.Parse(time.RFC3339, values.Get("start"))
	if err != nil {
		return HistoryQuery{}, fmt.Errorf("start must be an RFC3339 timestamp")
	}
	end, err := time.Parse(time.RFC3339, values.Get("end"))
	if err != nil {
		return HistoryQuery{}, fmt.Errorf("end must be an RFC3339 timestamp")
	}
	q := HistoryQuery{Start: start.UTC(), End: end.UTC(), MinMagnitude: 2.5, Limit: MaxHistoryEvents}
	if !q.Start.Before(q.End) {
		return q, fmt.Errorf("start must be before end")
	}
	if q.End.Sub(q.Start) > MaxHistoryRange {
		return q, fmt.Errorf("date range must not exceed 31 days")
	}
	if q.End.After(now.Add(5 * time.Minute)) {
		return q, fmt.Errorf("end must not be in the future")
	}
	if values.Has("minMagnitude") {
		q.MinMagnitude, err = strconv.ParseFloat(values.Get("minMagnitude"), 64)
		if err != nil || q.MinMagnitude < 0 || q.MinMagnitude > 10.5 {
			return q, fmt.Errorf("minMagnitude must be between 0 and 10.5")
		}
	}
	if values.Has("limit") {
		q.Limit, err = strconv.Atoi(values.Get("limit"))
		if err != nil || q.Limit < 1 || q.Limit > MaxHistoryEvents {
			return q, fmt.Errorf("limit must be between 1 and %d", MaxHistoryEvents)
		}
	}
	return q, nil
}

func HistoryURL(base string, q HistoryQuery) string {
	v := url.Values{"format": {"geojson"}, "starttime": {q.Start.Format(time.RFC3339)}, "endtime": {q.End.Format(time.RFC3339)}, "minmagnitude": {strconv.FormatFloat(q.MinMagnitude, 'f', -1, 64)}}
	v.Set("orderby", "time-asc")
	v.Set("limit", strconv.Itoa(q.Limit))
	return base + "?" + v.Encode()
}

func historyCountURL(base string, q HistoryQuery) string {
	v := url.Values{"starttime": {q.Start.Format(time.RFC3339)}, "endtime": {q.End.Format(time.RFC3339)}, "minmagnitude": {strconv.FormatFloat(q.MinMagnitude, 'f', -1, 64)}}
	return strings.TrimSuffix(base, "/query") + "/count?" + v.Encode()
}

type historyEntry struct {
	result  HistoryResult
	expires time.Time
}

// MaxHistoryCacheEntries bounds how many query results the history cache holds.
// Every distinct start, end, magnitude and limit combination is a separate key
// and all four come from the request, so the number of keys is set by clients
// rather than by the catalog: without a bound the map only grows.
const MaxHistoryCacheEntries = 256

type HistoryService struct {
	client *http.Client
	base   string
	ttl    time.Duration
	mu     sync.Mutex
	cache  map[string]historyEntry
}

func NewHistoryService(client *http.Client, base string, ttl time.Duration) *HistoryService {
	return &HistoryService{client: client, base: base, ttl: ttl, cache: make(map[string]historyEntry)}
}

func (s *HistoryService) Query(ctx context.Context, q HistoryQuery) (HistoryResult, error) {
	key := HistoryURL(s.base, q)
	now := time.Now()
	s.mu.Lock()
	if e, ok := s.cache[key]; ok && now.Before(e.expires) {
		s.mu.Unlock()
		return e.result, nil
	}
	s.mu.Unlock()
	events, err := Fetch(ctx, s.client, key, ParseUSGS)
	if err != nil {
		return HistoryResult{}, err
	}
	sort.SliceStable(events, func(i, j int) bool {
		if events[i].Occurred.Equal(events[j].Occurred) {
			return events[i].ID < events[j].ID
		}
		return events[i].Occurred.Before(events[j].Occurred)
	})
	total := len(events)
	// The catalog count endpoint distinguishes a bounded response from all matches.
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, historyCountURL(s.base, q), nil)
	if resp, countErr := s.client.Do(req); countErr == nil {
		defer resp.Body.Close()
		if resp.StatusCode == http.StatusOK {
			body, _ := io.ReadAll(io.LimitReader(resp.Body, 64))
			if count, parseErr := strconv.Atoi(strings.TrimSpace(string(body))); parseErr == nil && count > total {
				total = count
			}
		}
	}
	result := HistoryResult{Events: events, Total: total, Returned: len(events), Truncated: total > len(events), Source: "usgs", Attribution: "U.S. Geological Survey Earthquake Catalog"}
	if result.Truncated {
		result.Suggestion = "Increase the minimum magnitude or select a shorter time range to view a more complete result."
	}
	s.mu.Lock()
	s.store(key, historyEntry{result: result, expires: time.Now().Add(s.ttl)})
	s.mu.Unlock()
	return result, nil
}

// store records a result and keeps the map from growing without bound: entries
// that can no longer be reused are dropped first, then the entry closest to
// expiry makes room when the cap is reached. The caller holds s.mu.
func (s *HistoryService) store(key string, entry historyEntry) {
	now := time.Now()
	for k, cached := range s.cache {
		if !now.Before(cached.expires) {
			delete(s.cache, k)
		}
	}
	if _, cached := s.cache[key]; !cached && len(s.cache) >= MaxHistoryCacheEntries {
		oldestKey := ""
		var oldestExpiry time.Time
		for k, cached := range s.cache {
			if oldestKey == "" || cached.expires.Before(oldestExpiry) {
				oldestKey, oldestExpiry = k, cached.expires
			}
		}
		delete(s.cache, oldestKey)
	}
	s.cache[key] = entry
}
