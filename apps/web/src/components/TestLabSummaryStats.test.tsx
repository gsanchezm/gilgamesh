import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TestLabSummaryStats } from "./TestLabSummaryStats";

describe("TestLabSummaryStats", () => {
  it("renders the Test Lab summary counts", () => {
    render(
      <TestLabSummaryStats
        slicesCount={2}
        featuresCount={12}
        testCasesCount={1234}
      />,
    );

    const summary = screen.getByRole("region", { name: "Test Lab summary" });
    expect(within(summary).getByText("Slices")).toBeTruthy();
    expect(within(summary).getByText("2")).toBeTruthy();
    expect(within(summary).getByText("Features")).toBeTruthy();
    expect(within(summary).getByText("12")).toBeTruthy();
    expect(within(summary).getByText("Test cases")).toBeTruthy();
    expect(within(summary).getByText("1,234")).toBeTruthy();
  });

  it("supports a custom accessible heading", () => {
    render(
      <TestLabSummaryStats
        slicesCount={1}
        featuresCount={2}
        testCasesCount={3}
        heading="Project coverage metrics"
      />,
    );

    expect(
      screen.getByRole("region", { name: "Project coverage metrics" }),
    ).toBeTruthy();
  });
});
