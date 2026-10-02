import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

const NVIDIA_BASE = "https://integrate.api.nvidia.com/v1";

async function getModels(env) {
  const r = await fetch(`${NVIDIA_BASE}/models`, {
    headers: {
      Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
      Accept: "application/json",
    },
  });

  if (!r.ok) {
    throw new Error(`NVIDIA models error: ${r.status} ${await r.text()}`);
  }

  const data = await r.json();
  return (data.data || []).map((m) => m.id).filter(Boolean);
}

async function callNvidia(env, model, system, user, maxTokens = 5000) {
  const r = await fetch(`${NVIDIA_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
      max_tokens: maxTokens,
    }),
  });

  if (!r.ok) {
    throw new Error(
      `NVIDIA completion error (${model}): ${r.status} ${await r.text()}`
    );
  }

  const data = await r.json();
  return data.choices?.[0]?.message?.content || "";
}

function chooseModels(models, count) {
  const preferred = [
    "nvidia/nemotron",
    "openai/gpt-oss",
    "qwen",
    "deepseek",
    "meta/llama",
    "mistral",
  ];

  const chosen = [];

  for (const hint of preferred) {
    const found = models.find(
      (m) =>
        m.toLowerCase().includes(hint.toLowerCase()) &&
        !chosen.includes(m)
    );
    if (found) chosen.push(found);
    if (chosen.length >= count) break;
  }

  for (const m of models) {
    if (!chosen.includes(m)) chosen.push(m);
    if (chosen.length >= count) break;
  }

  return chosen.slice(0, count);
}

const BASE_SYSTEM = `
You are a rigorous RED TEAM reviewer.

Your job is NOT to agree with the author.
Your job is to find weaknesses, unsupported claims, methodological problems,
logical gaps, numerical inconsistencies, alternative explanations,
overclaiming, missing controls, citation-risk, and reproducibility problems.

Never invent evidence or citations.
Clearly distinguish:
1. verified problem,
2. probable problem,
3. point requiring verification,
4. stylistic suggestion.

Be constructive and specific.
Quote or identify the exact passage/problem when possible.
`;

function createServer(env) {
  const server = new McpServer({
    name: "Tamer RED TEAM Council",
    version: "1.0.0",
  });

  server.registerTool(
    "red_team",
    {
      description:
        "Run a rigorous RED TEAM review using one NVIDIA model.",
      inputSchema: {
        text: z.string().describe("Text, chapter, analysis, or task to review"),
        instructions: z
          .string()
          .optional()
          .describe("Additional RED TEAM instructions"),
      },
    },
    async ({ text, instructions = "" }) => {
      const models = await getModels(env);
      const [model] = chooseModels(models, 1);

      if (!model) throw new Error("No NVIDIA model is available.");

      const result = await callNvidia(
        env,
        model,
        BASE_SYSTEM,
        `${instructions}\n\nMATERIAL TO REVIEW:\n${text}`
      );

      return {
        content: [
          {
            type: "text",
            text: `MODEL: ${model}\n\n${result}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "red_team_deep",
    {
      description:
        "Run three independent NVIDIA RED TEAM reviews and synthesize them.",
      inputSchema: {
        text: z.string().describe("Text, chapter, analysis, or task to review"),
        instructions: z.string().optional(),
      },
    },
    async ({ text, instructions = "" }) => {
      const models = chooseModels(await getModels(env), 3);

      if (!models.length) throw new Error("No NVIDIA models are available.");

      const roles = [
        "Act as a skeptical scientific peer reviewer. Focus on evidence and causal claims.",
        "Act as a methodology and statistics reviewer. Look for design, measurement, sampling, numerical and inference problems.",
        "Act as an adversarial logic reviewer. Try to falsify the argument and identify alternative explanations.",
      ];

      const reviews = await Promise.all(
        models.map((model, i) =>
          callNvidia(
            env,
            model,
            `${BASE_SYSTEM}\n${roles[i % roles.length]}`,
            `${instructions}\n\nMATERIAL TO REVIEW:\n${text}`
          ).then((answer) => ({ model, answer }))
        )
      );

      const joined = reviews
        .map(
          (r, i) =>
            `REVIEW ${i + 1}\nMODEL: ${r.model}\n\n${r.answer}`
        )
        .join("\n\n============================\n\n");

      const synthesisModel = models[0];

      const synthesis = await callNvidia(
        env,
        synthesisModel,
        `You are the senior RED TEAM chair.
Compare independent reviews.
Do not assume majority agreement means truth.
Remove duplicates.
Flag contradictions between reviewers.
Separate high-confidence findings from claims requiring verification.
Never invent sources.`,
        `ORIGINAL MATERIAL:\n${text}\n\nINDEPENDENT REVIEWS:\n${joined}`,
        6000
      );

      return {
        content: [
          {
            type: "text",
            text:
              `RED TEAM DEEP\nMODELS: ${models.join(", ")}\n\n` +
              `=== SYNTHESIS ===\n${synthesis}\n\n` +
              `=== INDEPENDENT REVIEWS ===\n${joined}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "red_team_max",
    {
      description:
        "Maximum RED TEAM: five specialist NVIDIA reviewers plus an independent synthesis.",
      inputSchema: {
        text: z.string().describe("Material or task for maximum RED TEAM review"),
        instructions: z.string().optional(),
      },
    },
    async ({ text, instructions = "" }) => {
      const models = chooseModels(await getModels(env), 5);

      if (!models.length) throw new Error("No NVIDIA models are available.");

      const roles = [
        `SCIENTIFIC REVIEWER:
Challenge scientific validity, evidence strength, causality, generalization and overclaiming.`,

        `METHODOLOGY REVIEWER:
Audit study design, classifications, sampling, controls, measurement validity,
statistics, denominators, missing data and reproducibility.`,

        `ADVERSARIAL FALSIFICATION REVIEWER:
Assume the central thesis may be wrong.
Find counter-explanations, confounders and evidence that would falsify it.`,

        `SOURCE AND CLAIM AUDITOR:
Identify statements requiring citations.
Detect citation-risk and claim-evidence mismatch.
Never invent or fabricate a reference.`,

        `EDITORIAL CONSISTENCY REVIEWER:
Find contradictions, ambiguous definitions, inconsistent terminology,
internal numerical conflicts and places where wording exceeds evidence.`,
      ];

      const reviews = await Promise.all(
        models.map((model, i) =>
          callNvidia(
            env,
            model,
            `${BASE_SYSTEM}\n\n${roles[i]}`,
            `${instructions}\n\nMATERIAL TO REVIEW:\n${text}`,
            6000
          ).then((answer) => ({
            model,
            role: roles[i].split(":")[0],
            answer,
          }))
        )
      );

      const joined = reviews
        .map(
          (r, i) =>
            `REVIEWER ${i + 1}: ${r.role}\nMODEL: ${r.model}\n\n${r.answer}`
        )
        .join("\n\n====================================\n\n");

      const synthesisModel = models[0];

      const synthesis = await callNvidia(
        env,
        synthesisModel,
        `You are the chair of a rigorous scientific RED TEAM council.

Five reviewers independently examined the material.

Produce a consolidated report with these sections:

A. CRITICAL FINDINGS
B. IMPORTANT FINDINGS
C. POINTS REQUIRING EXTERNAL VERIFICATION
D. DISAGREEMENTS BETWEEN REVIEWERS
E. POSSIBLE MODEL ERRORS OR OVERREACH
F. NUMERICAL / METHODOLOGICAL ISSUES
G. CLAIM-EVIDENCE ALIGNMENT
H. EXACT REVISIONS RECOMMENDED
I. REMAINING RISKS AFTER REVISION

Do not use voting as proof.
Do not fabricate references.
Do not turn uncertainty into fact.
Preserve minority objections when substantive.`,
        `ORIGINAL MATERIAL:\n${text}

COUNCIL REPORTS:

${joined}`,
        8000
      );

      return {
        content: [
          {
            type: "text",
            text:
              `TAMER RED TEAM COUNCIL — MAX\n\n` +
              `MODELS USED:\n${models.join("\n")}\n\n` +
              `========== COUNCIL SYNTHESIS ==========\n\n${synthesis}\n\n` +
              `========== FULL INDEPENDENT REPORTS ==========\n\n${joined}`,
          },
        ],
      };
    }
  );

  return server;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return new Response(
        "Tamer RED TEAM Council is running. MCP endpoint: /mcp",
        { status: 200 }
      );
    }

    if (url.pathname === "/mcp") {
      const server = createServer(env);
      return createMcpHandler(server)(request, env, ctx);
    }

    return new Response("Not found", { status: 404 });
  },
};
