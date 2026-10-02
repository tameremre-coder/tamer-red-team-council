import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

/* =========================================================
   TRT RESEARCH v6
   Academic Research + Adversarial RED TEAM
   ========================================================= */

const NVIDIA_URL =
  "https://integrate.api.nvidia.com/v1/chat/completions";

const NVIDIA_MODEL =
  "nvidia/nemotron-3-ultra-550b-a55b";

/* =========================================================
   BASIC HELPERS
   ========================================================= */

function cleanText(value = "") {
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDoi(value = "") {
  return String(value)
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .toLowerCase();
}

function normalizeTitle(value = "") {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function safeYear(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 1000 && n < 3000
    ? n
    : null;
}

function makeRecord({
  source,
  id = "",
  title = "",
  abstract = "",
  authors = [],
  year = null,
  venue = "",
  doi = "",
  pmid = "",
  url = "",
  citationCount = null
}) {
  return {
    source,
    id: String(id || ""),
    title: cleanText(title),
    abstract: cleanText(abstract),
    authors: Array.isArray(authors)
      ? authors.map(cleanText).filter(Boolean)
      : [],
    year: safeYear(year),
    venue: cleanText(venue),
    doi: normalizeDoi(doi),
    pmid: String(pmid || "").trim(),
    url: String(url || "").trim(),
    citationCount:
      Number.isFinite(Number(citationCount))
        ? Number(citationCount)
        : null
  };
}

function recordKey(record) {
  if (record.doi) {
    return `doi:${record.doi}`;
  }

  if (record.pmid) {
    return `pmid:${record.pmid}`;
  }

  const title = normalizeTitle(record.title);

  if (title) {
    return `title:${title}`;
  }

  return `${record.source}:${record.id}`;
}

function mergeRecords(oldRecord, newRecord) {
  const mergedSources = new Set([
    ...(oldRecord.sources || [oldRecord.source]),
    ...(newRecord.sources || [newRecord.source])
  ]);

  return {
    ...oldRecord,

    title:
      oldRecord.title.length >= newRecord.title.length
        ? oldRecord.title
        : newRecord.title,

    abstract:
      oldRecord.abstract.length >= newRecord.abstract.length
        ? oldRecord.abstract
        : newRecord.abstract,

    authors:
      oldRecord.authors.length >= newRecord.authors.length
        ? oldRecord.authors
        : newRecord.authors,

    year: oldRecord.year || newRecord.year,

    venue:
      oldRecord.venue || newRecord.venue,

    doi:
      oldRecord.doi || newRecord.doi,

    pmid:
      oldRecord.pmid || newRecord.pmid,

    url:
      oldRecord.url || newRecord.url,

    citationCount:
      Math.max(
        oldRecord.citationCount || 0,
        newRecord.citationCount || 0
      ) || null,

    sources: Array.from(mergedSources)
  };
}

function deduplicate(records) {
  const map = new Map();

  for (const record of records) {
    if (!record || !record.title) continue;

    const key = recordKey(record);

    if (!map.has(key)) {
      map.set(key, {
        ...record,
        sources: [record.source]
      });
    } else {
      map.set(
        key,
        mergeRecords(map.get(key), record)
      );
    }
  }

  return Array.from(map.values());
}

/* =========================================================
   OPENALEX ABSTRACT DECODER
   ========================================================= */

function decodeOpenAlexAbstract(invertedIndex) {
  if (
    !invertedIndex ||
    typeof invertedIndex !== "object"
  ) {
    return "";
  }

  const words = [];

  for (const [word, positions] of Object.entries(
    invertedIndex
  )) {
    if (!Array.isArray(positions)) continue;

    for (const position of positions) {
      words.push([position, word]);
    }
  }

  words.sort((a, b) => a[0] - b[0]);

  return words.map((x) => x[1]).join(" ");
}

/* =========================================================
   OPENALEX
   ========================================================= */

async function searchOpenAlex(env, query, limit) {
  const params = new URLSearchParams({
    search: query,
    per_page: String(Math.min(limit, 100))
  });

  if (env.OPENALEX_API_KEY) {
    params.set(
      "api_key",
      env.OPENALEX_API_KEY
    );
  }

  const response = await fetch(
    `https://api.openalex.org/works?${params.toString()}`
  );

  if (!response.ok) {
    throw new Error(
      `OpenAlex ${response.status}: ${await response.text()}`
    );
  }

  const data = await response.json();

  return (data.results || []).map((item) =>
    makeRecord({
      source: "OpenAlex",
      id: item.id,
      title: item.title || item.display_name,
      abstract: decodeOpenAlexAbstract(
        item.abstract_inverted_index
      ),
      authors: (item.authorships || [])
        .map(
          (a) =>
            a?.author?.display_name || ""
        )
        .filter(Boolean),
      year: item.publication_year,
      venue:
        item?.primary_location?.source
          ?.display_name || "",
      doi: item.doi || "",
      url:
        item?.primary_location?.landing_page_url ||
        item?.id ||
        "",
      citationCount:
        item.cited_by_count
    })
  );
}

/* =========================================================
   IEEE XPLORE
   ========================================================= */

async function searchIEEE(env, query, limit) {
  if (!env.IEEE_API_KEY) {
    return {
      skipped: true,
      reason: "IEEE_API_KEY missing",
      records: []
    };
  }

  const params = new URLSearchParams({
    apikey: env.IEEE_API_KEY,
    format: "json",
    max_records: String(
      Math.min(limit, 200)
    ),
    start_record: "1",
    sort_order: "desc",
    sort_field: "article_title",
    querytext: query
  });

  const response = await fetch(
    `https://ieeexploreapi.ieee.org/api/v1/search/articles?${params.toString()}`
  );

  if (!response.ok) {
    throw new Error(
      `IEEE ${response.status}: ${await response.text()}`
    );
  }

  const data = await response.json();

  const records = (data.articles || []).map(
    (item) => {
      const authors =
        item?.authors?.authors?.map(
          (a) =>
            a.full_name ||
            a.author_name ||
            ""
        ) || [];

      return makeRecord({
        source: "IEEE Xplore",
        id:
          item.article_number ||
          item.index_terms ||
          "",
        title: item.title,
        abstract: item.abstract,
        authors,
        year:
          item.publication_year ||
          item.publication_date,
        venue:
          item.publication_title,
        doi: item.doi,
        url:
          item.html_url ||
          item.pdf_url ||
          "",
        citationCount:
          item.citing_paper_count
      });
    }
  );

  return {
    skipped: false,
    records
  };
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
      Math.min(limit, 1000)
    )
  });

  const response = await fetch(
    `https://www.ebi.ac.uk/europepmc/webservices/rest/search?${params.toString()}`
  );

  if (!response.ok) {
    throw new Error(
      `Europe PMC ${response.status}: ${await response.text()}`
    );
  }

  const data = await response.json();

  return (
    data?.resultList?.result || []
  ).map((item) =>
    makeRecord({
      source: "Europe PMC",
      id: item.id,
      title: item.title,
      abstract: item.abstractText,
      authors:
        item.authorList?.author?.map(
          (a) =>
            a.fullName ||
            [
              a.firstName,
              a.lastName
            ]
              .filter(Boolean)
              .join(" ")
        ) || [],
      year:
        item.pubYear ||
        item.firstPublicationDate,
      venue:
        item.journalTitle ||
        item.journalInfo?.journal
          ?.title ||
        "",
      doi: item.doi,
      pmid:
        item.pmid ||
        (item.source === "MED"
          ? item.id
          : ""),
      url:
        item.doi
          ? `https://doi.org/${normalizeDoi(
              item.doi
            )}`
          : "",
      citationCount:
        item.citedByCount
    })
  );
}

