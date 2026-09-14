import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminDialogProvider } from "../AdminDialogs";
import { useAdminDialogs } from "../useAdminDialogs";
const result = vi.fn();
function Consumer() {
  const { prompt, confirm } = useAdminDialogs();
  return (
    <>
      <button
        onClick={async () => result(await prompt("Audit reason", "Initial"))}
      >
        Request input
      </button>
      <button onClick={async () => result(await confirm("Archive this code?"))}>
        Request confirmation
      </button>
    </>
  );
}
function page() {
  return render(
    <AdminDialogProvider>
      <Consumer />
    </AdminDialogProvider>,
  );
}
describe("branded admin dialogs", () => {
  afterEach(() => result.mockReset());
  it("focuses input and resolves entered text", async () => {
    page();
    const button = screen.getByRole("button", { name: "Request input" });
    button.focus();
    fireEvent.click(button);
    const input = await screen.findByRole("textbox", { name: "Audit reason" });
    expect(document.activeElement).toBe(input);
    expect(input).toHaveProperty("value", "Initial");
    fireEvent.change(input, { target: { value: "Updated" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(result).toHaveBeenCalledWith("Updated"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("cancels with Escape and restores focus", async () => {
    page();
    const button = screen.getByRole("button", { name: "Request input" });
    button.focus();
    fireEvent.click(button);
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(result).toHaveBeenCalledWith(null));
    await waitFor(() => expect(document.activeElement).toBe(button));
  });
  it("confirms or cancels without native prompts", async () => {
    page();
    fireEvent.click(
      screen.getByRole("button", { name: "Request confirmation" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(result).toHaveBeenLastCalledWith(false));
    fireEvent.click(
      screen.getByRole("button", { name: "Request confirmation" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(result).toHaveBeenLastCalledWith(true));
  });
  it("cancels pending actions on unmount", async () => {
    const view = page();
    fireEvent.click(screen.getByRole("button", { name: "Request input" }));
    await screen.findByRole("dialog");
    view.unmount();
    await waitFor(() => expect(result).toHaveBeenCalledWith(null));
  });
  it("safely cancels requests outside a provider", async () => {
    render(<Consumer />);
    fireEvent.click(screen.getByRole("button", { name: "Request input" }));
    await waitFor(() => expect(result).toHaveBeenCalledWith(null));
    fireEvent.click(
      screen.getByRole("button", { name: "Request confirmation" }),
    );
    await waitFor(() => expect(result).toHaveBeenCalledWith(false));
  });
});
