/**
 * news-intelligence.ts - NewsAPI integration for logistics disruption signals.
 *
 * Fetches Nigeria-focused news articles matching logistics disruption keywords,
 * normalizes them into Incident records, deduplicates, persists to
 * incident_events collection, and returns a risk contribution score.
 *
 * News data directly contributes to:
 *   - Operational Risk Score (via disruptionProbability)
 *   - Delay Probability
 *   - Disruption Probability
 *
 * Server-side only. Requires NEWS_API_KEY environment variable.
 */

import { getDb } from "../mongodb";
import { createIntelligenceAudit } from "../intelligence-audit";
import { getCurrentDate } from "../time";
import type { Incident, IncidentCategory } from "../types";
import { NEWS_API_KEY } from "../env";

// ─── NewsAPI response shapes ──────────────────────────────────────────────────

interface NewsAPIArticle {
  title:        string | null;
  description:  string | null;
  url:          string;
  publishedAt:  string;
  source:       { name: string };
}

interface NewsAPIResponse {
  status:       string;
  totalResults: number;
  articles:     NewsAPIArticle[];
}

// ─── Disruption keyword groups ────────────────────────────────────────────────

// Strictly scoped to Nigerian logistics events.
const DISRUPTION_QUERY = "(highway OR expressway OR truck OR freight OR logistics OR cargo OR port) AND (accident OR strike OR protest OR landslide OR flood) AND Nigeria";
const EXCLUSION_QUERY = "-cricket -IPL -Bollywood -movie -cinema -actor -sports -match";
const FULL_QUERY = `${DISRUPTION_QUERY} ${EXCLUSION_QUERY}`;

// ─── Region coordinate lookup ─────────────────────────────────────────────────
// Maps Nigerian city/state keywords to approximate lat/lng centre points.

const REGION_COORDS: Array<{
  keywords: string[];
  lat:      number;
  lng:      number;
  city:     string;
  state:    string;
}> = [
  { keywords: ["lagos", "lekki", "ikeja", "ikorodu", "lagos-ibadan"], lat: 6.5244, lng: 3.3792, city: "Lagos", state: "Lagos" },
  { keywords: ["abuja", "fct", "federal capital territory", "garki", "gwagwalada"], lat: 9.0765, lng: 7.3986, city: "Abuja", state: "Federal Capital Territory" },
  { keywords: ["kano"], lat: 12.0022, lng: 8.5920, city: "Kano", state: "Kano" },
  { keywords: ["port harcourt", "rivers"], lat: 4.8156, lng: 7.0498, city: "Port Harcourt", state: "Rivers" },
  { keywords: ["ibadan", "oyo"], lat: 7.3775, lng: 3.9470, city: "Ibadan", state: "Oyo" },
  { keywords: ["kaduna"], lat: 10.5105, lng: 7.4165, city: "Kaduna", state: "Kaduna" },
  { keywords: ["benin city", "edo"], lat: 6.3350, lng: 5.6037, city: "Benin City", state: "Edo" },
  { keywords: ["maiduguri", "borno"], lat: 11.8311, lng: 13.1510, city: "Maiduguri", state: "Borno" },
  { keywords: ["enugu"], lat: 6.4584, lng: 7.5464, city: "Enugu", state: "Enugu" },
  { keywords: ["jos", "plateau"], lat: 9.8965, lng: 8.8583, city: "Jos", state: "Plateau" },
  { keywords: ["sokoto"], lat: 13.0059, lng: 5.2476, city: "Sokoto", state: "Sokoto" },
  { keywords: ["calabar", "cross river"], lat: 4.9517, lng: 8.3220, city: "Calabar", state: "Cross River" },
  { keywords: ["ilorin", "kwara"], lat: 8.4966, lng: 4.5421, city: "Ilorin", state: "Kwara" },
  { keywords: ["akure", "ondo"], lat: 7.2571, lng: 5.2058, city: "Akure", state: "Ondo" },
  { keywords: ["onitsha", "anambra"], lat: 6.1667, lng: 6.7833, city: "Onitsha", state: "Anambra" },
  { keywords: ["lokoja", "kogi"], lat: 7.8023, lng: 6.7333, city: "Lokoja", state: "Kogi" },
  { keywords: ["minna", "niger state"], lat: 9.6139, lng: 6.5569, city: "Minna", state: "Niger" },
  { keywords: ["bauchi"], lat: 10.3103, lng: 9.8439, city: "Bauchi", state: "Bauchi" },
  { keywords: ["yenagoa", "bayelsa"], lat: 4.9267, lng: 6.2676, city: "Yenagoa", state: "Bayelsa" },
];

/**
 * Extracts a lat/lng and region details for an article based on geographic keywords in title+description.
 * Falls back to Nigeria's centre if no region is recognised.
 */
