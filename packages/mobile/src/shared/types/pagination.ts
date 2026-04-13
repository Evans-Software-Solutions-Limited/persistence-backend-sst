export type PaginatedResult<T> = {
  data: T[];
  cursor: string | null;
  hasMore: boolean;
};

export type PaginationParams = {
  limit?: number;
  offset?: number;
  cursor?: string;
};
