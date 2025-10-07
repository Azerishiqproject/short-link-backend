import mongoose, { Schema, InferSchemaType } from "mongoose";

const campaignSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true },
    type: { type: String, enum: ["google_review", "website_traffic", "video_views", "like_follow"], required: true },
    target: { type: Number, required: true, min: 1 },
    country: { type: String, required: true },
    budget: { type: Number, required: true, min: 0 },
    spent: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    status: { type: String, enum: ["active", "paused", "completed"], default: "active" },
  },
  { timestamps: true }
);

export type CampaignDocument = InferSchemaType<typeof campaignSchema> & { _id: mongoose.Types.ObjectId };

export const Campaign = mongoose.models.Campaign || mongoose.model("Campaign", campaignSchema);


