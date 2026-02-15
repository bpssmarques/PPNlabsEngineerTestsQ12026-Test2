import {expect} from "chai";
import {createServer} from "../../src/api/server";

describe("GraphQL Extended Tests", function () {
  it("queries a single payout request by id", async function () {
    const server = createServer();

    // Create a request first
    const createResponse = await server.executeOperation({
      query: `
        mutation Create($to: String!, $amount: String!, $asset: String!) {
          createPayoutRequest(to: $to, amount: $amount, asset: $asset) {
            id
            status
          }
        }
      `,
      variables: {
        to: "0x00000000000000000000000000000000000000a1",
        amount: "1000000",
        asset: "USDC"
      }
    });

    expect(createResponse.body.kind).to.equal("single");
    if (createResponse.body.kind !== "single") {
      throw new Error("unexpected multipart response");
    }
    const createdId = createResponse.body.singleResult.data?.createPayoutRequest.id;

    // Query it back
    const queryResponse = await server.executeOperation({
      query: `
        query GetRequest($id: ID!) {
          payoutRequest(id: $id) {
            id
            status
            to
            amount
            asset
          }
        }
      `,
      variables: {id: createdId}
    });

    expect(queryResponse.body.kind).to.equal("single");
    if (queryResponse.body.kind !== "single") {
      throw new Error("unexpected multipart response");
    }
    expect(queryResponse.body.singleResult.errors).to.equal(undefined);
    expect(queryResponse.body.singleResult.data?.payoutRequest.id).to.equal(createdId);
    expect(queryResponse.body.singleResult.data?.payoutRequest.status).to.equal("PENDING_RISK");

    await server.stop();
  });

  it("queries payout requests with pagination", async function () {
    const server = createServer();

    // Create multiple requests
    for (let i = 0; i < 3; i++) {
      await server.executeOperation({
        query: `
          mutation Create($to: String!, $amount: String!, $asset: String!) {
            createPayoutRequest(to: $to, amount: $amount, asset: $asset) {
              id
            }
          }
        `,
        variables: {
          to: "0x00000000000000000000000000000000000000a1",
          amount: "1000000",
          asset: "USDC"
        }
      });
    }

    // Query with pagination
    const queryResponse = await server.executeOperation({
      query: `
        query GetRequests($first: Int!) {
          payoutRequests(first: $first) {
            edges {
              cursor
              node {
                id
                status
              }
            }
            pageInfo {
              endCursor
              hasNextPage
            }
          }
        }
      `,
      variables: {first: 2}
    });

    expect(queryResponse.body.kind).to.equal("single");
    if (queryResponse.body.kind !== "single") {
      throw new Error("unexpected multipart response");
    }
    expect(queryResponse.body.singleResult.errors).to.equal(undefined);
    expect(queryResponse.body.singleResult.data?.payoutRequests.edges.length).to.equal(2);
    expect(queryResponse.body.singleResult.data?.payoutRequests.pageInfo.hasNextPage).to.equal(true);

    await server.stop();
  });

  it("approves a payout request and changes status", async function () {
    const server = createServer();

    // Create
    const createResponse = await server.executeOperation({
      query: `
        mutation Create($to: String!, $amount: String!, $asset: String!) {
          createPayoutRequest(to: $to, amount: $amount, asset: $asset) {
            id
            status
          }
        }
      `,
      variables: {
        to: "0x00000000000000000000000000000000000000a1",
        amount: "1000000",
        asset: "USDC"
      }
    });

    expect(createResponse.body.kind).to.equal("single");
    if (createResponse.body.kind !== "single") {
      throw new Error("unexpected multipart response");
    }
    const createdId = createResponse.body.singleResult.data?.createPayoutRequest.id;
    expect(createResponse.body.singleResult.data?.createPayoutRequest.status).to.equal("PENDING_RISK");

    // Approve
    const approveResponse = await server.executeOperation({
      query: `
        mutation Approve($id: ID!) {
          approvePayoutRequest(id: $id) {
            id
            status
          }
        }
      `,
      variables: {id: createdId}
    });

    expect(approveResponse.body.kind).to.equal("single");
    if (approveResponse.body.kind !== "single") {
      throw new Error("unexpected multipart response");
    }
    expect(approveResponse.body.singleResult.errors).to.equal(undefined);
    expect(approveResponse.body.singleResult.data?.approvePayoutRequest.status).to.equal("APPROVED");

    await server.stop();
  });

  it("filters payout requests by status", async function () {
    const server = createServer();

    // Create and approve one
    const createResponse1 = await server.executeOperation({
      query: `
        mutation Create($to: String!, $amount: String!, $asset: String!) {
          createPayoutRequest(to: $to, amount: $amount, asset: $asset) {
            id
          }
        }
      `,
      variables: {
        to: "0x00000000000000000000000000000000000000a1",
        amount: "1000000",
        asset: "USDC"
      }
    });
    const id1 = createResponse1.body.kind === "single" ? createResponse1.body.singleResult.data?.createPayoutRequest.id : null;

    await server.executeOperation({
      query: `mutation Approve($id: ID!) { approvePayoutRequest(id: $id) { id } }`,
      variables: {id: id1}
    });

    // Create another without approving
    await server.executeOperation({
      query: `
        mutation Create($to: String!, $amount: String!, $asset: String!) {
          createPayoutRequest(to: $to, amount: $amount, asset: $asset) {
            id
          }
        }
      `,
      variables: {
        to: "0x00000000000000000000000000000000000000a2",
        amount: "2000000",
        asset: "USDC"
      }
    });

    // Query only APPROVED
    const queryResponse = await server.executeOperation({
      query: `
        query GetRequests($status: PayoutStatus, $first: Int!) {
          payoutRequests(status: $status, first: $first) {
            edges {
              node {
                id
                status
              }
            }
          }
        }
      `,
      variables: {status: "APPROVED", first: 10}
    });

    expect(queryResponse.body.kind).to.equal("single");
    if (queryResponse.body.kind !== "single") {
      throw new Error("unexpected multipart response");
    }
    expect(queryResponse.body.singleResult.errors).to.equal(undefined);
    const edges = queryResponse.body.singleResult.data?.payoutRequests.edges;
    expect(edges.length).to.be.greaterThan(0);
    edges.forEach((edge: any) => {
      expect(edge.node.status).to.equal("APPROVED");
    });

    await server.stop();
  });
});
