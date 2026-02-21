import {ApolloServer} from "@apollo/server";
import {createDb} from "../db/db";
import {PayoutRepo} from "../db/repo";
import {resolvers} from "./resolvers";
import {typeDefs} from "./schema";

export interface ApiContext {
  repo: PayoutRepo;
}

export function createServer(): ApolloServer<ApiContext> {
  let repoPromise: Promise<PayoutRepo> | null = null;
  async function getOrCreateRepo(): Promise<PayoutRepo> {
    if (!repoPromise) {
      repoPromise = createDb().then((db) => new PayoutRepo(db));
    }
    return repoPromise;
  }
  const apollo = new ApolloServer<ApiContext>({typeDefs, resolvers});
  return new Proxy(apollo, {
    get(target, prop) {
      if (prop === "executeOperation") {
        return async (request: unknown, options?: {contextValue?: ApiContext}) => {
          const contextValue = options?.contextValue ?? {repo: await getOrCreateRepo()};
          return target.executeOperation(request as Parameters<typeof target.executeOperation>[0], {contextValue});
        };
      }
      return (target as Record<string, unknown>)[prop as string];
    }
  }) as ApolloServer<ApiContext>;
}
