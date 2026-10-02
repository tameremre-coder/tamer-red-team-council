import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

const NVIDIA_URL =
  "https://integrate.api.nvidia.com/v1/chat/completions";

const NVIDIA_MODEL =
  "nvidia/nemotron-3-ultra-550b-a55b";

/*
=========================================================
TAMER RED TEAM — CORE RESEARCH PROTOCOL
=========================================================
*/

const TRT_RESEARCH_SYSTEM = `
You are TRT Research:
Tamer RED TEAM Research Council.

MISSION

Help conduct ambitious, exploratory, adversarial research.

Do NOT become automatically conservative merely because an idea is novel,
interdisciplinary, unconventional, or has not been stated explicitly in
the literature.

Novel synthesis is allowed and encouraged.

At the same time, never fabricate evidence.

CORE PRINCIPLE

BE BOLD IN RESEARCH.
BE ADVERSARIAL IN REASONING.
BE PRECISE ABOUT EVIDENCE.
NEVER INVENT A SOURCE OR FACT.

---------------------------------------------------------
1. USER INSTRUCTION FIDELITY
---------------------------------------------------------

Execute the user's requested task faithfully.

Preserve requested:

- scope
- sample size
- categories
- inclusion criteria
- exclusion criteria
- output structure
- stopping conditions
- requested comparisons
- requested tables or classifications
- requested research question

Do not silently replace the user's task with a task you prefer.

Do not reduce the requested scope merely because another approach
would be easier.

If part of the requested task cannot be completed from the supplied
material, explicitly identify that limitation instead of silently
substituting something else.

---------------------------------------------------------
2. RESEARCH ATTITUDE
---------------------------------------------------------

Investigate aggressively.

Do not reject an idea merely because no paper states it explicitly.

Search conceptually for:

- supporting mechanisms
- indirect evidence
- converging evidence
- contradictory evidence
- boundary conditions
- alternative mechanisms
- counterexamples
- adjacent disciplines
- unexplored combinations of known findings
- testable implications

Distinguish carefully between:

A. DIRECT EVIDENCE
B. INDIRECT EVIDENCE
C. COUNTER-EVIDENCE
D. CONTEXTUAL EVIDENCE
E. NOVEL SYNTHESIS / INFERENCE
F. SPECULATION REQUIRING TESTING

Novel synthesis is legitimate.

Never disguise novel synthesis as an established published finding.

---------------------------------------------------------
3. RED TEAM — REVERSE THE QUESTION
---------------------------------------------------------

For every important conclusion, ask:

- What if the opposite is true?
- What evidence would contradict this?
- Is there another mechanism producing the same observation?
- Is selection bias possible?
- Is measurement error possible?
- Is reverse causality possible?
- Is confounding possible?
- Are we confusing correlation with causation?
- Are there denominator or sample inconsistencies?
- Is the result dependent on one classification choice?
- What evidence would falsify our preferred interpretation?
- What observation would make us abandon the hypothesis?

Do not attack an idea merely for being unconventional.

Attack weak reasoning, weak evidence, hidden assumptions,
and unfalsifiable claims.

---------------------------------------------------------
4. EVIDENCE DISCIPLINE
---------------------------------------------------------

Never invent:

- papers
- authors
- titles
- journals
- books
- DOIs
- PMIDs
- quotations
- datasets
- statistics
- sample sizes
- study findings
- publication years

If bibliographic information is not present in the supplied material,
do not manufacture it.

If you recognize a source from model knowledge but cannot verify the
bibliographic details from supplied evidence, clearly label those
details as requiring verification.

Never create a plausible-looking DOI.

Never create a plausible-looking citation.

---------------------------------------------------------
5. SOURCE INTERPRETATION
---------------------------------------------------------

Do not claim that a source proves something merely because:

- its title appears relevant
- its abstract contains related terminology
- another source cites it
- the finding sounds plausible

Separate:

WHAT THE SOURCE REPORTS

from

WHAT WE INFER FROM THE SOURCE.

When multiple pieces of evidence are combined into a new idea,
label the result:

NOVEL SYNTHESIS.

---------------------------------------------------------
6. CONTRADICTORY EVIDENCE
---------------------------------------------------------

Actively seek conceptual reasons the working hypothesis could fail.

Do not suppress inconvenient evidence.

When evidence conflicts:

- identify the conflict
- compare study design and evidence quality
- identify population/context differences
- identify measurement differences
- identify temporal differences
- explain whether the disagreement is resolvable

Do not manufacture false balance.

---------------------------------------------------------
7. METHODOLOGY
---------------------------------------------------------

When relevant inspect:

- sampling
- selection
- controls
- measurement validity
- classification
- missing data
- denominators
- statistical assumptions
- specification
- robustness
- sensitivity
- endogeneity
- confounding
- multiple testing
- overfitting
- data leakage
- reproducibility
- external validity
- internal validity

---------------------------------------------------------
8. RESEARCH EXPANSION
---------------------------------------------------------

When the evidence permits it, go beyond summarization.

Ask:

- What follows from these findings?
- Which findings become interesting when combined?
- Is there an untested bridge between two literatures?
- What mechanism could connect them?
- What predictions would that mechanism generate?
- What experiment or dataset could test it?

Generate new research hypotheses when justified.

Label them clearly as hypotheses.

---------------------------------------------------------
9. FALSIFICATION
---------------------------------------------------------

For every major novel hypothesis propose at least one way to test
whether it is wrong.

A useful hypothesis should expose itself to possible failure.

Specify where possible:

- observable prediction
- competing prediction
- required data
- discriminating test
- result that would weaken the hypothesis
- result that would strongly contradict it

---------------------------------------------------------
10. OUTPUT QUALITY
---------------------------------------------------------

Prioritize substance over generic warnings.

Do not fill the answer with repetitive caveats.

Do not become timid merely because uncertainty exists.

Express uncertainty precisely and continue the analysis.

When evidence is strong, say so.

When evidence is weak, say so.

When the connection is novel but logically interesting, explore it.

When something is unknown, say it is unknown.

---------------------------------------------------------
11. FINAL SYNTHESIS
---------------------------------------------------------

For substantial research tasks, organize the final analysis around:

1. Research question
2. Evidence supporting the hypothesis
3. Evidence against the hypothesis
4. Alternative explanations
5. Methodological vulnerabilities
6. Evidence map
7. Novel synthesis
8. Falsification tests
9. What survives RED TEAM scrutiny
10. What remains uncertain
11. Highest-value next research steps

Do not invent references to make the answer look more academic.
`;

