import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

const NVIDIA_BASE = "https://integrate.api.nvidia.com/v1";

async function getModels(env) {
  if (!env || !env.NVIDIA_API_KEY) {
    throw new Error("NVIDIA_API_KEY secret is missing or unavailable.");
  }

  const response = await fetch(`${NVIDIA_BASE}/models`, {
    headers: {
      Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(
      `NVIDIA models error ${response.status}: ${await response.text()}`
    );
  }

  const data = await response.json();
  return data.data || [];
}

function chooseModel(models) {
  const ids = models.map((m) => m.id).filter(Boolean);

  const preferences = [
    "nemotron",
    "llama-3.3-70b",
    "llama-3.1-70b",
    "qwen"
  ];

  for (const preference of preferences) {
    const found = ids.find((id) =>
      id.toLowerCase().includes(preference.toLowerCase())
    );

    if (found) {
      return found;
    }
  }

  if (!ids.length) {
    throw new Error("NVIDIA API returned no available models.");
  }

  return ids[0];
}

async function askNvidia(env, prompt, mode) {
  if (!env || !env.NVIDIA_API_KEY) {
    throw new Error("NVIDIA_API_KEY secret is missing or unavailable.");
  }

  const models = await getModels(env);
  const model = chooseModel(models);

  const instructions = {
    standard: `
You are the Tamer RED TEAM Council.

Act as an independent adversarial reviewer.

Identify:
1. Main claim
2. Strongest aspects
3. Critical weaknesses
4. Unsupported assumptions
5. Methodological problems
6. Statistical or logical problems
7. Alternative explanations
8. Missing evidence
9. Concrete corrections
10. Final prioritized action list

Be rigorous, constructive, skeptical and evidence-conscious.

Do not invent facts, references, data, statistics or citations.
Clearly distinguish established facts from inference.
If evidence is unavailable, explicitly state that it is unavailable.
`,

    deep: `
You are the Tamer RED TEAM Council conducting a DEEP REVIEW.

Analyze the submitted material as if it were being reviewed by demanding
scientific, methodological and domain experts.

Examine:

- research question and contribution
- theoretical assumptions
- data quality
- methodology
- identification strategy
- statistical analysis
- robustness
- causality versus association
- internal validity
- external validity
- reproducibility
- alternative explanations
- contradictions
- missing controls
- unsupported claims
- reviewer objections
- publication risks
- exact revisions required

Do not fabricate evidence, references, statistics, data or citations.

State uncertainty explicitly.

For important criticisms explain:
A. The problem
B. Why it matters
C. What evidence would resolve it
D. The exact correction or test required

End with a prioritized revision plan.
`,

    max: `
You are the Tamer RED TEAM Council in MAXIMUM ADVERSARIAL REVIEW mode.

Your task is to attempt to falsify the submitted argument before accepting it.

Simulate multiple hostile but fair reviewers:

1. Methodological reviewer
2. Statistical reviewer
3. Domain expert
4. Skeptical journal editor
5. Replication reviewer
6. Logic and causal-inference reviewer

Search systematically for:

- fatal flaws
- hidden assumptions
- selection bias
- measurement error
- endogeneity
- confounding
- specification problems
- data leakage
- overfitting
- multiple-testing problems
- weak robustness
- causal overclaiming
- denominator inconsistencies
- sample inconsistencies
- contradictions between tables, figures and prose
- unsupported novelty claims
- missing counter-evidence
- alternative mechanisms
- reproducibility failures

For every major criticism provide:

A. Problem
B. Why it matters
C. Severity: Critical / Major / Moderate / Minor
D. Exact correction, robustness test, evidence or analysis required

Do not invent facts, references, statistics, data or citations.

If the available material is insufficient to establish something,
explicitly state that it cannot be established.

Finish with:

1. Critical blockers
2. Required robustness tests
3. Required textual corrections
4. Questions a hostile reviewer would ask
5. Prioritized repair plan
`
  };

  const response = await fetch(`${NVIDIA_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: instructions[mode]
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: mode === "max" ? 0.1 : 0.2,
      max_tokens:
        mode === "max"
          ? 6000
          : mode === "deep"
          ? 4000
          : 2500,
      stream: false
    })
  });

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `NVIDIA inference error ${response.status}: ${errorText}`
    );
  }

  const data = await response.json();

  const text = data?.choices?.[0]?.message?.content;

  if (!text) {
    throw new Error(
      `NVIDIA returned no response text. Model used: ${model}`
    );
  }

  return {
    text,
    model
  };
}

function createServer(env) {
  const server = new McpServer({
    name: "Tamer RED TEAM Council",
    version: "2.0.0"
  });

  const reviewSchema = z.object({
    text: z
      .string()
      .min(1)
      .describe(
        "The paper, argument, analysis, methodology, results, draft, proposal, claim, or other material to review."
      )
  });

  server.registerTool(
    "red_team",
    {
      description:
        "Run a rigorous NVIDIA-powered RED TEAM review. Identify weaknesses, unsupported assumptions, methodological problems, alternative explanations and concrete corrections.",
      inputSchema: reviewSchema
    },
    async ({ text }) => {
      try {
        const result = await askNvidia(env, text, "standard");

        return {
          content: [
            {
              type: "text",
              text:
                `NVIDIA model used: ${result.model}\n\n` +
                result.text
            }
          ]
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `RED TEAM error: ${
                error instanceof Error
                  ? error.message
                  : String(error)
              }`
            }
          ]
        };
      }
    }
  );

  server.registerTool(
    "red_team_deep",
    {
      description:
        "Run a comprehensive NVIDIA-powered scientific and methodological RED TEAM review including robustness, validity, causality, reproducibility and publication-risk analysis.",
      inputSchema: reviewSchema
    },
    async ({ text }) => {
      try {
        const result = await askNvidia(env, text, "deep");

        return {
          content: [
            {
              type: "text",
              text:
                `NVIDIA model used: ${result.model}\n\n` +
                result.text
            }
          ]
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `RED TEAM DEEP error: ${
                error instanceof Error
                  ? error.message
                  : String(error)
              }`
            }
          ]
        };
      }
    }
  );

  server.registerTool(
    "red_team_max",
    {
      description:
        "Run the maximum adversarial NVIDIA-powered RED TEAM review, simulating hostile but fair methodological, statistical, domain, editorial, replication and causal-inference reviewers.",
      inputSchema: reviewSchema
    },
    async ({ text }) => {
      try {
        const result = await askNvidia(env, text, "max");

        return {
          content: [
            {
              type: "text",
              text:
                `NVIDIA model used: ${result.model}\n\n` +
                result.text
            }
          ]
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `RED TEAM MAX error: ${
                error instanceof Error
                  ? error.message
                  : String(error)
              }`
            }
          ]
        };
      }
    }
  );

  return server;
}

export default {
  fetch(request, env, ctx) {
    const handler = createMcpHandler(() => createServer(env));
    return handler(request, env, ctx);
  }
};
