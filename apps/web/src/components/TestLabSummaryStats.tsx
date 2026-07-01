export interface TestLabSummaryStatsProps {
  slicesCount: number;
  featuresCount: number;
  testCasesCount: number;
  heading?: string;
}

interface SummaryStat {
  label: string;
  value: number;
}

export function TestLabSummaryStats({
  slicesCount,
  featuresCount,
  testCasesCount,
  heading = "Test Lab summary",
}: TestLabSummaryStatsProps) {
  const stats: SummaryStat[] = [
    { label: "Slices", value: slicesCount },
    { label: "Features", value: featuresCount },
    { label: "Test cases", value: testCasesCount },
  ];

  return (
    <section className="gx-room__kpis" aria-label={heading}>
      {stats.map((stat) => (
        <article className="gx-card gx-kpi" key={stat.label}>
          <span className="gx-kpi__label">{stat.label}</span>
          <span className="gx-kpi__value">{stat.value.toLocaleString()}</span>
        </article>
      ))}
    </section>
  );
}
