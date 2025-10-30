import mongoose, { Document, Schema, Types } from "mongoose";

export interface AdminAdsConfigDocument extends Document {
  mode: 'random' | 'priority';
  priorityAdId?: Types.ObjectId | null;
  updatedAt: Date;
  createdAt: Date;
}

const AdminAdsConfigSchema = new Schema<AdminAdsConfigDocument>({
  mode: { type: String, enum: ['random', 'priority'], default: 'random' },
  priorityAdId: { type: Schema.Types.ObjectId, ref: 'AdminAd', default: null },
}, { timestamps: true });

export const AdminAdsConfig = mongoose.models.AdminAdsConfig || mongoose.model<AdminAdsConfigDocument>('AdminAdsConfig', AdminAdsConfigSchema);