function extractCoords(text: string): { lat: number; lng: number; city: string; state: string } {
  const lower = text.toLowerCase();
  for (const region of REGION_COORDS) {
    if (region.keywords.some((kw) => lower.includes(kw))) {
      return { lat: region.lat, lng: region.lng, city: region.city, state: region.state };
    }
  }
  return { lat: 9.0820, lng: 8.6753, city: "Nigeria", state: "national" };
}

// ─── Keyword → category + severity mapping ────────────────────────────────────

interface ClassificationResult {
  category:         IncidentCategory;
  severity:         "low" | "medium" | "high" | "critical";
  impactScore:      number;
  riskContribution: number;
  logisticsImpact:  string;
  estimatedDelayMinutes: number;
}

function classifyArticle(text: string): ClassificationResult {
  const lower = text.toLowerCase();
  if (lower.includes("strike") || lower.includes("blockade") || lower.includes("civil unrest")) {
    return { category: "Political", severity: "high", impactScore: 75, riskContribution: 20, logisticsImpact: "Fleet immobilization and highway blocks", estimatedDelayMinutes: 240 };
  }
  if (lower.includes("landslide") || lower.includes("flood") || lower.includes("flooded")) {
    return { category: "Natural Disaster", severity: "critical", impactScore: 90, riskContribution: 30, logisticsImpact: "Complete route closure, severe detours required", estimatedDelayMinutes: 480 };
  }
  if (lower.includes("road closure") || lower.includes("highway closure")) {
    return { category: "Road Closure", severity: "high", impactScore: 70, riskContribution: 18, logisticsImpact: "Mandatory rerouting", estimatedDelayMinutes: 120 };
  }
  if (lower.includes("accident")) {
    return { category: "Accident", severity: "medium", impactScore: 55, riskContribution: 12, logisticsImpact: "Slow moving traffic and temporary bottleneck", estimatedDelayMinutes: 60 };
  }
  if (lower.includes("traffic disruption") || lower.includes("congestion")) {
    return { category: "Traffic", severity: "medium", impactScore: 50, riskContribution: 10, logisticsImpact: "Moderate slowdowns", estimatedDelayMinutes: 30 };
  }
  if (lower.includes("protest") || lower.includes("rally")) {
    return { category: "Public Event", severity: "medium", impactScore: 45, riskContribution: 8, logisticsImpact: "Localized restricted access", estimatedDelayMinutes: 45 };
  }
  if (lower.includes("transport strike") || lower.includes("truck strike") || lower.includes("logistics disruption")) {
    return { category: "Restriction", severity: "high", impactScore: 65, riskContribution: 16, logisticsImpact: "State boundary crossing delays", estimatedDelayMinutes: 180 };
  }
  return { category: "Unknown", severity: "low", impactScore: 20, riskContribution: 5, logisticsImpact: "Minor operational friction", estimatedDelayMinutes: 15 };
}

// ─── Deterministic ID from URL ────────────────────────────────────────────────

function articleToIncidentId(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const chr = url.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return `news-${Math.abs(hash).toString(36)}`;
}

// ─── Normalizer ───────────────────────────────────────────────────────────────

function normalizeArticle(article: NewsAPIArticle): Incident | null {
  const title       = article.title ?? "";
  const description = article.description ?? "";
  const combined    = `${title} ${description}`;

  if (!title || title === "[Removed]") return null;

  const classification = classifyArticle(combined);
  const incidentId     = articleToIncidentId(article.url);
  const now            = getCurrentDate().toISOString();
  const location       = extractCoords(combined);

  return {
    incidentId,
    title:             title.slice(0, 150),
    description:       description.slice(0, 300) || `${classification.category} event reported.`,
    category:          classification.category,
    severity:          classification.severity,
    confidence:        75,
    latitude:          location.lat,
    longitude:         location.lng,
    affectedState:     location.state,
    affectedCity:      location.city,
    logisticsImpact:   classification.logisticsImpact,
    estimatedDelayMinutes: classification.estimatedDelayMinutes,
    affectedRadiusKm:  classification.severity === "critical" ? 150
                     : classification.severity === "high"     ? 100
                     : 50,
    startTime:         article.publishedAt,
    lastUpdated:       now,
    source:            `NewsAPI:${article.source.name}`,
    verifiedStatus:    false,
    impactScore:       classification.impactScore,
    recommendedAction: classification.severity === "critical"
      ? "Reroute immediately - major disruption reported"
      : classification.severity === "high"
      ? "Evaluate alternate corridor routes"
      : "Monitor situation closely",
  };
}

// ─── Persistence with deduplication ──────────────────────────────────────────

