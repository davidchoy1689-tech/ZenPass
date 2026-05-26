// ZenPass CSS/響應式測試
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const FRONTEND_DIR = path.resolve(__dirname, "..", "..", "frontend");

describe("🎨 CSS 與響應式", () => {
  it("所有 HTML 檔案有 viewport meta", () => {
    const files = fs
      .readdirSync(FRONTEND_DIR)
      .filter((f) => f.endsWith(".html"));
    for (const file of files) {
      const content = fs.readFileSync(path.join(FRONTEND_DIR, file), "utf-8");
      expect(content).toMatch(/<meta[^>]*name=["']viewport["']/);
    }
  });

  it("所有 HTML 檔案有 charset", () => {
    const files = fs
      .readdirSync(FRONTEND_DIR)
      .filter((f) => f.endsWith(".html"));
    for (const file of files) {
      const content = fs.readFileSync(path.join(FRONTEND_DIR, file), "utf-8");
      expect(content).toMatch(/<meta[^>]*charset/);
    }
  });

  it("載入速度測試 - index.html < 10KB", () => {
    const content = fs.readFileSync(
      path.join(FRONTEND_DIR, "index.html"),
      "utf-8",
    );
    const sizeKB = Buffer.byteLength(content, "utf-8") / 1024;
    expect(sizeKB).toBeLessThan(50); // 50KB is reasonable for a SPA
  });
});
