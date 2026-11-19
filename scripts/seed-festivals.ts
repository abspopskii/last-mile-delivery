import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/SentinelRoute";

const FESTIVALS_TO_SEED = [
  {
    id: "new-years-day",
    name: "New Year's Day",
    state: "national",
    startDate: "01-01",
    endDate: "01-01",
    congestionMultiplier: 1.4,
    riskLevel: "medium",
    affectedStates: ["all"],
  },
  {
    id: "independence-day",
    name: "Nigeria Independence Day",
    state: "national",
    startDate: "10-01",
    endDate: "10-01",
    congestionMultiplier: 1.8,
    riskLevel: "high",
    affectedStates: ["all"],
  },
  {
    id: "christmas-travel-period",
    name: "Christmas Travel Period",
    state: "national",
    startDate: "12-20",
    endDate: "12-26",
    congestionMultiplier: 1.7,
    riskLevel: "high",
    affectedStates: ["all"],
  },
];

async function seedFestivals() {
  console.log("Connecting to MongoDB...");
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db();
    const col = db.collection("festivals");

    await col.deleteMany({
      id: {
        $in: [
          "ratha-yatra-2026",
          "raksha-bandhan-2026",
          "independence-day-2026",
          "kanwar-yatra-2026",
          "ambubachi-mela-2026",
          "monsoon-session-parliament-2026",
        ],
      },
    });

    console.log("Seeding Nigerian public-holiday travel periods...");

    for (const fest of FESTIVALS_TO_SEED) {
      await col.updateOne({ id: fest.id }, { $set: fest }, { upsert: true });
      console.log(`Upserted festival: ${fest.name} (${fest.id})`);
    }

    console.log("Seeding completed successfully.");
  } catch (error) {
    console.error("Error seeding festivals:", error);
  } finally {
    await client.close();
  }
}

seedFestivals();
