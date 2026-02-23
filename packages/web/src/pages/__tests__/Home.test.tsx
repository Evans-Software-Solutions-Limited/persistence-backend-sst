import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import Home from "../Home";
import { useGetHelloWorld } from "@/hooks/api/useGetHelloWorld";
import type { UseQueryResult } from "@tanstack/react-query";

vi.mock("@/hooks/api/useGetHelloWorld");

const mockUseGetHelloWorld = vi.mocked(useGetHelloWorld);

describe("Home", () => {
  it("should render", () => {
    mockUseGetHelloWorld.mockReturnValue({
      isLoading: false,
      data: { message: "Hello, world!" },
      error: null,
    } as unknown as UseQueryResult<{ message: string }>);
    render(<Home />);
    expect(screen.getByText("Home")).toBeDefined();
  });
});
