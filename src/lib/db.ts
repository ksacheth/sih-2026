import mongoose from "mongoose";

const databaseUrl = process.env.DATABASE_URL ?? "mongodb://127.0.0.1:27017/privacy_lens";

declare global {
  var mongooseConnection: Promise<typeof mongoose> | undefined;
}

export function connectToDatabase() {
  if (!global.mongooseConnection) {
    global.mongooseConnection = mongoose.connect(databaseUrl);
  }
  return global.mongooseConnection;
}
