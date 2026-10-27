import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import ThemeSetting from "../../components/common/ThemeSetting";

describe("ThemeSetting", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  /// Dark is the default — this sits beside an editor and a terminal.
  it("defaults to dark", async () => {
    render(<ThemeSetting />);
    expect(await screen.findByRole("radio", { name: "Dark" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Light" })).not.toBeChecked();
  });

  /// Choosing light stamps the root and remembers it, both at once — the whole
  /// app is themed off that attribute, so the change is instant and it survives
  /// a reload.
  it("applies and remembers the light choice", async () => {
    const user = userEvent.setup();
    render(<ThemeSetting />);

    await user.click(screen.getByRole("radio", { name: "Light" }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("coperativeai.theme")).toBe("light");
  });

  /// A machine that saved light last time opens in light.
  it("reflects the saved choice on mount", async () => {
    localStorage.setItem("coperativeai.theme", "light");
    render(<ThemeSetting />);
    expect(await screen.findByRole("radio", { name: "Light" })).toBeChecked();
  });
});
