import { expect } from "chai";
import { createServer } from "../../src/api/server";

type ServerInstance = ReturnType<typeof createServer>;
type OperationResponse = Awaited<ReturnType<ServerInstance["executeOperation"]>>;

function singleResult(response: OperationResponse) {
  if (response.body.kind !== "single") {
    throw new Error("unexpected multipart response");
  }
  return response.body.singleResult;
}

describe("GraphQL edge scenarios", function () {
  it("rejects approvePayoutRequest for unknown id", async function () {
    const server = createServer();

    const response = await server.executeOperation({
      query: `
        mutation Approve($id: ID!) {
          approvePayoutRequest(id: $id) {
            id
          }
        }
      `,
      variables: { id: "missing-id" }
    });

    const result = singleResult(response);
    expect(result.errors).to.not.equal(undefined);
    await server.stop();
  });

  it("supports cursor pagination and validates cursor format", async function () {
    const server = createServer();

    const createMutation = `
      mutation Create($to: String!, $amount: String!, $asset: String!) {
        createPayoutRequest(to: $to, amount: $amount, asset: $asset) {
          id
        }
      }
    `;

    for (let index = 1; index <= 3; index += 1) {
      await server.executeOperation({
        query: createMutation,
        variables: {
          to: `0x00000000000000000000000000000000000000a${index}`,
          amount: "100",
          asset: "USDC"
        }
      });
    }

    const page1 = await server.executeOperation({
      query: `
        query List($first: Int!, $after: String) {
          payoutRequests(first: $first, after: $after) {
            edges {
              cursor
              node { id }
            }
            pageInfo {
              endCursor
              hasNextPage
            }
          }
        }
      `,
      variables: { first: 2 }
    });

    const page1Result = singleResult(page1);
    expect(page1Result.errors).to.equal(undefined);

    const connection1 = page1Result.data?.payoutRequests as {
      edges: Array<{ cursor: string; node: { id: string } }>;
      pageInfo: { endCursor: string | null; hasNextPage: boolean };
    };

    expect(connection1.edges).to.have.length(2);
    expect(connection1.pageInfo.hasNextPage).to.equal(true);

    const page2 = await server.executeOperation({
      query: `
        query List($first: Int!, $after: String) {
          payoutRequests(first: $first, after: $after) {
            edges {
              node { id }
            }
            pageInfo {
              hasNextPage
            }
          }
        }
      `,
      variables: { first: 2, after: connection1.pageInfo.endCursor }
    });

    const page2Result = singleResult(page2);
    expect(page2Result.errors).to.equal(undefined);

    const connection2 = page2Result.data?.payoutRequests as {
      edges: Array<{ node: { id: string } }>;
      pageInfo: { hasNextPage: boolean };
    };

    expect(connection2.edges).to.have.length(1);
    expect(connection2.pageInfo.hasNextPage).to.equal(false);

    const invalidCursor = await server.executeOperation({
      query: `
        query List($first: Int!, $after: String) {
          payoutRequests(first: $first, after: $after) {
            edges { node { id } }
          }
        }
      `,
      variables: { first: 2, after: "not-base64" }
    });

    const invalidResult = singleResult(invalidCursor);
    expect(invalidResult.errors).to.not.equal(undefined);

    await server.stop();
  });
});
