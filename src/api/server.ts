import {ApolloServer} from "@apollo/server";
import {resolvers} from "./resolvers";
import {typeDefs} from "./schema";

export function createServer(): ApolloServer {
  return new ApolloServer({typeDefs, resolvers});
}
