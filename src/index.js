import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

const NVIDIA_URL =
  "https://integrate.api.nvidia.com/v1/chat/completions";

const NVIDIA_MODEL =
  "nvidia/nemotron-3-ultra-550b-a55b";

/* =========================================================
   HELPERS
========================================================= */

function cleanText(value = "") {
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitle(value = "") {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function normalizeDoi(value = "") {
  return String(value)
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .trim()
    .toLowerCase();
}

function reconstructOpenAlexAbstract(index) {
  if (!index || typeof index !== "object") return "";

  const positions = [];

  for (const [word, locs] of Object.entries(index)) {
    if (!Array.isArray(locs)) continue;

    for (const position of locs) {
      positions.push([position, word]);
    }
  }

  positions.sort((a, b) => a[0] - b[0]);

  return positions.map((x) => x[1]).join(" ");
}

function safeYear(value) {
  if (!value) return null;

  if (typeof value === "number") return value;

  const match = String(value).match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function firstString(value) {
  if (Array.isArray(value)) {
    return value.find(Boolean) || "";
  }
  return value || "";
}

function deduplicate(records) {
  const seen = new Set();
  const output = [];

  for (const item of records) {
    const doi = normalizeDoi(item.doi || "");
    const titleKey = normalizeTitle(item.title || "");

    const key = doi
      ? `doi:${doi}`
      : titleKey
      ? `title:${titleKey}`
      : `${item.source}:${item.id}`;

    if (!key || seen.has(key)) continue;

    seen.add(key);
    output.push({
      ...item,
      doi
    });
  }

  return output;
}

function truncate(value = "", max = 4000) {
  const text = cleanText(value);
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}

/* =========================================================
   OPENALEX
========================================================= */

async function searchOpenAlex(env, query, limit) {
  const params = new URLSearchParams({
    search: query,
    per_page: String(Math.min(Math.max(limit, 1), 100))
  });

  if (env.OPENALEX_API_KEY) {
    params.set("api_key", env.OPENALEX_API_KEY);
  }

  const url =
    `https://api.openalex.org/works?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(
      `OpenAlex ${response.status}: ${await response.text()}`
    );
  }

  const data = await response.json();

  return (data.results || []).map((work) => ({
    source: "OpenAlex",
    id: work.id || "",
    title: cleanText(work.title),
    abstract: reconstructOpenAlexAbstract(
      work.abstract_inverted_index
    ),
    year: work.publication_year || null,
    doi: normalizeDoi(work.doi || ""),
    authors: (work.authorships || [])
      .map((a) => a.author?.display_name)
      .filter(Boolean),
    venue:
      work.primary_location?.source?.display_name ||
      work.host_venue?.display_name ||
      "",
    citedBy:
      work.cited_by_count ?? null,
    url:
      work.doi ||
      work.primary_location?.landing_page_url ||
      work.id ||
      ""
  }));
}

/* =========================================================
   IEEE XPLORE
========================================================= */

async function searchIEEE(env, query, limit) {
  if (!env.IEEE_API_KEY) {
    return [];
  }

  const params = new URLSearchParams({
    apikey: env.IEEE_API_KEY,
    format: "json",
    max_records: String(
      Math.min(Math.max(limit, 1), 200)
    ),
    start_record: "1",
    sort_order: "desc",
    sort_field: "article_title",
    querytext: query
  });

  const url =
    `https://ieeexploreapi.ieee.org/api/v1/search/articles?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(
      `IEEE ${response.status}: ${await response.text()}`
    );
  }

  const data = await response.json();

  return (data.articles || []).map((article) => ({
    source: "IEEE Xplore",
    id:
      article.article_number ||
      article.content_type ||
      "",
    title: cleanText(article.title),
    abstract: cleanText(article.abstract),
    year: safeYear(article.publication_year),
    doi: normalizeDoi(article.doi || ""),
    authors: (article.authors?.authors || [])
      .map(
        (a) =>
          a.full_name ||
          [a.first_name, a.last_name]
            .filter(Boolean)
            .join(" ")
      )
      .filter(Boolean),
    venue:
      article.publication_title ||
      article.publisher ||
      "",
    citedBy: null,
    url:
      article.html_url ||
      article.pdf_url ||
      (article.doi
        ? `https://doi.org/${normalizeDoi(article.doi)}`
        : "")
  }));
}

/* =========================================================
   CROSSREF
========================================================= */

async function searchCrossref(query, limit) {
  const params = new URLSearchParams({
    "query.bibliographic": query,
    rows: String(
      Math.min(Math.max(limit, 1), 1000)
    ),
    select:
      "DOI,title,author,published,container-title,abstract,URL,is-referenced-by-count"
  });

  const url =
    `https://api.crossref.org/works?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent":
        "TRT-Research/6.0 (academic research)"
    }
  });

  if (!response.ok) {
    throw new Error(
      `Crossref ${response.status}: ${await response.text()}`
    );
  }

  const data = await response.json();
  const items = data.message?.items || [];

  return items.map((work) => {
    const dateParts =
      work.published?.["date-parts"]?.[0] || [];

    return {
      source: "Crossref",
      id: work.DOI || work.URL || "",
      title: cleanText(firstString(work.title)),
      abstract: cleanText(work.abstract),
      year: safeYear(dateParts[0]),
      doi: normalizeDoi(work.DOI || ""),
      authors: (work.author || [])
        .map((a) =>
          [a.given, a.family]
            .filter(Boolean)
            .join(" ")
        )
        .filter(Boolean),
      venue: cleanText(
        firstString(work["container-title"])
      ),
      citedBy:
        work["is-referenced-by-count"] ?? null,
      url:
        work.URL ||
        (work.DOI
          ? `https://doi.org/${normalizeDoi(work.DOI)}`
          : "")
    };
  });
}

