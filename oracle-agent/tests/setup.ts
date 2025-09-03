// Test setup file
import * as dotenv from "dotenv";

// Load test environment variables
dotenv.config({ path: ".env.test" });

// Set longer timeout for API integration tests
jest.setTimeout(30000);

// Mock axios by default to prevent external API calls during tests
jest.mock("axios");

// Test helper types
interface TestHelpers {
  createMockResponse: (data: any, status?: number) => any;
  createMockBLSResponse: (value: string, year: string, period: string) => any;
  sleep: (ms: number) => Promise<void>;
}

// Global test helpers
const testHelpers: TestHelpers = {
  // Helper to create mock API responses
  createMockResponse: (data: any, status = 200) => ({
    data,
    status,
    statusText: "OK",
    headers: {},
    config: {},
  }),

  // Helper to create mock BLS API response
  createMockBLSResponse: (value: string, year: string, period: string) => ({
    status: "REQUEST_SUCCEEDED",
    Results: {
      series: [
        {
          data: [
            {
              value,
              year,
              period,
              latest: "true",
            },
          ],
        },
      ],
    },
  }),

  // Helper to sleep in tests
  sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
};

// Make helpers globally available
(global as any).testHelpers = testHelpers;

// Declare global types
declare global {
  var testHelpers: TestHelpers;
}
