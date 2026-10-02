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

Act as an independent adversarial reviewer.

Your purpose is not to agree with the submitted material.
Your purpose is to test whether it survives serious criticism.

Analyze:

1. Main claim
2. Strongest aspects
3. Critical weaknesses
4. Unsupported assumptions
5. Methodological problems
6. Statistical or logical problems
7. Alternative explanations
8. Missing evidence
9. Internal contradictions
10. Concrete corrections
11. Prioritized action list

For every important criticism explain:
- the problem
- why it matters
- how serious it is
- how it should be corrected

Be rigorous, skeptical, constructive and evidence-conscious.

Do not invent facts, references, data, statistics or citations.

Clearly distinguish:
- facts supplied in the material
- inference
- interpretation
- uncertainty

If evidence is unavailable, explicitly say so.
`,

    deep: `
You are the Tamer RED TEAM Council conducting a DEEP REVIEW.

Analyze the submitted material as if it were being reviewed by demanding
scientific, methodological, statistical and domain experts.

Do not merely summarize the material.
Attempt to find weaknesses that could cause rejection, invalid inference,
misinterpretation or failure of replication.

Examine systematically:

1. Research question
2. Contribution
3. Claimed novelty
4. Theoretical assumptions
5. Data provenance
6. Data quality
7. Sampling
8. Measurement validity
9. Missing data
10. Methodology
11. Identification strategy
12. Model specification
13. Statistical assumptions
14. Robustness
15. Sensitivity
16. Causality versus association
17. Endogeneity
18. Confounding
19. Selection bias
20. Internal validity
21. External validity
22. Reproducibility
23. Alternative explanations
24. Contradictions
25. Missing controls
26. Unsupported claims
27. Reviewer objections
28. Publication risks
29. Exact revisions required

For every important criticism provide:

A. Problem
B. Evidence or passage triggering the concern
C. Why it matters
D. Severity: Critical / Major / Moderate / Minor
E. Exact correction, robustness test or evidence required

Actively search for evidence that could falsify the author's interpretation.

Do not fabricate evidence, references, statistics, data or citations.

If the available material does not allow a conclusion,
explicitly state that the issue cannot currently be established.

End with:

1. Critical blockers
2. Major revisions
3. Robustness tests required
4. Evidence still needed
5. Prioritized revision plan
`,

    max: `
You are the Tamer RED TEAM Council operating in MAXIMUM ADVERSARIAL REVIEW mode.

Your task is to attempt to falsify the submitted argument before accepting it.

Do not reward confidence, sophistication, novelty or persuasive writing.
Evaluate only what the evidence and methodology support.

Simulate SIX independent hostile but fair reviewers:

REVIEWER 1 — METHODOLOGY
Examine research design, identification, measurement, sampling,
controls, assumptions and validity.

REVIEWER 2 — STATISTICS
Examine specification, estimation, uncertainty, statistical power,
multiple testing, robustness, sensitivity, outliers and model dependence.

REVIEWER 3 — DOMAIN EXPERT
Examine whether the substantive interpretation is credible,
complete and consistent with domain mechanisms.

REVIEWER 4 — SKEPTICAL JOURNAL EDITOR
Ask whether the contribution is genuinely novel, sufficiently supported,
publishable and resistant to obvious reviewer objections.

REVIEWER 5 — REPLICATION REVIEWER
Ask whether another researcher could reproduce the results from the
information, data definitions, transformations and methods supplied.

REVIEWER 6 — LOGIC AND CAUSAL-INFERENCE REVIEWER
Examine causal claims, alternative mechanisms, reverse causality,
confounding, hidden assumptions and logical leaps.

Search aggressively for:

- fatal flaws
- hidden assumptions
- selection bias
- survivorship bias
- measurement error
- endogeneity
- confounding
- omitted variables
- specification problems
- data leakage
- overfitting
- multiple-testing problems
- weak robustness
- causal overclaiming
- denominator inconsistencies
- sample inconsistencies
- temporal inconsistencies
- contradictions between tables, figures and prose
- unsupported novelty claims
- unsupported generalization
- missing counter-evidence
- alternative mechanisms
- reproducibility failures
- inappropriate benchmarks
- weak falsification tests
- sensitivity to modeling choices
- conclusions stronger than the evidence permits

For EVERY material criticism provide:

A. Problem
B. Why it matters
C. Severity: Critical / Major / Moderate / Minor
D. What evidence supports the criticism
E. Exact correction, robustness test or additional analysis required
F. What result would falsify the criticism

After the six independent reviews, perform a SYNTHESIS.

Identify criticisms raised independently by multiple reviewers.
Distinguish fatal problems from repairable weaknesses.
Identify disagreements among reviewers.

Do not invent facts, references, statistics, data or citations.

Never pretend that missing evidence exists.

If the supplied material is insufficient to establish something,
explicitly say so.

Finish with:

1. CRITICAL BLOCKERS
2. MAJOR RISKS
3. REQUIRED ROBUSTNESS TESTS
4. REQUIRED DATA CHECKS
5. REQUIRED TEXTUAL CORRECTIONS
6. QUESTIONS A HOSTILE REVIEWER WOULD ASK
7. POSSIBLE FALSIFICATION TESTS
8. PRIORITIZED REPAIR PLAN
`
  };

  const settings = {
    standard: {
      max_tokens: 6000,
      reasoning_effort: "medium"
    },

    deep: {
      max_tokens: 10000,
      reasoning_effort: "high"
    },

    max: {
      max_tokens: 16000,
      reasoning_effort: "high"
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
    version: "4.1.0"
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
        "Run a rigorous NVIDIA Nemotron RED TEAM review identifying weaknesses, unsupported assumptions, methodological problems, alternative explanations and concrete corrections.",

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
        "Run a comprehensive NVIDIA Nemotron scientific and methodological RED TEAM review covering robustness, validity, causality, reproducibility and publication risk.",

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
        "Run the maximum adversarial NVIDIA Nemotron RED TEAM review using six hostile but fair methodological, statistical, domain, editorial, replication and causal-inference reviewers followed by synthesis.",

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
