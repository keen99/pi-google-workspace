import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

type PackageManifest = {
  files?: string[];
  peerDependencies?: Record<string, string>;
  engines?: Record<string, string>;
};

describe("published package manifest", () => {
  it("ships entrypoint and imported source modules", async () => {
    const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as PackageManifest;
    expect(manifest.files).toEqual(expect.arrayContaining(["index.ts", "src/**/*.ts"]));
  });

  it("declares current pi host and Node runtime", async () => {
    const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as PackageManifest;
    expect(manifest.peerDependencies?.["@earendil-works/pi-coding-agent"]).toMatch(/^\^0\.83\./);
    expect(manifest.engines?.node).toBe(">=22.19.0");
  });
});
