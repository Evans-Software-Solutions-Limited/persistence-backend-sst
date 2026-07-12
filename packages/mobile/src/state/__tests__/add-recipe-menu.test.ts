import { useAddRecipeMenu } from "@/state/add-recipe-menu";

describe("useAddRecipeMenu", () => {
  beforeEach(() => {
    useAddRecipeMenu.getState().closeMenu();
  });

  it("starts closed", () => {
    expect(useAddRecipeMenu.getState().open).toBe(false);
  });

  it("openMenu opens the sheet", () => {
    useAddRecipeMenu.getState().openMenu();
    expect(useAddRecipeMenu.getState().open).toBe(true);
  });

  it("closeMenu closes the sheet", () => {
    useAddRecipeMenu.getState().openMenu();
    useAddRecipeMenu.getState().closeMenu();
    expect(useAddRecipeMenu.getState().open).toBe(false);
  });
});
