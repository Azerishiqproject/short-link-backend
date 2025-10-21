import mongoose, { InferSchemaType } from "mongoose";

const banSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    email: { type: String, index: true },
    ip: { type: String, index: true },
    mac: { type: String, index: true },
    reason: { type: String },
    expiresAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

banSchema.index({ email: 1, active: 1 });
banSchema.index({ ip: 1, active: 1 });
banSchema.index({ mac: 1, active: 1 });
banSchema.index({ userId: 1, active: 1 });

export type BanDocument = InferSchemaType<typeof banSchema> & { _id: mongoose.Types.ObjectId };
export const Ban = mongoose.models.Ban || mongoose.model("Ban", banSchema);