/* =========================================================
   PUBMED / NCBI
   ========================================================= */

async function searchPubMed(env, query, limit) {
  const searchParams =
    new URLSearchParams({
      db: "pubmed",
      term: query,
      retmode: "json",
      retmax: String(
        Math.min(limit, 200)
      )
    });

  if (env.NCBI_API_KEY) {
    searchParams.set(
      "api_key",
      env.NCBI_API_KEY
    );
  }

  const searchResponse = await fetch(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${searchParams.toString()}`
  );

  if (!searchResponse.ok) {
    throw new Error(
      `PubMed ESearch ${searchResponse.status}: ${await searchResponse.text()}`
    );
  }

  const searchData =
    await searchResponse.json();

  const ids =
    searchData?.esearchresult?.idlist ||
    [];

  if (!ids.length) {
    return [];
  }

  const fetchParams =
    new URLSearchParams({
      db: "pubmed",
      id: ids.join(","),
      retmode: "xml"
    });

  if (env.NCBI_API_KEY) {
    fetchParams.set(
      "api_key",
      env.NCBI_API_KEY
    );
  }

  const fetchResponse = await fetch(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?${fetchParams.toString()}`
  );

  if (!fetchResponse.ok) {
    throw new Error(
      `PubMed EFetch ${fetchResponse.status}: ${await fetchResponse.text()}`
    );
  }

  const xml = await fetchResponse.text();

  /*
    Cloudflare Workers has DOMParser in many runtimes,
    but to avoid relying on browser DOM APIs here,
    use conservative XML extraction for the fields
    required by TRT.
  */

  const articles =
    xml.match(
      /<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g
    ) || [];

  return articles.map((block) => {
    const extract = (tag) => {
      const match = block.match(
        new RegExp(
          `<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,
          "i"
        )
      );

      return match
        ? cleanText(match[1])
        : "";
    };

    const title =
      extract("ArticleTitle");

    const abstractParts = [];

    const abstractRegex =
      /<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/gi;

    let abstractMatch;

    while (
      (abstractMatch =
        abstractRegex.exec(block))
    ) {
      abstractParts.push(
        cleanText(abstractMatch[1])
      );
    }

    const authorBlocks =
      block.match(
        /<Author[^>]*>[\s\S]*?<\/Author>/gi
      ) || [];

    const authors = authorBlocks
      .map((authorBlock) => {
        const last =
          authorBlock.match(
            /<LastName>([\s\S]*?)<\/LastName>/i
          )?.[1] || "";

        const fore =
          authorBlock.match(
            /<ForeName>([\s\S]*?)<\/ForeName>/i
          )?.[1] || "";

        return cleanText(
          `${fore} ${last}`
        );
      })
      .filter(Boolean);

    const pmid =
      block.match(
        /<PMID[^>]*>([\s\S]*?)<\/PMID>/i
      )?.[1] || "";

    const doi =
      block.match(
        /<ArticleId[^>]*IdType=["']doi["'][^>]*>([\s\S]*?)<\/ArticleId>/i
      )?.[1] || "";

    const year =
      block.match(
        /<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>[\s\S]*?<\/PubDate>/i
      )?.[1] ||
      block.match(
        /<ArticleDate[^>]*>[\s\S]*?<Year>(\d{4})<\/Year>/i
      )?.[1] ||
      null;

    const journal =
      block.match(
        /<Journal>[\s\S]*?<Title>([\s\S]*?)<\/Title>[\s\S]*?<\/Journal>/i
      )?.[1] || "";

    return makeRecord({
      source: "PubMed",
      id: pmid,
      title,
      abstract:
        abstractParts.join(" "),
      authors,
      year,
      venue: journal,
      doi,
      pmid,
      url: pmid
        ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`
        : ""
    });
  });
}

/* =========================================================
   CROSSREF
   ========================================================= */

async function searchCrossref(
  query,
  limit
) {
  const params = new URLSearchParams({
    query,
    rows: String(
      Math.min(limit, 200)
    )
  });

  const response = await fetch(
    `https://api.crossref.org/works?${params.toString()}`
  );

  if (!response.ok) {
    throw new Error(
      `Crossref ${response.status}: ${await response.text()}`
    );
  }

  const data = await response.json();

  return (
    data?.message?.items || []
  ).map((item) => {
    const authors =
      (item.author || []).map((a) =>
        cleanText(
          [a.given, a.family]
            .filter(Boolean)
            .join(" ")
        )
      );

    const dateParts =
      item?.published?.["date-parts"]?.[0] ||
      item?.["published-print"]?.[
        "date-parts"
      ]?.[0] ||
      item?.["published-online"]?.[
        "date-parts"
      ]?.[0] ||
      [];

    return makeRecord({
      source: "Crossref",
      id: item.DOI,
      title: first(item.title) || "",
      abstract: item.abstract || "",
      authors,
      year: dateParts[0],
      venue:
        first(
          item["container-title"]
        ) || "",
      doi: item.DOI,
      url:
        item.URL ||
        (item.DOI
          ? `https://doi.org/${normalizeDoi(
              item.DOI
            )}`
          : ""),
      citationCount:
        item[
          "is-referenced-by-count"
        ]
    });
  });
}

/* =========================================================
   NVIDIA NEMOTRON
   ========================================================= */

async function callNemotron(
  env,
  systemPrompt,
  userPrompt,
  maxTokens = 1800
) {
  if (!env.NVIDIA_API_KEY) {
    throw new Error(
      "NVIDIA_API_KEY missing."
    );
  }

  const response = await fetch(
    NVIDIA_URL,
    {
      method: "POST",

      headers: {
        Authorization:
          `Bearer ${env.NVIDIA_API_KEY}`,
        "Content-Type":
          "application/json",
