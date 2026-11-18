import { afterEach, describe, expect, it, vi } from "vitest";
import { loadEnv } from "vite";
import config from "../vite.config";

vi.mock("vite", async (importOriginal) => ({
  ...await importOriginal<typeof import("vite")>(),
  loadEnv: vi.fn(),
}));

afterEach(() => vi.resetAllMocks());

describe("开发服务器环境配置", () => {
  it("保留默认地址和代理", () => {
    vi.mocked(loadEnv).mockReturnValue({});
    const result = config({ command: "serve", mode: "development" });
    expect(result.server).toMatchObject({
      host: "0.0.0.0", port: 5300,
      proxy: { "/api": { target: "http://127.0.0.1:8300" } },
    });
  });

  it("读取自定义主机、端口和代理", () => {
    vi.mocked(loadEnv).mockReturnValue({
      FRONTEND_HOST: "127.0.0.1", FRONTEND_PORT: "5400",
      VITE_API_TARGET: "http://127.0.0.1:8400",
    });
    const result = config({ command: "serve", mode: "development" });
    expect(result.server).toMatchObject({
      host: "127.0.0.1", port: 5400,
      proxy: {
        "/api": { target: "http://127.0.0.1:8400" },
        "/uploads": { target: "http://127.0.0.1:8400" },
      },
    });
  });

  it.each(["abc", "0", "65536", "5300.5"])("拒绝无效端口 %s", (port) => {
    vi.mocked(loadEnv).mockReturnValue({ FRONTEND_PORT: port });
    expect(() => config({ command: "serve", mode: "development" })).toThrow("FRONTEND_PORT");
  });
});
