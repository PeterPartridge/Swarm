import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import FileIcon, { kindOf } from "../../components/code/FileIcon";

describe("kindOf", () => {
  /// Grouped by role, not by language: a reader scanning a tree wants
  /// "code / markup / config", not thirty logos.
  it("groups files by what they are for", () => {
    expect(kindOf("main.rs", false)).toBe("code");
    expect(kindOf("App.tsx", false)).toBe("code");
    expect(kindOf("index.html", false)).toBe("markup");
    expect(kindOf("styles.css", false)).toBe("style");
    expect(kindOf("tauri.conf.json", false)).toBe("config");
    expect(kindOf("README.md", false)).toBe("doc");
    expect(kindOf("logo.png", false)).toBe("image");
  });

  it("calls a folder a folder whatever it is named", () => {
    expect(kindOf("src", true)).toBe("folder");
    // A folder called `styles.css` is still a folder — the flag decides.
    expect(kindOf("styles.css", true)).toBe("folder");
  });

  /// A lockfile is generated and not yours to edit by hand, so it does not look
  /// like the config beside it.
  it("tells a lockfile from a config", () => {
    expect(kindOf("package-lock.json", false)).toBe("lock");
    expect(kindOf("Cargo.lock", false)).toBe("lock");
    expect(kindOf("package.json", false)).toBe("config");
  });

  /// **A leading dot is not an extension.** `.gitignore` split naively becomes
  /// an extension of "gitignore" and matches nothing — the file that most
  /// deserves an icon would be the one without.
  it("reads a dotfile by its whole name", () => {
    expect(kindOf(".gitignore", false)).toBe("config");
  });

  it("case does not matter", () => {
    expect(kindOf("MAIN.RS", false)).toBe("code");
    expect(kindOf("Dockerfile", false)).toBe("config");
  });

  /// An unknown file is a file. Falling back is a real answer, not a gap.
  it("has an answer for something it does not know", () => {
    expect(kindOf("mystery.qqq", false)).toBe("plain");
    expect(kindOf("LICENSE", false)).toBe("plain");
  });
});

describe("FileIcon", () => {
  /// Decorative on purpose: the name is right beside it. A screen reader
  /// announcing "image, image, style" down a tree is noise, not information.
  it("is hidden from screen readers", () => {
    const { container } = render(<FileIcon name="main.rs" isDir={false} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveClass("kind-code");
    // Nothing announceable was added to the accessibility tree.
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
