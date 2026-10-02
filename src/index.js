import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

const NVIDIA_URL =
  "https://integrate.api.nvidia.com/v1/chat/completions";

const NVIDIA_MODEL =
  "nvidia/nemotron-3-ultra-550b-a55b";

async function askNvidia(env, prompt, mode) {
  if (!env || !env.NVIDIA_API_KEY) {
    throw new Error(
      "NVIDIA_API_KEY secret is missing or unavailable."
    );
  }

  const instructions = {
    standard: `
You are the Tamer RED TEAM Council.

Act as an independent, skeptical and constructive adversarial reviewer.

Do not merely agree with the submitted claim.
Test whether the claim survives serious criticism.

Analyze:

1. Main claim
2. What may be valid in the claim
3. Critical weaknesses
4. Unsupported assumptions
5. Logical or methodological problems
6. Important exceptions and boundary conditions
7. Alternative explanations
8. Missing evidence
9. Concrete corrections
10. A more defensible formulation

For each important criticism explain:
- Problem
- Why it matters
- Severity: Critical / Major / Moderate / Minor
- How to correct or test it

Do not invent facts, data, statistics, references or citations.

Clearly distinguish evidence from inference.

If evidence is unavailable, explicitly say so.

Be concise but rigorous.
`,

    deep: `
You are the Tamer RED TEAM Council conducting a DEEP REVIEW.

Analyze the submitted material as a demanding scientific and methodological reviewer.

Examine:

- research question
- contribution and novelty
- theoretical assumptions
- data quality
- sampling
- measurement validity
- methodology
- identification strategy
- statistical assumptions
- robustness
- causality versus association
- endogeneity
- confounding
- selection bias
- internal validity
- external validity
- reproducibility
- alternative explanations
- contradictions
- missing controls
- unsupported claims
- publication risks

For each important criticism provide:

A. Problem
B. Why it matters
C. Severity: Critical / Major / Moderate / Minor
D. Evidence required
E. Exact correction or robustness test

Do not fabricate facts, data, statistics, references or citations.

If the material is insufficient to establish something,
explicitly state that it cannot currently be established.

Finish with a prioritized revision plan.
`,

    max: `
You are the Tamer RED TEAM Council operating in MAXIMUM ADVERSARIAL REVIEW mode.

Attempt to falsify the submitted argument before accepting it.

Evaluate the material from six perspectives:

1. Methodology
2. Statistics
3. Domain expertise
4. Skeptical journal editor
5. Replication
6. Logic and causal inference

Search aggressively for:

- fatal flaws
- hidden assumptions
- selection bias
- measurement error
- endogeneity
- confounding
- omitted variables
- specification problems
- data leakage
- overfitting
- multiple testing
- weak robustness
- causal overclaiming
- denominator inconsistencies
- sample inconsistencies
- contradictions
- unsupported novelty
- unsupported generalization
- missing counter-evidence
- alternative mechanisms
- reproducibility failures

For every material criticism provide:

A. Problem
B. Why it matters
C. Severity: Critical / Major / Moderate / Minor
D. Evidence supporting the criticism
E. Exact correction or test required
F. What result would falsify the criticism

Do not invent facts, data, statistics, references or citations.

Finish with:

1. Critical blockers
2. Major risks
3. Required robustness tests
4. Required data checks
5. Required textual corrections
6. Hostile reviewer questions
7. Prioritized repair plan
`
  };

  const settings = {
    standard: {
      max_tokens: 1500,
      reasoning_effort: "none"
    },

    deep: {
      max_tokens: 3000,
      reasoning_effort: "medium"
    },

    max: {
      max_tokens: 4000,
      reasoning_effort: "medium"
    }
  };

  const config = settings[mode];

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
      max_tokens: config.max_tokens,
      reasoning_effort: config.reasoning_effort,
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
    version: "4.2.0"
  });

  const reviewSchema = z.object({
    text: z
      .string()
      .min(1)
      .describe(
        "The claim, argument, paper, analysis, methodology, results, draft or proposal to review."
      )
  });

  server.registerTool(
    "red_team",
    {
      description:
        "Run a concise but rigorous NVIDIA Nemotron adversarial RED TEAM review.",
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
                `NVIDIA model used: ${result.model}\n` +
                `RED TEAM mode: STANDARD\n\n` +
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
        "Run a detailed NVIDIA Nemotron scientific and methodological RED TEAM review.",
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
                `NVIDIA model used: ${result.model}\n` +
                `RED TEAM mode: DEEP\n\n` +
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
        "Run the strongest NVIDIA Nemotron adversarial RED TEAM review from six reviewer perspectives.",
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
                `NVIDIA model used: ${result.model}\n` +
                `RED TEAM mode: MAX\n\n` +
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
