import mongoose, { Document, Schema, Types } from "mongoose";

export interface AdminAdHitDocument extends Document {
  adId: Types.ObjectId;
  ipHash: string;
  ip?: string;
  country?: string;
  createdAt: Date;
}

const AdminAdHitSchema = new Schema<AdminAdHitDocument>({
  adId: { type: Schema.Types.ObjectId, ref: "AdminAd", required: true, index: true },
  ipHash: { type: String, required: true, index: true },
  ip: { type: String },
  country: { type: String },
  createdAt: { type: Date, default: Date.now },
});

AdminAdHitSchema.index({ adId: 1, ipHash: 1 }, { unique: true });

export const AdminAdHit = mongoose.models.AdminAdHit || mongoose.model<AdminAdHitDocument>("AdminAdHit", AdminAdHitSchema);


