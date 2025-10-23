import mongoose, { InferSchemaType } from "mongoose";

const banSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    email: { type: String, index: true },
    emails: { type: [String], default: [] }, // Birden fazla email için
    ip: { type: String, index: true }, // Tek IP için (eski sistem uyumluluğu)
    ips: { type: [String], default: [] }, // Birden fazla IP için
    mac: { type: String, index: true }, // Tek cihaz için (eski sistem uyumluluğu)
    deviceIds: { type: [String], default: [] }, // Birden fazla cihaz için
    reason: { type: String },
    expiresAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    active: { type: Boolean, default: true },
    banType: { type: String, enum: ["single", "comprehensive"], default: "single" }, // Ban tipi
  },
  { timestamps: true }
);

banSchema.index({ email: 1, active: 1 });
banSchema.index({ emails: 1, active: 1 });
banSchema.index({ ip: 1, active: 1 });
banSchema.index({ ips: 1, active: 1 });
banSchema.index({ mac: 1, active: 1 });
banSchema.index({ deviceIds: 1, active: 1 });
banSchema.index({ userId: 1, active: 1 });
banSchema.index({ banType: 1, active: 1 });

export type BanDocument = InferSchemaType<typeof banSchema> & { _id: mongoose.Types.ObjectId };
export const Ban = mongoose.models.Ban || mongoose.model("Ban", banSchema);



