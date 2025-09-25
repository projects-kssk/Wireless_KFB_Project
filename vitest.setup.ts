import "@testing-library/jest-dom/vitest";
import "whatwg-fetch";
import { beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";

export const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
