import { readLocalFile } from "../localFile";

describe("readLocalFile", () => {
  const fetchSpy = jest.spyOn(globalThis, "fetch");
  afterAll(() => fetchSpy.mockRestore());

  it("returns the file's bytes", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      blob: async () => new Blob(["jpeg"]),
    } as never);
    const blob = await readLocalFile("file:///a.jpg");
    expect(blob.size).toBe(4);
    expect(fetchSpy).toHaveBeenCalledWith("file:///a.jpg");
  });

  it("accepts a status-0 local read", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 0,
      blob: async () => new Blob(["x"]),
    } as never);
    await expect(readLocalFile("file:///a.jpg")).resolves.toBeTruthy();
  });

  it("throws when the file is unreadable, empty or gone", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 404,
      blob: async () => new Blob([]),
    } as never);
    await expect(readLocalFile("file:///a.jpg")).rejects.toThrow("(404)");
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      blob: async () => new Blob([]),
    } as never);
    await expect(readLocalFile("file:///a.jpg")).rejects.toThrow("empty");
    fetchSpy.mockRejectedValueOnce(new Error("No such file"));
    await expect(readLocalFile("file:///a.jpg")).rejects.toThrow(
      "No such file",
    );
  });
});
