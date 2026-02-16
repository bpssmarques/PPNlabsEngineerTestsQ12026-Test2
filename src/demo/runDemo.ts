import {mkdir, writeFile} from "node:fs/promises";
import risk from "../../candidate-pack/risk.json";
import {typeDefs} from "../api/schema";
import {createServer} from "../api/server";
import {createDb} from "../db/db";

async function main() {
  const database = await createDb();
  const server = createServer(database);
  const mutation = `
    mutation Create($to: String!, $amount: String!, $asset: String!) {
      createPayoutRequest(to: $to, amount: $amount, asset: $asset) {
        id
        requestId
        status
      }
    }
  `;
  const variables = {
    to: risk.demo.to,
    amount: risk.demo.amount,
    asset: risk.demo.asset
  };

  const response = await server.executeOperation({query: mutation, variables});
  const result = response.body.kind === "single" ? response.body.singleResult : {errors: [{message: "unexpected multipart"}]};

  await mkdir("artifacts", {recursive: true});
  await writeFile("artifacts/schema.graphql", `${typeDefs.trim()}\n`, "utf8");

  const markdown = [
    "# Test 2 Demo",
    "",
    "## Mutation",
    "```graphql",
    mutation.trim(),
    "```",
    "",
    "## Variables",
    "```json",
    JSON.stringify(variables, null, 2),
    "```",
    "",
    "## Result",
    "```json",
    JSON.stringify(result, null, 2),
    "```",
    ""
  ].join("\n");

  await writeFile("artifacts/demo.md", markdown, "utf8");
  process.stdout.write(markdown);
  await server.stop();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
