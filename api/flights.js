const SERPAPI_URL = "https://serpapi.com/search.json";

function mapFlightGroup(g) {
  const legs = g.flights || [];
  const first = legs[0] || {};
  const last = legs[legs.length - 1] || {};
  return {
    price: g.price,
    total_duration_min: g.total_duration,
    stops: Math.max(legs.length - 1, 0),
    type: g.type,
    airlines: [...new Set(legs.map((l) => l.airline).filter(Boolean))],
    departure: first.departure_airport,
    arrival: last.arrival_airport,
    layovers: (g.layovers || []).map((l) => ({
      airport: l.name,
      id: l.id,
      duration_min: l.duration,
      overnight: !!l.overnight,
    })),
    legs: legs.map((l) => ({
      flight_number: l.flight_number,
      airline: l.airline,
      airplane: l.airplane,
      travel_class: l.travel_class,
      duration_min: l.duration,
      from: l.departure_airport,
      to: l.arrival_airport,
    })),
    carbon_emissions: g.carbon_emissions,
    departure_token: g.departure_token,
  };
}

async function searchFlights(args) {
  const key = process.env.SERPAPI_API_KEY;
  if (!key) throw new Error("SERPAPI_API_KEY is not configured on the server");

  const params = new URLSearchParams({
    engine: "google_flights",
    api_key: key,
    departure_id: String(args.departure_id).toUpperCase(),
    arrival_id: String(args.arrival_id).toUpperCase(),
    outbound_date: args.outbound_date,
    currency: args.currency || "USD",
    hl: "en",
    adults: String(args.adults || 1),
    // 1 = round trip, 2 = one way
    type: args.return_date ? "1" : "2",
    // 2 = sort by price
    sort_by: args.sort_by ? String(args.sort_by) : "2",
  });
  if (args.return_date) params.set("return_date", args.return_date);
  if (args.max_price) params.set("max_price", String(args.max_price));
  if (args.stops !== undefined) params.set("stops", String(args.stops));
  if (args.travel_class) params.set("travel_class", String(args.travel_class));

  const res = await fetch(`${SERPAPI_URL}?${params}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(data.error || `SerpApi request failed with HTTP ${res.status}`);
  }

  const all = [...(data.best_flights || []), ...(data.other_flights || [])]
    .filter((g) => typeof g.price === "number")
    .map(mapFlightGroup)
    .sort((a, b) => a.price - b.price);

  const limit = Math.min(Math.max(args.limit || 5, 1), 20);
  return {
    search: {
      from: params.get("departure_id"),
      to: params.get("arrival_id"),
      outbound_date: args.outbound_date,
      return_date: args.return_date || null,
      currency: params.get("currency"),
      adults: Number(params.get("adults")),
    },
    cheapest: all[0] || null,
    flights: all.slice(0, limit),
    total_found: all.length,
    price_insights: data.price_insights
      ? {
          lowest_price: data.price_insights.lowest_price,
          price_level: data.price_insights.price_level,
          typical_price_range: data.price_insights.typical_price_range,
        }
      : null,
    google_flights_url: data.search_metadata?.google_flights_url || null,
  };
}

module.exports = { searchFlights };
