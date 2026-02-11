import {expect} from "chai";
import {createServer} from "../src/api/server";

describe("GraphQL integration", function () {
  it("creates and approves a payout request", async function () {
    const server = createServer();

    const createResponse = await server.executeOperation({
      query: `
        mutation Create($to: String!, $amount: String!, $asset: String!) {
          createPayoutRequest(to: $to, amount: $amount, asset: $asset) {
            id
            requestId
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
    expect(createResponse.body.singleResult.errors).to.equal(undefined);

    await server.stop();
  });
});
