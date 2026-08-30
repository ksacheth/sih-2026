import { MongoClient, Db, Collection, ObjectId } from "mongodb";

const uri = process.env.DATABASE_URL;
if (!uri) throw new Error("DATABASE_URL is required");

const globalForMongo = globalThis as unknown as {
  mongoPromise?: Promise<MongoClient>;
};

const clientPromise =
  globalForMongo.mongoPromise ??
  (globalForMongo.mongoPromise = new MongoClient(uri).connect());

export async function getDb(): Promise<Db> {
  const client = await clientPromise;
  return client.db(process.env.MONGO_DB_NAME ?? "exposure_monitor");
}

export { ObjectId };
export type { Collection };