/* =========================================================
   EUROPE PMC
========================================================= */

async function searchEuropePMC(query, limit) {
  const params = new URLSearchParams({
    query,
    format: "json",
    resultType: "core",
    pageSize: String(
      Math.min(Math.max(limit, 1), 1000)
    )
  });

  const url =
    `https://www.ebi.ac.uk/europepmc/webservices/rest/search?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(
      `Europe PMC ${response.status}: ${await response.text()}`
    );
  }

  const data = await response.json();
  const results = data.resultList?.result || [];

  return results.map((work) => ({
    source: "Europe PMC",
    id:
      work.pmid ||
      work.pmcid ||
      work.id ||
      "",
    title: cleanText(work.title),
    abstract: cleanText(work.abstractText),
    year: safeYear(
      work.pubYear ||
      work.firstPublicationDate
    ),
    doi: normalizeDoi(work.doi || ""),
    authors:
      work.authorList?.author
        ?.map((a) => a.fullName)
        .filter(Boolean) || [],
    venue:
      work.journalInfo?.journal?.title ||
      work.journalTitle ||
      "",
    citedBy:
      work.citedByCount ?? null,
    pmid: work.pmid || "",
    pmcid: work.pmcid || "",
    url: work.doi
      ? `https://doi.org/${normalizeDoi(work.doi)}`
      : work.pmid
      ? `https://pubmed.ncbi.nlm.nih.gov/${work.pmid}/`
      : ""
  }));
}

/* =========================================================
   NVIDIA
========================================================= */