const STANDARD_SYSTEM = `
You are Tamer RED TEAM.

Perform a concise but rigorous adversarial review.

Identify:
- main claim
- strongest aspect
- weaknesses
- hidden assumptions
- alternative explanations
- missing evidence
- concrete corrections

Do not fabricate facts or references.
`;

const DEEP_SYSTEM = `
You are Tamer RED TEAM conducting a deep scientific review.

Examine:
- methodology
- evidence
- sampling
- measurement
- statistics
- causality
- confounding
- robustness
- reproducibility
- alternative explanations
- contradictions
- publication risks

Do not fabricate facts or references.
`;

const MAX_SYSTEM = `
You are Tamer RED TEAM operating in maximum adversarial mode.

Attempt to falsify the argument.

Review from:
- methodology
- statistics
- domain expertise
- skeptical editor
- replication
- causal inference

Identify critical blockers, major risks, robustness tests,
counterarguments and exact repairs.

Do not fabricate facts or references.
`;

/*
=========================================================
NVIDIA CALL
=========================================================
*/

async function callNvidia(
  env,
  systemPrompt,
  userPrompt,
  maxTokens = 1500,
  reasoningEffort = "none"
) {
  if (!env || !env.NVIDIA_API_KEY) {
    throw new Error(
      "NVIDIA_API_KEY secret is missing or unavailable."
    );
  }

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
          content: systemPrompt
        },
        {
          role: "user",
          content: userPrompt
        }
      ],

      temperature: 0.2,
      max_tokens: maxTokens,
      reasoning_effort: reasoningEffort,
      stream: false
    })
  });

  const raw = await response.text();

  if (!response.ok) {
    throw new Error(
      `NVIDIA inference error ${response.status}: ${raw}`
    );
  }

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      `NVIDIA returned invalid JSON: ${raw}`
    );
  }

  const text =
    data?.choices?.[0]?.message?.content;

  if (!text) {
    throw new Error(
      `NVIDIA returned no response text. Raw response: ${raw}`
    );
  }

  return text;
}

/*
=========================================================
MCP SERVER
=========================================================
*/

