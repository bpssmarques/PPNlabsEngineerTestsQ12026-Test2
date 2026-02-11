export const resolvers = {
  Query: {
    health: () => "ok"
  },
  Mutation: {
    noop: () => "noop"
  }
};
