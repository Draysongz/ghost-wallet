import mongoose from "mongoose";

export async function connectDb(): Promise<void> {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    throw new Error("MONGO_URI is not set in the environment");
  }

  try {
    await mongoose.connect(uri);
    console.log("Connected to MongoDB Atlas");
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
    throw error;
  }
}