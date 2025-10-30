import mongoose, { Document, Schema } from "mongoose";

export interface AdminAdDocument extends Document {
  url: string;
  remaining: number;
  initialLimit: number;
  served: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const AdminAdSchema = new Schema<AdminAdDocument>(
  {
    url: { type: String, required: true },
    remaining: { type: Number, required: true, default: 0 },
    initialLimit: { type: Number, required: true, default: 0 },
    served: { type: Number, required: true, default: 0 },
    active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true }
);

export const AdminAd = mongoose.models.AdminAd || mongoose.model<AdminAdDocument>("AdminAd", AdminAdSchema);


