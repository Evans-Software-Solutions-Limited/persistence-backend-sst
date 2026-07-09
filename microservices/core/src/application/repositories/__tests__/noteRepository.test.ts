/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";

/** Render a captured drizzle WHERE condition to SQL — asserts the real column
 * predicates rather than trusting the mocked chain (guards the ownership scope
 * against a future edit dropping a predicate; the mocked-getDb blind spot). */
function renderWhere(cond: unknown): { sql: string; paramCount: number } {
  const { sql, params } = new PgDialect().sqlToQuery(cond as any);
  return { sql: sql.toLowerCase(), paramCount: params.length };
}

function makeInsertChain(resolvedValue: unknown) {
  return {
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(resolvedValue),
    }),
  };
}

function makeUpdateChain(resolvedValue: unknown) {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(resolvedValue),
      }),
    }),
  };
}

function makeDeleteChain(resolvedValue: unknown) {
  return {
    where: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(resolvedValue),
    }),
  };
}

function makeSelectListChain(resolvedValue: unknown) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue(resolvedValue),
      }),
    }),
  };
}

const dbNote = {
  id: "n-1",
  trainerId: "trainer-1",
  clientId: "client-1",
  noteType: "general",
  title: "",
  content: "Great session today",
  isPrivate: false,
  sessionId: null,
  createdAt: new Date("2026-07-01T12:00:00.000Z"),
  updatedAt: new Date("2026-07-01T12:00:00.000Z"),
};