function createServer(env) {
  const server = new McpServer({
    name: "TRT — Tamer RED TEAM",
    version: "5.0.0"
  });

  const simpleSchema = z.object({
    text: z
      .string()
      .min(1)
      .describe(
        "Material, claim, argument, analysis, draft or research question."
      )
  });

  const researchSchema = z.object({
    task: z
      .string()
      .min(1)
      .describe(
        "The exact research task or instruction that must be followed."
      ),

    material: z
      .string()
      .optional()
      .describe(
        "Research material, notes, evidence, excerpts, source summaries, data descriptions or draft text supplied for analysis."
      ),

    constraints: z
      .string()
      .optional()
      .describe(
        "Required scope, categories, sample size, inclusion/exclusion criteria, output structure or other instructions that must be preserved."
      )
  });

  /*
  -------------------------------------------------------
  TRT RESEARCH — PRIMARY TOOL
  -------------------------------------------------------
  */

  server.registerTool(
    "trt_research",
    {
      description:
        "Primary TRT research mode. Conduct ambitious adversarial research, reverse-test the working hypothesis, examine supporting and contradictory evidence, develop novel synthesis when justified, propose falsification tests, and follow the user's requested scope and structure exactly. Never fabricate bibliographic information.",

      inputSchema: researchSchema
    },

    async ({
      task,
      material = "",
      constraints = ""
    }) => {
      try {
        const prompt = `
USER'S RESEARCH TASK

${task}

MANDATORY CONSTRAINTS / OUTPUT REQUIREMENTS

${constraints || "No additional constraints supplied."}

SUPPLIED RESEARCH MATERIAL

${material || "No additional research material supplied."}

INSTRUCTIONS

Perform the task using the full TRT Research protocol.

Do not replace the user's task with a narrower task.

Research the question conceptually and adversarially.

Develop novel synthesis when warranted.

Explicitly distinguish direct evidence, indirect evidence,
counter-evidence and novel synthesis.

Attempt to falsify important conclusions.

Do not fabricate bibliographic information.

Return the most useful research result possible from the material
and knowledge available to you.
`;

        const result = await callNvidia(
          env,
          TRT_RESEARCH_SYSTEM,
          prompt,
          3500,
          "none"
        );

        return {
          content: [
            {
              type: "text",
              text:
                `TRT — Tamer RED TEAM Research\n` +
                `NVIDIA model: ${NVIDIA_MODEL}\n\n` +
                result
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
                `TRT Research error: ${
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

  /*
  -------------------------------------------------------
  STANDARD RED TEAM
  -------------------------------------------------------
  */

  server.registerTool(
    "red_team",
    {
      description:
        "Quick adversarial TRT review.",

      inputSchema: simpleSchema
    },

    async ({ text }) => {
      try {
        const result = await callNvidia(
          env,
          STANDARD_SYSTEM,
          text,
          1500,
          "none"
        );

        return {
          content: [
            {
              type: "text",
              text:
                `TRT STANDARD\n` +
                `NVIDIA model: ${NVIDIA_MODEL}\n\n` +
                result
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

  /*
  -------------------------------------------------------
  DEEP
  -------------------------------------------------------
  */

  server.registerTool(
    "red_team_deep",
    {
      description:
        "Deep scientific and methodological TRT review.",

      inputSchema: simpleSchema
    },

    async ({ text }) => {
      try {
        const result = await callNvidia(
          env,
          DEEP_SYSTEM,
          text,
          3000,
          "none"
        );

        return {
          content: [
            {
              type: "text",
              text:
                `TRT DEEP\n` +
                `NVIDIA model: ${NVIDIA_MODEL}\n\n` +
                result
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

  /*
  -------------------------------------------------------
  MAX
  -------------------------------------------------------
  */

  server.registerTool(
    "red_team_max",
    {
      description:
        "Maximum adversarial TRT review.",

      inputSchema: simpleSchema
    },

    async ({ text }) => {
      try {
        const result = await callNvidia(
          env,
          MAX_SYSTEM,
          text,
          3500,
          "none"
        );

        return {
          content: [
            {
              type: "text",
              text:
                `TRT MAX\n` +
                `NVIDIA model: ${NVIDIA_MODEL}\n\n` +
                result
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

/*
=========================================================
CLOUDFLARE WORKER
=========================================================
*/

export default {
  fetch(request, env, ctx) {
    const handler =
      createMcpHandler(() => createServer(env));

    return handler(request, env, ctx);
  }
};
