export const typeDefs = /* GraphQL */ `
  enum PayoutStatus {
    PENDING_RISK
    APPROVED
    REJECTED
    SUBMITTED
    CONFIRMED
    FAILED
  }

  type PayoutRequest {
    id: ID!
    requestId: String!
    to: String!
    asset: String!
    amount: String!
    status: PayoutStatus!
    riskReason: String
    txHash: String
    submittedAt: String
    confirmedAt: String
    createdAt: String!
    updatedAt: String!
  }

  type PayoutRequestEdge {
    cursor: String!
    node: PayoutRequest!
  }

  type PayoutRequestConnection {
    edges: [PayoutRequestEdge!]!
    pageInfo: PageInfo!
  }

  type PageInfo {
    endCursor: String
    hasNextPage: Boolean!
  }

  type Query {
    health: String!
    payoutRequest(id: ID!): PayoutRequest
    payoutRequests(status: PayoutStatus, first: Int!, after: String): PayoutRequestConnection!
  }

  type Mutation {
    noop: String!
    createPayoutRequest(to: String!, amount: String!, asset: String!): PayoutRequest!
    approvePayoutRequest(id: ID!): PayoutRequest!
  }
`;
