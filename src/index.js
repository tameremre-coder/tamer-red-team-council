import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

const NVIDIA_BASE = "https://integrate.api.nvidia.com/v1";

async function getModels(env) {
  const response = await fetch(`${NVIDIA_BASE}/models`, {
    headers: {
      Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `NVIDIA models error: ${response.status} ${await response.text()}`
    );
  }

  const data = await response.json();

  return (data.data || [])
    .map((model) => model.id)
    .filter(Boolean);
}

async function callNvidia(
  env,
  model,
  systemPrompt,
  userPrompt,
  maxTokens = 5000
) {
  const response = await fetch(`${NVIDIA_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
      temperature: 0.2,
      max_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `NVIDIA completion error (${model}): ` +
        `${response.status} ${await response.text()}`
    );
  }

  const data = await response.json();

  return data.choices?.[0]?.message?.content || "";
}

function chooseModels(models, count) {
  const preferredHints = [
    "nvidia/nemotron",
    "openai/gpt-oss",
    "qwen",
    "deepseek",
    "meta/llama",
    "mistral",
  ];

  const selected = [];

  for (const hint of preferredHints) {
    const found = models.find(
      (model) =>
        model.toLowerCase().includes(hint.toLowerCase()) &&
        !selected.includes(model)
    );

    if (found) {
      selected.push(found);
    }

    if (selected.length >= count) {
      break;
    }
  }

  for (const model of models) {
    if (!selected.includes(model)) {
      selected.push(model);
    }

    if (selected.length >= count) {
      break;
    }
  }

  return selected.slice(0, count);
}

const BASE_SYSTEM = `
You are a rigorous RED TEAM reviewer.

Your job is NOT to agree with the author.

Your job is to identify:
- unsupported claims
- methodological weaknesses
- logical gaps
- numerical inconsistencies
- alternative explanations
- overclaiming
- missing controls
- citation risks
- reproducibility problems

Never invent evidence.
Never invent citations.

Clearly distinguish between:

1. VERIFIED PROBLEM
2. PROBABLE PROBLEM
3. REQUIRES VERIFICATION
4. EDITORIAL OR STYLE SUGGESTION

Be constructive, skeptical and specific.

Whenever possible identify the exact passage or claim that causes
the problem.
`;

function createServer(env) {
  const server = new McpServer({
    name: "Tamer RED TEAM Council",
    version: "1.0.0",
  });

  /*
   * =========================================================
   * RED TEAM
   * =========================================================
   */

  server.registerTool(
    "red_team",
    {
      description:
        "Run a rigorous RED TEAM review using one NVIDIA model.",

      inputSchema: {
        text: z
          .string()
          .describe("Text, chapter, analysis or material to review"),

        instructions: z
          .string()
          .optional()
          .describe("Additional RED TEAM instructions"),
      },
    },

    async ({ text, instructions = "" }) => {
      const availableModels = await getModels(env);

      const models = chooseModels(availableModels, 1);

      if (!models.length) {
        throw new Error("No NVIDIA model is available.");
      }

      const model = models[0];

      const result = await callNvidia(
        env,
        model,
        BASE_SYSTEM,
        `
ADDITIONAL INSTRUCTIONS:

${instructions}

MATERIAL TO REVIEW:

${text}
`
      );

      return {
        content: [
          {
            type: "text",
            text: `
TAMER RED TEAM

MODEL:
${model}

==============================

${result}
`,
          },
        ],
      };
    }
  );

  /*
   * =========================================================
   * RED TEAM DEEP
   * =========================================================
   */

  server.registerTool(
    "red_team_deep",
    {
      description:
        "Run three independent NVIDIA RED TEAM reviews and synthesize them.",

      inputSchema: {
        text: z
          .string()
          .describe("Text, chapter, analysis or material to review"),

        instructions: z
          .string()
          .optional()
          .describe("Additional RED TEAM instructions"),
      },
    },

    async ({ text, instructions = "" }) => {
      const availableModels = await getModels(env);

      const models = chooseModels(availableModels, 3);

      if (!models.length) {
        throw new Error("No NVIDIA models are available.");
      }

      const roles = [
        `
You are a skeptical scientific peer reviewer.

Focus especially on:
- scientific validity
- strength of evidence
- causal claims
- generalization
- unsupported conclusions
`,

        `
You are a methodology and statistics reviewer.

Focus especially on:
- study design
- sampling
- classification
- measurement validity
- denominators
- numerical consistency
- statistics
- reproducibility
`,

        `
You are an adversarial falsification reviewer.

Assume the central argument may be wrong.

Search for:
- alternative explanations
- confounders
- logical gaps
- contradictory evidence
- conditions that would falsify the thesis
`,
      ];

      const reviews = await Promise.all(
        models.map(async (model, index) => {
          const answer = await callNvidia(
            env,
            model,
            `${BASE_SYSTEM}

${roles[index % roles.length]}`,
            `
ADDITIONAL INSTRUCTIONS:

${instructions}

MATERIAL TO REVIEW:

${text}
`
          );

          return {
            model,
            answer,
          };
        })
      );

      const joinedReviews = reviews
        .map(
          (review, index) => `
REVIEW ${index + 1}

MODEL:
${review.model}

${review.answer}
`
        )
        .join(`

========================================

`);

      const synthesisModel = models[0];

      const synthesis = await callNvidia(
        env,
        synthesisModel,
        `
You are the senior chair of a scientific RED TEAM.

You are given several independent reviews.

Your responsibilities:

- compare the reviews
- remove duplicates
- preserve substantive minority objections
- identify contradictions between reviewers
- distinguish high-confidence findings from uncertain findings
- identify possible reviewer/model errors
- never treat majority agreement as proof
- never invent citations
`,
        `
ORIGINAL MATERIAL:

${text}

INDEPENDENT REVIEWS:

${joinedReviews}
`,
        6000
      );

      return {
        content: [
          {
            type: "text",

            text: `
TAMER RED TEAM — DEEP

MODELS USED:

${models.join("\n")}

========================================
SYNTHESIS
========================================

${synthesis}

========================================
INDEPENDENT REVIEWS
========================================

${joinedReviews}
`,
          },
        ],
      };
    }
  );

  /*
   * =========================================================
   * RED TEAM MAX
   * =========================================================
   */

  server.registerTool(
    "red_team_max",
    {
      description:
        "Maximum RED TEAM using five specialist NVIDIA reviewers and a council synthesis.",

      inputSchema: {
        text: z
          .string()
          .describe("Material or task for maximum RED TEAM review"),

        instructions: z
          .string()
          .optional()
          .describe("Additional RED TEAM instructions"),
      },
    },

    async ({ text, instructions = "" }) => {
      const availableModels = await getModels(env);

      const models = chooseModels(availableModels, 5);

      if (!models.length) {
        throw new Error("No NVIDIA models are available.");
      }

      const roles = [
        `
SCIENTIFIC REVIEWER

Challenge:
- scientific validity
- evidence strength
- causal inference
- generalization
- overclaiming
`,

        `
METHODOLOGY AND STATISTICS REVIEWER

Audit:
- study design
- classifications
- sampling
- controls
- measurement validity
- statistics
- denominators
- missing data
- numerical consistency
- reproducibility
`,

        `
ADVERSARIAL FALSIFICATION REVIEWER

Assume the central thesis may be wrong.

Search aggressively for:
- counter-explanations
- confounders
- logical weaknesses
- contradictory interpretations
- evidence that would falsify the thesis
`,

        `
SOURCE AND CLAIM AUDITOR

Identify:
- claims requiring citations
- claim-evidence mismatches
- unsupported factual statements
- citation risks
- statements requiring external verification

Never fabricate a source.
`,

        `
EDITORIAL CONSISTENCY REVIEWER

Find:
- contradictions
- ambiguous definitions
- inconsistent terminology
- internal numerical conflicts
- wording stronger than the evidence
- inconsistencies between sections
`,
      ];

      const reviews = await Promise.all(
        models.map(async (model, index) => {
          const answer = await callNvidia(
            env,
            model,
            `${BASE_SYSTEM}

${roles[index]}`,
            `
ADDITIONAL INSTRUCTIONS:

${instructions}

MATERIAL TO REVIEW:

${text}
`,
            6000
          );

          return {
            model,
            role: roles[index].trim().split("\n")[0],
            answer,
          };
        })
      );

      const joinedReviews = reviews
        .map(
          (review, index) => `
REVIEWER ${index + 1}

ROLE:
${review.role}

MODEL:
${review.model}

${review.answer}
`
        )
        .join(`

==================================================

`);

      const synthesisModel = models[0];

      const synthesis = await callNvidia(
        env,
        synthesisModel,
        `
You are the chair of a rigorous scientific RED TEAM council.

Five independent reviewers examined the material.

Produce a consolidated report with these sections:

A. CRITICAL FINDINGS

B. IMPORTANT FINDINGS

C. POINTS REQUIRING EXTERNAL VERIFICATION

D. DISAGREEMENTS BETWEEN REVIEWERS

E. POSSIBLE MODEL ERRORS OR OVERREACH

F. NUMERICAL AND METHODOLOGICAL ISSUES

G. CLAIM-EVIDENCE ALIGNMENT

H. EXACT REVISIONS RECOMMENDED

I. REMAINING RISKS AFTER REVISION

Rules:

- Do not use voting as proof.
- Do not fabricate references.
- Do not turn uncertainty into fact.
- Preserve substantive minority objections.
- Explicitly flag findings that require external verification.
`,
        `
ORIGINAL MATERIAL:

${text}

COUNCIL REPORTS:

${joinedReviews}
`,
        8000
      );

      return {
        content: [
          {
            type: "text",

            text: `
TAMER RED TEAM COUNCIL — MAX

MODELS USED:

${models.join("\n")}

==================================================
COUNCIL SYNTHESIS
==================================================

${synthesis}

==================================================
FULL INDEPENDENT REPORTS
==================================================

${joinedReviews}
`,
          },
        ],
      };
    }
  );

  return server;
}

/*
 * =========================================================
 * CLOUDFLARE WORKER
 * =========================================================
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return new Response(
        "Tamer RED TEAM Council is running. MCP endpoint: /mcp",
        {
          status: 200,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
          },
        }
      );
    }

    if (url.pathname === "/mcp") {
      const handler = createMcpHandler(
        () => createServer(env),
        {
          route: "/mcp",
        }
      );

      return handler(request, env, ctx);
    }

    return new Response("Not found", {
      status: 404,
    });
  },
};
