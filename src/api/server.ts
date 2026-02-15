import { ApolloServer } from "@apollo/server";
import { buildResolvers } from "./resolvers";
import { typeDefs } from "./schema";
import { createDb } from "../db/db";
import { PayoutRepo } from "../db/repo";

export function createServer(): ApolloServer {
  const repoPromise = createDb().then((db) => new PayoutRepo(db));
  return new ApolloServer({ typeDefs, resolvers: buildResolvers(repoPromise) });
}