async function askNemotron(
  env,
  systemPrompt,
  userPrompt,
  maxTokens = 2500
) {
  if (!env.NVIDIA_API_KEY) {
    throw new Error("NVIDIA_API_KEY is missing.");
  }

  const response = await fetch(NVIDIA_URL, {
    method: "POST",
    headers: {
      Authorization:
        `Bearer ${env.NVIDIA_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      model: NVIDIA_MODEL,
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: userPrompt
        }
      ],
      temperature: 0.2,
      max_tokens: maxTokens,
      reasoning_effort: "none",
      stream: false
    })
  });

  const raw = await response.text();

  if (!response.ok) {
    throw new Error(
      `NVIDIA ${response.status}: ${raw}`
    );
  }

  const data = JSON.parse(raw);

  return (
    data?.choices?.[0]?.message?.content ||
    ""
  );
}

/* =========================================================
   APA-LIKE REFERENCES FROM REAL API METADATA
========================================================= */

function referenceLine(record, index) {
  const authors =
    record.authors?.length
      ? record.authors.join(", ")
      : "Author information unavailable";

  const year =
    record.year || "n.d.";

  const title =
    record.title ||
    "Title unavailable";

  const venue =
    record.venue
      ? ` ${record.venue}.`
      : "";

  const identifier = record.doi
    ? ` https://doi.org/${record.doi}`
    : record.pmid
    ? ` https://pubmed.ncbi.nlm.nih.gov/${record.pmid}/`
    : record.url
    ? ` ${record.url}`
    : "";

  return `${index + 1}. ${authors} (${year}). ${title}.${venue}${identifier}`;
}

/* =========================================================
   EVIDENCE PACK
========================================================= */

function buildEvidencePack(records) {
  return records
    .map((r, i) => {
      return `
STUDY ${i + 1}
DATABASE: ${r.source}
TITLE: ${r.title}
YEAR: ${r.year || "Unknown"}
AUTHORS: ${(r.authors || []).join(", ") || "Unknown"}
VENUE: ${r.venue || "Unknown"}
DOI: ${r.doi || "None"}
PMID: ${r.pmid || "None"}
CITED BY: ${
        r.citedBy === null ||
        r.citedBy === undefined
          ? "Unknown"
          : r.citedBy
      }
ABSTRACT:
${
  r.abstract
    ? truncate(r.abstract, 3000)
    : "[ABSTRACT NOT AVAILABLE FROM THIS API]"
}
`;
    })
    .join("\n-----------------------------\n");
}

/* =========================================================
   MCP
========================================================= */

function createServer(env) {
  const server = new McpServer({
    name: "TRT — Tamer RED TEAM",
    version: "6.0.0"
  });

  /* -------------------------------------------------------
     TRT RESEARCH
  ------------------------------------------------------- */

  server.registerTool(
    "trt_research",
    {
      description:
        "Conduct real academic research using live academic APIs, evaluate the requested number of unique studies where available, then perform adversarial TRT synthesis. Returns research trace, long report, and references derived from retrieved API metadata.",

      inputSchema: z.object({
        topic: z
          .string()
          .min(3)
          .describe(
            "Exact research topic/question."
          ),

        source_count: z
          .number()
          .int()
          .min(5)
          .max(200)
          .describe(
            "Target number of unique academic studies to evaluate. The user chooses this number."
          ),

        instructions: z
          .string()
          .optional()
          .describe(
            "Additional scope, inclusion/exclusion criteria, time period, population, output requirements, or special RED TEAM instructions."
          )
      })
    },

    async ({
      topic,
      source_count,
      instructions = ""
    }) => {
      try {
        /*
        We intentionally over-retrieve because databases overlap.
        */
        const perSource = Math.min(
          Math.max(
            Math.ceil(source_count * 0.8),
            10
          ),
          100
        );

        const sourceStatus = {
          openalex: "not run",
          ieee: "not run",
          crossref: "not run",
          europepmc: "not run"
        };

        const errors = [];

        const jobs = [
          searchOpenAlex(
            env,
            topic,
            perSource
          )
            .then((x) => {
              sourceStatus.openalex =
                `OK (${x.length})`;
              return x;
            })
            .catch((e) => {
              sourceStatus.openalex =
                `ERROR`;
              errors.push(
                `OpenAlex: ${e.message}`
              );
              return [];
            }),

          searchIEEE(
            env,
            topic,
            perSource
          )
            .then((x) => {
              sourceStatus.ieee =
                env.IEEE_API_KEY
                  ? `OK (${x.length})`
                  : "SKIPPED — no IEEE_API_KEY";
              return x;
            })
            .catch((e) => {
              sourceStatus.ieee =
                `ERROR`;
              errors.push(
                `IEEE: ${e.message}`
              );
              return [];
            }),

          searchCrossref(
            topic,
            perSource
          )
            .then((x) => {
              sourceStatus.crossref =
                `OK (${x.length})`;
              return x;
            })
            .catch((e) => {
              sourceStatus.crossref =
                `ERROR`;
              errors.push(
                `Crossref: ${e.message}`
              );
              return [];
            }),

          searchEuropePMC(
            topic,
            perSource
          )
            .then((x) => {
              sourceStatus.europepmc =
                `OK (${x.length})`;
              return x;
            })
            .catch((e) => {
              sourceStatus.europepmc =
                `ERROR`;
              errors.push(
                `Europe PMC: ${e.message}`
              );
              return [];
            })
        ];

        const groups =
          await Promise.all(jobs);

        const rawRecords =
          groups.flat();

        const unique =
          deduplicate(rawRecords);

        /*
        Prefer records with abstracts, then citation count.
        */
        unique.sort((a, b) => {
          const aa =
            a.abstract ? 1 : 0;
          const ba =
            b.abstract ? 1 : 0;

          if (aa !== ba) {
            return ba - aa;
          }

          return (
            (b.citedBy || 0) -
            (a.citedBy || 0)
          );
        });

        const selected =
          unique.slice(
            0,
            source_count
          );

        const abstractCount =
          selected.filter(
            (x) => x.abstract
          ).length;

        if (!selected.length) {
          throw new Error(
            "No academic records were retrieved. Research was not completed."
          );
        }

        /*
        Keep Nemotron payload bounded to avoid the 524 problem
        we observed with very large synchronous calls.
        */
        const synthesisSet =
          selected.slice(0,
