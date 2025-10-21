import mongoose, { Schema, InferSchemaType } from "mongoose";

const priceEntrySchema = new Schema(
  {
    audience: { type: String, enum: ["user", "advertiser"], required: true },
    country: { type: String, required: true },
    unit: { type: String, enum: ["per_1000"], default: "per_1000" },
    rates: {
      website_traffic: { type: Number, required: true, min: 0 },
    },
  },
  { _id: false }
);

const pricingSchema = new Schema(
  {
    entries: { type: [priceEntrySchema], default: [] },
  },
  { timestamps: true }
);

export type PricingDocument = InferSchemaType<typeof pricingSchema> & { _id: mongoose.Types.ObjectId };

export const Pricing = mongoose.models.Pricing || mongoose.model("Pricing", pricingSchema);