async function persistIncidents(incidents: Incident[]): Promise<void> {
  if (incidents.length === 0) return;
  const db = await getDb();
  await Promise.all(
    incidents.map(async (inc) => {
      const existing = await db.collection("incident_events").findOne({ incidentId: inc.incidentId });
      await db.collection("incident_events").updateOne(
        { incidentId: inc.incidentId },
        { $set: inc },
        { upsert: true }
      );
      createIntelligenceAudit({
        companyId:  "system",
        incidentId: inc.incidentId,
        eventType:  existing ? "incident_updated" : "incident_detected",
        source:     "NewsIntelligence",
        metadata: { title: inc.title, category: inc.category, severity: inc.severity, source: inc.source },
      }).catch(() => {});
    })
  );
}

// ─── Risk contribution ────────────────────────────────────────────────────────

export interface NewsRiskContribution {
  disruptionBonus:     number;
  delayBonus:          number;
  affectedCategories:  IncidentCategory[];
  articleCount:        number;
  normalizedIncidents: Incident[];
}

// Helper: Generate clearly marked demo incidents with CURRENT timestamp
// Must be called at runtime, not at module level, to ensure timestamps stay fresh
function getMockNewsArticles(): NewsAPIArticle[] {
  const now = getCurrentDate().toISOString();
  return [
    {
      title:       "Demo: Heavy traffic on the Lagos-Ibadan Expressway",
      description: "Simulated logistics disruption near the Lagos-Ibadan Expressway for demonstration purposes.",
      url:         "https://example.invalid/sentinelroute-demo/lagos-ibadan",
      publishedAt: now,
      source:      { name: "SentinelRoute Demo" },
    },
    {
      title:       "Demo: Rain-related route disruption near Port Harcourt",
      description: "Simulated heavy-rain logistics disruption in Rivers State for demonstration purposes.",
      url:         "https://example.invalid/sentinelroute-demo/port-harcourt",
      publishedAt: now,
      source:      { name: "SentinelRoute Demo" },
    },
    {
      title:       "Demo: Market-day congestion in Kano",
      description: "Simulated public-event congestion in Kano for demonstration purposes.",
      url:         "https://example.invalid/sentinelroute-demo/kano",
      publishedAt: now,
      source:      { name: "SentinelRoute Demo" },
    },
  ];
}

export async function getNewsRiskContribution(
  companyId:   string,
  shipmentId?: string
): Promise<NewsRiskContribution> {
  const EMPTY: NewsRiskContribution = {
    disruptionBonus:     0,
    delayBonus:          0,
    affectedCategories:  [],
    articleCount:        0,
    normalizedIncidents: [],
  };

  const apiKey = NEWS_API_KEY();
  let articles: NewsAPIArticle[] = [];

  if (!apiKey) {
    console.warn("[news-intelligence] NEWS_API_KEY not set - using deterministic mock news");
    articles = getMockNewsArticles();
  } else {
    try {
      const url =
        `https://newsapi.org/v2/everything` +
        `?q=${encodeURIComponent(FULL_QUERY)}` +
        `&language=en` +
        `&sortBy=publishedAt` +
        `&pageSize=20` +
        `&apiKey=${apiKey}`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(url, {
        next: { revalidate: 3600 },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        const data: NewsAPIResponse = await res.json();
        if (data.status === "ok" && Array.isArray(data.articles)) {
          articles = data.articles;
        }
      }
    } catch (err) {
      console.error("[news-intelligence] NewsAPI fetch failed, returning empty:", err);
      return EMPTY;
    }

    if (articles.length === 0) {
      console.warn("[news-intelligence] No articles returned - using mock news");
      articles = getMockNewsArticles();
    }
  }

  try {
    const normalized: Incident[] = articles
      .map(normalizeArticle)
      .filter((x): x is Incident => x !== null);

    if (normalized.length === 0) return EMPTY;

    persistIncidents(normalized).catch((err) =>
      console.error("[news-intelligence] Persist failed:", err)
    );

    const categories = new Set<IncidentCategory>();
    let disruptionBonus = 0;
    let delayBonus      = 0;

    for (const inc of normalized) {
      const cls = classifyArticle(`${inc.title} ${inc.description}`);
      disruptionBonus += cls.riskContribution;
      delayBonus      += Math.round(cls.riskContribution * 0.6);
      categories.add(inc.category);
    }

    disruptionBonus = Math.min(40, disruptionBonus);
    delayBonus      = Math.min(25, delayBonus);

    createIntelligenceAudit({
      companyId,
      shipmentId,
      eventType: "news_risk_added",
      source:    "NewsIntelligence",
      metadata:  { articleCount: normalized.length, disruptionBonus, delayBonus, categories: Array.from(categories) },
    }).catch(() => {});

    return {
      disruptionBonus,
      delayBonus,
      affectedCategories:  Array.from(categories),
      articleCount:        normalized.length,
      normalizedIncidents: normalized,
    };
  } catch (err) {
    console.error("[news-intelligence] Processing error:", err);
    return EMPTY;
  }
}
