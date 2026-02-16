import {ApolloServer} from "@apollo/server";
import {createResolvers} from "./resolvers";
import {typeDefs} from "./schema";
import {PayoutRepo} from "../db/repo";
import type {Database} from "sql.js";


export function createServer(database: Database): ApolloServer {
  const payoutRepo = new PayoutRepo(database);

  return new ApolloServer({typeDefs, resolvers: createResolvers(payoutRepo)});
}