describe("NoteRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("create", () => {
    it("inserts a note scoped to trainer + client and maps to the wire shape", async () => {
      const insert = vi.fn().mockReturnValue(makeInsertChain([dbNote]));
      (getDb as any).mockReturnValue({ insert });

      const { NoteRepository } = await import("../noteRepository");
      const repo = new NoteRepository();
      const result = await repo.create({
        trainerId: "trainer-1",
        clientId: "client-1",
        content: "Great session today",
        title: "",
        noteType: "general",
      });

      expect(result).toEqual({
        id: "n-1",
        noteType: "general",
        title: "",
        content: "Great session today",
        createdAt: "2026-07-01T12:00:00.000Z",
      });
      expect(insert).toHaveBeenCalledTimes(1);
    });

    it("uses the caller-provided tx handle instead of getDb() when passed", async () => {
      const txInsert = vi.fn().mockReturnValue(makeInsertChain([dbNote]));
      const tx = { insert: txInsert } as any;

      const { NoteRepository } = await import("../noteRepository");
      const repo = new NoteRepository();
      await repo.create(
        {
          trainerId: "trainer-1",
          clientId: "client-1",
          content: "x",
          title: "",
        },
        tx,
      );

      expect(txInsert).toHaveBeenCalledTimes(1);
      expect(getDb).not.toHaveBeenCalled();
    });

    it("coerces a null noteType on the returned row to the DB default 'progress'", async () => {
      const rowWithNullType = { ...dbNote, noteType: null };
      const insert = vi
        .fn()
        .mockReturnValue(makeInsertChain([rowWithNullType]));
      (getDb as any).mockReturnValue({ insert });

      const { NoteRepository } = await import("../noteRepository");
      const repo = new NoteRepository();
      const result = await repo.create({
        trainerId: "trainer-1",
        clientId: "client-1",
        content: "x",
        title: "",
      });

      expect(result.noteType).toBe("progress");
    });
  });

  describe("update", () => {
    it("updates and returns the mapped row when it matches trainer+client+id", async () => {
      const updated = { ...dbNote, content: "edited" };
      const update = vi.fn().mockReturnValue(makeUpdateChain([updated]));
      (getDb as any).mockReturnValue({ update });

      const { NoteRepository } = await import("../noteRepository");
      const repo = new NoteRepository();
      const result = await repo.update({
        noteId: "n-1",
        trainerId: "trainer-1",
        clientId: "client-1",
        content: "edited",
      });

      expect(result).toEqual(
        expect.objectContaining({ id: "n-1", content: "edited" }),
      );
      expect(update).toHaveBeenCalledTimes(1);
    });

    it("returns null when no row matches (missing / another trainer's note)", async () => {
      const update = vi.fn().mockReturnValue(makeUpdateChain([]));
      (getDb as any).mockReturnValue({ update });

      const { NoteRepository } = await import("../noteRepository");
      const repo = new NoteRepository();
      const result = await repo.update({
        noteId: "missing",
        trainerId: "trainer-1",
        clientId: "client-1",
        content: "edited",
      });

      expect(result).toBeNull();
    });

    it("scopes the UPDATE WHERE to id + trainer_id + client_id (ownership guard)", async () => {
      let whereArg: unknown;
      const returning = vi.fn().mockResolvedValue([dbNote]);
      const where = vi.fn((cond: unknown) => {
        whereArg = cond;
        return { returning };
      });
      const update = vi.fn().mockReturnValue({ set: vi.fn(() => ({ where })) });
      (getDb as any).mockReturnValue({ update });

      const { NoteRepository } = await import("../noteRepository");
      await new NoteRepository().update({
        noteId: "n-1",
        trainerId: "trainer-1",
        clientId: "client-1",
        content: "x",
      });

      const { sql, paramCount } = renderWhere(whereArg);
      expect(sql).toContain("trainer_id");
      expect(sql).toContain("client_id");
      expect(sql).toMatch(/"id"\s*=/); // the note-id predicate, distinct from *_id
      expect(paramCount).toBe(3); // exactly the three scoping predicates
    });
  });

  describe("delete", () => {
    it("deletes and returns the mapped deleted row when it matches trainer+client+id", async () => {
      const del = vi.fn().mockReturnValue(makeDeleteChain([dbNote]));
      (getDb as any).mockReturnValue({ delete: del });

      const { NoteRepository } = await import("../noteRepository");
      const repo = new NoteRepository();
      const result = await repo.delete({
        noteId: "n-1",
        trainerId: "trainer-1",
        clientId: "client-1",
      });

      expect(result).toEqual(
        expect.objectContaining({ id: "n-1", content: dbNote.content }),
      );
      expect(del).toHaveBeenCalledTimes(1);
    });

    it("returns null when no row matches (missing / another trainer's note)", async () => {
      const del = vi.fn().mockReturnValue(makeDeleteChain([]));
      (getDb as any).mockReturnValue({ delete: del });

      const { NoteRepository } = await import("../noteRepository");
      const repo = new NoteRepository();
      const result = await repo.delete({
        noteId: "missing",
        trainerId: "trainer-1",
        clientId: "client-1",
      });

      expect(result).toBeNull();
    });

    it("scopes the DELETE WHERE to id + trainer_id + client_id (ownership guard)", async () => {
      let whereArg: unknown;
      const returning = vi.fn().mockResolvedValue([dbNote]);
      const where = vi.fn((cond: unknown) => {
        whereArg = cond;
        return { returning };
      });
      (getDb as any).mockReturnValue({ delete: vi.fn(() => ({ where })) });

      const { NoteRepository } = await import("../noteRepository");
      await new NoteRepository().delete({
        noteId: "n-1",
        trainerId: "trainer-1",
        clientId: "client-1",
      });

      const { sql, paramCount } = renderWhere(whereArg);
      expect(sql).toContain("trainer_id");
      expect(sql).toContain("client_id");
      expect(sql).toMatch(/"id"\s*=/);
      expect(paramCount).toBe(3);
    });
  });

  describe("listForClient", () => {
    it("lists notes for a (trainer, client) pair newest-first, mapped to the wire shape", async () => {
      const select = vi.fn().mockReturnValue(makeSelectListChain([dbNote]));
      (getDb as any).mockReturnValue({ select });

      const { NoteRepository } = await import("../noteRepository");
      const repo = new NoteRepository();
      const result = await repo.listForClient("trainer-1", "client-1");

      expect(result).toEqual([
        {
          id: "n-1",
          noteType: "general",
          title: "",
          content: "Great session today",
          createdAt: "2026-07-01T12:00:00.000Z",
        },
      ]);
    });
  });
});
