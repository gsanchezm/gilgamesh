import type { RawChunk } from '@gilgamesh/application';

/**
 * A small, paraphrased QA-knowledge sample seeded into the shared KB at startup so search + grounding
 * work out of the box (in-memory dev/tests and a fresh Postgres). The FULL licensed corpus
 * (`rag/chunks/chunks.jsonl`) is ingested separately via `scripts/ingest-corpus.ts` — these summaries are
 * original paraphrases, not verbatim copyrighted text.
 */
export const SAMPLE_CHUNKS: RawChunk[] = [
  {
    id: 'sample-discovery-example-mapping',
    source: 'bddbooks-discovery',
    headingPath: ['Discovery', 'Example Mapping'],
    section: 'Example Mapping',
    text: 'Example mapping is a collaborative discovery technique. Using four colours of cards — yellow for the story, blue for the rules, green for concrete examples, and red for open questions — a team explores a user story in a short, focused conversation before any automation.',
  },
  {
    id: 'sample-formulation-brief',
    source: 'bddbooks-formulation',
    headingPath: ['Formulation', 'BRIEF'],
    section: 'BRIEF principles',
    text: 'Good Gherkin scenarios follow the BRIEF principles: Business language, Real data, Intention revealing, Essential, Focused. A scenario should describe a single behaviour in the language of the business, not the mechanics of the user interface.',
  },
  {
    id: 'sample-ctfl-equivalence-partitioning',
    source: 'ISTQB_CTFL_Syllabus_v4.0.1',
    headingPath: ['Test Techniques', 'Black-box', 'Equivalence Partitioning'],
    section: 'Equivalence Partitioning',
    text: 'Equivalence partitioning divides the input domain into partitions of data that should be processed the same way, so one value per partition is a sufficient test. It is often combined with boundary value analysis, which exercises the edges of each partition where defects cluster.',
  },
  {
    id: 'sample-ctfl-boundary-value',
    source: 'ISTQB_CTFL_Syllabus_v4.0.1',
    headingPath: ['Test Techniques', 'Black-box', 'Boundary Value Analysis'],
    section: 'Boundary Value Analysis',
    text: 'Boundary value analysis is a black-box technique that tests the minimum, just-above-minimum, maximum and just-below-maximum values of an ordered equivalence partition, because faults frequently occur at the boundaries of the input or output ranges.',
  },
  {
    id: 'sample-ctfl-decision-table',
    source: 'ISTQB_CTFL_Syllabus_v4.0.1',
    headingPath: ['Test Techniques', 'Black-box', 'Decision Table Testing'],
    section: 'Decision Table Testing',
    text: 'Decision table testing captures combinations of conditions and their resulting actions in a table, giving systematic coverage of business rules. Each column is a rule that becomes a test case, ensuring important combinations of inputs are not overlooked.',
  },
  {
    id: 'sample-ctai-testing-ai',
    source: 'ISTQB-CTAI_Syllabus_v2.0',
    headingPath: ['Testing AI-Based Systems'],
    section: 'Challenges testing AI systems',
    text: 'Testing AI-based systems must address non-determinism, the absence of a precise test oracle, data quality and bias, and the demand for explainability and transparency — challenges that classical test techniques do not fully cover and that require new metrics such as accuracy, precision and recall.',
  },
  {
    id: 'sample-ct-sec-security-testing',
    source: 'ISTQB-CT-SEC_Syllabus_v1.0_2016',
    headingPath: ['Security Testing'],
    section: 'The security testing process',
    text: 'Security testing assesses the confidentiality, integrity and availability of a system by probing for vulnerabilities such as injection, broken authentication, sensitive-data exposure and insecure configuration, ideally throughout the lifecycle rather than only at the end.',
  },
  {
    id: 'sample-ct-pt-performance',
    source: 'ISTQB-CT-PT_Syllabus_v1.0_2018',
    headingPath: ['Performance Testing'],
    section: 'Performance test types',
    text: 'Performance testing measures responsiveness and stability under a workload. Load testing checks behaviour at expected volumes, stress testing pushes beyond them to find breaking points, and soak testing sustains load over time to reveal leaks and degradation.',
  },
];
