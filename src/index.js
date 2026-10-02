import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

const NVIDIA_URL =
  "https://integrate.api.nvidia.com/v1/chat/completions";

const NVIDIA_MODEL = "openai/gpt-oss-120b";

async function askNvidia(env, prompt, mode) {
  if (!env || !env.NVIDIA_API_KEY) {
    throw new Error(
      "NVIDIA_API_KEY secret is missing or unavailable."
    );
  }

  const instructions = {
    standard: `
You are the Tamer RED TEAM Council.

Act as an independent adversarial reviewer.

Analyze the material rigorously and constructively.

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
10. Prioritized action list

Do not invent facts, references, data, statistics or citations.

Clearly distinguish:
- established facts
- evidence supplied by the user
- inference
- uncertainty

If evidence is unavailable, explicitly say so.
`,

    deep: `
You are the Tamer RED TEAM Council conducting a DEEP REVIEW.

Analyze the submitted material as if it were being reviewed by demanding
scientific, methodological and domain experts.

Examine:

- research question
- contribution and novelty
- theoretical assumptions
- data quality
- sampling
- measurement
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

For each important criticism provide:

A. Problem
B. Why it matters
C. Evidence needed
D. Exact correction or robustness test

Do not fabricate evidence, references, statistics, data or citations.

State uncertainty explicitly.

End with a prioritized revision plan.
`,

    max: `
You are the Tamer RED TEAM Council in MAXIMUM ADVERSARIAL REVIEW mode.

Your task is to attempt to falsify the submitted argument before accepting it.

Simulate six independent hostile but fair reviewers:

1. Methodological reviewer
2. Statistical reviewer
3. Domain expert
4. Skeptical journal editor
5. Replication reviewer
6. Logic and causal-inference reviewer

Systematically search for:

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

If the available evidence is insufficient, explicitly state that the
claim cannot currently be established.

Finish with:

1. Critical blockers
2. Required robustness tests
3. Required textual corrections
4. Questions a hostile reviewer would ask
5. Prioritized repair plan
`
  };

  const maxTokens =
    mode === "max"
      ? 4096
      : mode === "deep"
      ? 3500
      : 2500;

  const reasoningEffort =
    mode === "max"
      ? "high"
      : mode === "deep"
      ? "high"
      : "medium";

  const response = await fetch(NVIDIA_URL, {
    method: "POST",

    headers: {
      Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },

    body: JSON.stringify({
      model: NVIDIA_MODEL,

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

      temperature: 0.2,
      max_tokens: maxTokens,
      reasoning_effort: reasoningEffort,
      stream: false
    })
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `NVIDIA inference error ${response.status}: ${responseText}`
    );
  }

  let data;

  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(
      `NVIDIA returned invalid JSON: ${responseText}`
    );
  }

  const text =
    data?.choices?.[0]?.message?.content;

  if (!text) {
    throw new Error(
      `NVIDIA returned no response text. Raw response: ${responseText}`
    );
  }

  return {
    text,
    model: NVIDIA_MODEL
  };
}

function createServer(env) {
  const server = new McpServer({
    name: "Tamer RED TEAM Council",
    version: "3.0.0"
  });

  const reviewSchema = z.object({
    text: z
      .string()
      .min(1)
      .describe(
        "The paper, argument, claim, analysis, methodology, results, draft, proposal or other material to review."
      )
  });

  server.registerTool(
    "red_team",
    {
      description:
        "Run a rigorous NVIDIA-powered RED TEAM review identifying weaknesses, unsupported assumptions, methodological problems, alternative explanations and concrete corrections.",

      inputSchema: reviewSchema
    },

    async ({ text }) => {
      try {
        const result =
          await askNvidia(env, text, "standard");

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
              text:
                `RED TEAM error: ${
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
        "Run a comprehensive NVIDIA-powered scientific and methodological RED TEAM review covering robustness, validity, causality, reproducibility and publication risk.",

      inputSchema: reviewSchema
    },

    async ({ text }) => {
      try {
        const result =
          await askNvidia(env, text, "deep");

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
              text:
                `RED TEAM DEEP error: ${
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
        "Run the maximum adversarial NVIDIA-powered RED TEAM review, simulating methodological, statistical, domain, editorial, replication and causal-inference reviewers.",

      inputSchema: reviewSchema
    },

    async ({ text }) => {
      try {
        const result =
          await askNvidia(env, text, "max");

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
              text:
                `RED TEAM MAX error: ${
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
    const handler =
      createMcpHandler(() => createServer(env));

    return handler(request, env, ctx);
  }
};
